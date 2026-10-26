import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Freezer, FreezerChange, FreezerItem } from '../models/freezer.model';
import { freezerFingerprint, validFreezers, withdrawFreezerItem } from '../utils/freezer.utils';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class FreezerService {
  private readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService);
  private owner: string | undefined;
  private generation = 0;
  private readonly draft = signal<Freezer[]>([]);
  private readonly pending = signal<FreezerChange[][]>([]);
  private request: { promise: Promise<void>; controller: AbortController } | undefined;
  private saveRequest: Promise<boolean> | undefined;
  readonly freezers = this.draft.asReadonly();
  readonly selectedId = signal('');
  readonly selected = computed<Freezer | null>(() => this.freezers().find(freezer => freezer.id === this.selectedId()) ?? this.freezers().at(0) ?? null);
  readonly ready = signal(false);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly saveError = signal('');
  readonly dirty = computed(() => this.pending().length > 0);

  constructor() { effect(() => { this.syncOwner(); }); }

  private syncOwner(): string | undefined {
    const owner = this.auth.canEdit() ? this.auth.user()?.id : undefined;
    if (owner !== this.owner) {
      this.request?.controller.abort(); this.request = undefined;
      this.saveRequest = undefined;
      this.owner = owner; this.generation++;
      this.draft.set([]); this.pending.set([]);
      this.selectedId.set('');
      this.ready.set(false); this.loading.set(false); this.saving.set(false);
      this.error.set(''); this.saveError.set('');
    }
    return owner;
  }

  private active(owner: string, generation: number): boolean {
    return this.auth.canEdit() && this.auth.user()?.id === owner && this.owner === owner && this.generation === generation;
  }

  async load(force = false): Promise<void> {
    const owner = this.syncOwner();
    if (!owner) throw new Error('Necesitas una sesión autorizada.');
    if (this.request) return this.request.promise;
    if ((this.ready() && !force) || this.saving()) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.loading.set(true); this.error.set('');
    const promise = this.read(owner, generation, controller.signal).finally(() => {
      if (this.request?.promise === promise) this.request = undefined;
      if (this.active(owner, generation)) this.loading.set(false);
    });
    this.request = { promise, controller };
    return promise;
  }

  private async read(owner: string, generation: number, signal: AbortSignal): Promise<void> {
    try {
      await this.auth.requireEditor();
      signal.throwIfAborted();
      if (!this.active(owner, generation)) return;
      const { data, error } = await this.supabase.requireClient().rpc('get_freezer_inventory').abortSignal(signal);
      if (!this.active(owner, generation) || signal.aborted) return;
      if (error) throw error;
      const freezers: unknown = data;
      if (!validFreezers(freezers)) throw new Error('No se pudo interpretar el inventario guardado.');
      this.draft.set(structuredClone(freezers)); this.pending.set([]);
      this.ready.set(true); this.saveError.set('');
    } catch (error) {
      if (this.active(owner, generation) && !signal.aborted) this.error.set(this.message(error, 'No se pudieron cargar los congeladores.'));
    }
  }

  private editable(): boolean {
    return !!this.syncOwner() && this.ready() && !this.loading() && !this.error();
  }

  private change(freezers: Freezer[], changes: FreezerChange[]): boolean {
    if (!this.editable()) return false;
    if (!changes.length) return true;
    this.pending.update(queue => [...queue, structuredClone(changes)]);
    this.draft.set(freezers); this.saveError.set('');
    void this.save();
    return true;
  }

  create(name: string): string | null {
    if (!this.editable()) return null;
    const id = crypto.randomUUID();
    const freezer: Freezer = { id, name: name.trim(), items: [] };
    this.validate(freezer);
    return this.change([...this.freezers(), freezer], [{ freezerId: id, itemId: null, before: null, after: { name: freezer.name } }]) ? id : null;
  }

  rename(id: string, name: string): void {
    if (!this.editable()) return;
    const freezer = this.freezers().find(value => value.id === id);
    if (!freezer || freezer.name === name.trim()) return;
    this.validate({ id, name: name.trim(), items: [] });
    this.change(this.freezers().map(value => value.id === id ? { ...value, name: name.trim() } : value),
      [{ freezerId: id, itemId: null, before: { name: freezer.name }, after: { name: name.trim() } }]);
  }

  removeFreezer(id: string): void {
    if (!this.editable()) return;
    const freezer = this.freezers().find(value => value.id === id);
    if (!freezer) return;
    if (freezer.items.length) throw new Error('Vacía el congelador antes de eliminarlo.');
    this.change(this.freezers().filter(value => value.id !== id),
      [{ freezerId: id, itemId: null, before: { name: freezer.name }, after: null }]);
  }

  addItems(freezerId: string, additions: FreezerItem[]): boolean {
    if (!this.editable()) return false;
    const freezer = this.freezers().find(value => value.id === freezerId);
    if (!freezer) return false;
    const items = structuredClone(additions);
    this.validate({ ...freezer, items });
    const ids = new Set(items.map(item => item.id.toLowerCase()));
    if (this.freezers().some(value => value.items.some(item => ids.has(item.id.toLowerCase())))) throw new Error('Ya existe una entrada con ese identificador.');
    return this.change(this.freezers().map(value => value.id === freezerId ? { ...value, items: [...value.items, ...items] } : value),
      items.map(item => ({ freezerId, itemId: item.id, before: null, after: item })));
  }

  updateItem(freezerId: string, item: FreezerItem): boolean {
    if (!this.editable()) return false;
    const freezer = this.freezers().find(value => value.id === freezerId);
    const previous = freezer?.items.find(value => value.id === item.id);
    if (!freezer || !previous) return false;
    const next = structuredClone(item);
    this.validate({ ...freezer, items: [next] });
    if (freezerFingerprint([{ ...freezer, items: [previous] }]) === freezerFingerprint([{ ...freezer, items: [next] }])) return true;
    return this.change(this.freezers().map(value => value.id === freezerId
      ? { ...value, items: value.items.map(existing => existing.id === next.id ? next : existing) } : value),
      [{ freezerId, itemId: next.id, before: previous, after: next }]);
  }

  removeItem(freezerId: string, itemId: string): void {
    if (!this.editable()) return;
    const previous = this.freezers().find(value => value.id === freezerId)?.items.find(item => item.id === itemId);
    if (!previous) return;
    this.change(this.freezers().map(value => value.id === freezerId
      ? { ...value, items: value.items.filter(item => item.id !== itemId) } : value),
      [{ freezerId, itemId, before: previous, after: null }]);
  }

  withdraw(freezerId: string, itemId: string, quantity: number): void {
    if (!this.editable()) return;
    const item = this.freezers().find(value => value.id === freezerId)?.items.find(value => value.id === itemId);
    if (!item) return;
    const remaining = withdrawFreezerItem(item, quantity);
    if (remaining) this.updateItem(freezerId, remaining);
    else this.removeItem(freezerId, itemId);
  }

  clear(freezerId: string): void {
    if (!this.editable()) return;
    const freezer = this.freezers().find(value => value.id === freezerId);
    if (!freezer) return;
    this.change(this.freezers().map(value => value.id === freezerId ? { ...value, items: [] } : value),
      freezer.items.map(item => ({ freezerId, itemId: item.id, before: item, after: null })));
  }

  private validate(freezer: Freezer): void {
    if (!validFreezers([freezer])) throw new Error('Revisa los nombres, las cantidades y las fechas de entrada.');
  }

  save(): Promise<boolean> {
    this.syncOwner();
    if (this.saveRequest) return this.saveRequest;
    if (!this.editable() || !this.dirty()) return Promise.resolve(false);
    const owner = this.owner!; const generation = this.generation;
    this.saving.set(true); this.saveError.set('');
    const promise = this.write(owner, generation).finally(() => {
      if (this.saveRequest === promise) this.saveRequest = undefined;
      if (this.active(owner, generation)) {
        this.saving.set(false);
        if (this.dirty() && !this.saveError()) void this.save();
      }
    });
    this.saveRequest = promise;
    return promise;
  }

  private async write(owner: string, generation: number): Promise<boolean> {
    try {
      await this.auth.requireEditor();
      if (!this.active(owner, generation)) return false;
      while (this.pending().length) {
        const changes = this.pending()[0];
        const { data, error } = await this.supabase.requireClient().rpc('apply_freezer_changes', { p_changes: changes });
        if (!this.active(owner, generation)) return false;
        if (error) throw error;
        if (data !== true) throw new Error('No se pudo confirmar el guardado del inventario.');
        this.pending.update(queue => queue.slice(1));
      }
      return true;
    } catch (error) {
      if (this.active(owner, generation)) this.saveError.set(this.message(error, 'No se pudo guardar el inventario. Se conserva tu borrador.'));
      return false;
    }
  }

  private message(error: unknown, fallback: string): string {
    const details = error as { code?: string; message?: string } | null;
    if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(details?.code ?? '')) {
      return 'Falta actualizar Congelador en Supabase. Aplica las migraciones 20261026000100_freezer_inventories.sql y 20261026000200_freezer_entries.sql.';
    }
    return details?.message || fallback;
  }
}
