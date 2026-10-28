import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { InventoryPlace, InventoryChange, InventoryItem, InventorySpace } from '../models/inventory.model';
import { inventoryFingerprint, validInventory, withdrawInventoryItem } from '../utils/inventory.utils';
import { environment } from '../../environments/environment';
import { CacheService } from './cache.service';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class InventoryService {
  private readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService);
  private readonly cache = inject(CacheService);
  private owner: string | undefined;
  private generation = 0;
  private readonly draft = signal<InventoryPlace[]>([]);
  private readonly pending = signal<InventoryChange[][]>([]);
  private request: { promise: Promise<void>; controller: AbortController } | undefined;
  private saveRequest: Promise<boolean> | undefined;
  private linkRequest: AbortController | undefined;
  private linkSignature = '';
  readonly places = this.draft.asReadonly();
  readonly selectedId = signal('');
  readonly selectedSpace = signal<InventorySpace>('pantry');
  readonly availableRecipeIds = signal<string[]>([]);
  readonly linksError = signal('');
  readonly linksLoading = signal(false);
  readonly selected = computed<InventoryPlace | null>(() => this.places().find(place => place.id === this.selectedId()) ?? this.places().at(0) ?? null);
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
      this.linkRequest?.abort(); this.linkRequest = undefined; this.linkSignature = '';
      this.saveRequest = undefined;
      this.owner = owner; this.generation++;
      this.draft.set([]); this.pending.set([]);
      this.selectedId.set('');
      this.selectedSpace.set('pantry'); this.availableRecipeIds.set([]); this.linksError.set('');
      this.linksLoading.set(false);
      if (owner) {
        const selection = this.cache.get<{ placeId: string; space: InventorySpace }>(this.selectionKey(owner));
        if (selection && typeof selection.placeId === 'string' && ['pantry', 'freezer'].includes(selection.space)) {
          this.selectedId.set(selection.placeId); this.selectedSpace.set(selection.space);
        }
      }
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
    if (this.ready() && !force) { void this.refreshRecipeLinks(true); return; }
    if (this.saving()) return;
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
      const { data, error } = await this.supabase.requireClient().rpc('get_inventory').abortSignal(signal);
      if (!this.active(owner, generation) || signal.aborted) return;
      if (error) throw error;
      const places: unknown = data;
      if (!validInventory(places)) throw new Error('No se pudo interpretar el inventario guardado.');
      this.draft.set(structuredClone(places)); this.pending.set([]);
      this.ready.set(true); this.saveError.set('');
      this.select(this.selected()?.id ?? '', this.selectedSpace());
      void this.refreshRecipeLinks(true);
    } catch (error) {
      if (this.active(owner, generation) && !signal.aborted) this.error.set(this.message(error, 'No se pudo cargar el inventario.'));
    }
  }

  private editable(): boolean {
    return !!this.syncOwner() && this.ready() && !this.loading() && !this.error();
  }

  private change(places: InventoryPlace[], changes: InventoryChange[]): boolean {
    if (!this.editable()) return false;
    if (!changes.length) return true;
    this.pending.update(queue => [...queue, structuredClone(changes)]);
    this.draft.set(places); this.saveError.set('');
    void this.refreshRecipeLinks();
    void this.save();
    return true;
  }

  create(name: string): string | null {
    if (!this.editable()) return null;
    const id = crypto.randomUUID();
    const place: InventoryPlace = { id, name: name.trim(), items: [] };
    this.validate(place);
    return this.change([...this.places(), place], [{ placeId: id, itemId: null, before: null, after: { name: place.name } }]) ? id : null;
  }

  rename(id: string, name: string): void {
    if (!this.editable()) return;
    const place = this.places().find(value => value.id === id);
    if (!place || place.name === name.trim()) return;
    this.validate({ id, name: name.trim(), items: [] });
    this.change(this.places().map(value => value.id === id ? { ...value, name: name.trim() } : value),
      [{ placeId: id, itemId: null, before: { name: place.name }, after: { name: name.trim() } }]);
  }

  removePlace(id: string): void {
    if (!this.editable()) return;
    const place = this.places().find(value => value.id === id);
    if (!place) return;
    if (place.items.length) throw new Error('Vacía la alacena y el congelador antes de eliminar el lugar.');
    this.change(this.places().filter(value => value.id !== id),
      [{ placeId: id, itemId: null, before: { name: place.name }, after: null }]);
  }

  addItems(placeId: string, additions: InventoryItem[]): boolean {
    if (!this.editable()) return false;
    const place = this.places().find(value => value.id === placeId);
    if (!place) return false;
    const items = structuredClone(additions);
    this.validate({ ...place, items });
    const ids = new Set(items.map(item => item.id.toLowerCase()));
    if (this.places().some(value => value.items.some(item => ids.has(item.id.toLowerCase())))) throw new Error('Ya existe una entrada con ese identificador.');
    return this.change(this.places().map(value => value.id === placeId ? { ...value, items: [...value.items, ...items] } : value),
      items.map(item => ({ placeId, itemId: item.id, before: null, after: item })));
  }

  updateItem(placeId: string, item: InventoryItem): boolean {
    if (!this.editable()) return false;
    const place = this.places().find(value => value.id === placeId);
    const previous = place?.items.find(value => value.id === item.id);
    if (!place || !previous) return false;
    const next = structuredClone(item);
    this.validate({ ...place, items: [next] });
    if (inventoryFingerprint([{ ...place, items: [previous] }]) === inventoryFingerprint([{ ...place, items: [next] }])) return true;
    return this.change(this.places().map(value => value.id === placeId
      ? { ...value, items: value.items.map(existing => existing.id === next.id ? next : existing) } : value),
      [{ placeId, itemId: next.id, before: previous, after: next }]);
  }

  removeItem(placeId: string, itemId: string): void {
    if (!this.editable()) return;
    const previous = this.places().find(value => value.id === placeId)?.items.find(item => item.id === itemId);
    if (!previous) return;
    this.change(this.places().map(value => value.id === placeId
      ? { ...value, items: value.items.filter(item => item.id !== itemId) } : value),
      [{ placeId, itemId, before: previous, after: null }]);
  }

  withdraw(placeId: string, itemId: string, quantity: number): void {
    if (!this.editable()) return;
    const item = this.places().find(value => value.id === placeId)?.items.find(value => value.id === itemId);
    if (!item) return;
    const remaining = withdrawInventoryItem(item, quantity);
    if (remaining) this.updateItem(placeId, remaining);
    else this.removeItem(placeId, itemId);
  }

  select(placeId: string, space: InventorySpace = this.selectedSpace()): void {
    if (!this.syncOwner() || !['pantry', 'freezer'].includes(space)) return;
    this.selectedId.set(this.places().some(place => place.id === placeId) ? placeId : this.places().at(0)?.id ?? '');
    this.selectedSpace.set(space);
    this.cache.set(this.selectionKey(this.owner!), { placeId: this.selectedId(), space }, 365 * 24 * 60 * 60 * 1000);
  }

  private selectionKey(owner: string): string { return `inventory-selection:v1:${environment.supabaseUrl}:${owner}`; }

  async refreshRecipeLinks(force = false): Promise<void> {
    const owner = this.syncOwner();
    if (!owner) return;
    const ids = [...new Set(this.places().flatMap(place => place.items.flatMap(item => item.recipeId ? [item.recipeId.toLowerCase()] : [])))].sort();
    const signature = JSON.stringify(ids);
    if (!force && signature === this.linkSignature) return;
    this.linkSignature = signature; this.linkRequest?.abort();
    const controller = this.linkRequest = new AbortController();
    const generation = this.generation;
    this.availableRecipeIds.set([]); this.linksError.set(''); this.linksLoading.set(ids.length > 0);
    if (!ids.length) return;
    try {
      await this.auth.requireEditor();
      if (!this.active(owner, generation) || controller.signal.aborted) return;
      const available: string[] = [];
      for (let offset = 0; offset < ids.length; offset += 100) {
        const { data, error } = await this.supabase.requireClient().rpc('inventory_recipe_ids', { p_ids: ids.slice(offset, offset + 100) }).abortSignal(controller.signal);
        if (!this.active(owner, generation) || controller.signal.aborted) return;
        if (error) throw error;
        if (!Array.isArray(data) || data.some(id => typeof id !== 'string' || !ids.includes(id.toLowerCase()))) throw new Error('Respuesta de recetas no válida.');
        available.push(...data.map(id => (id as string).toLowerCase()));
      }
      this.availableRecipeIds.set(available);
    } catch {
      if (this.active(owner, generation) && !controller.signal.aborted) {
        this.linkSignature = ''; this.linksError.set('No se pudieron comprobar los enlaces a las recetas.');
      }
    } finally {
      if (this.active(owner, generation) && this.linkRequest === controller) this.linksLoading.set(false);
    }
  }

  clear(placeId: string): void {
    if (!this.editable()) return;
    const place = this.places().find(value => value.id === placeId);
    if (!place) return;
    this.change(this.places().map(value => value.id === placeId ? { ...value, items: [] } : value),
      place.items.map(item => ({ placeId, itemId: item.id, before: item, after: null })));
  }

  private validate(place: InventoryPlace): void {
    if (!validInventory([place])) throw new Error('Revisa los nombres, las cantidades y las fechas de entrada.');
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
        const { data, error } = await this.supabase.requireClient().rpc('apply_inventory_changes', { p_changes: changes });
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
      return 'Falta actualizar Inventario en Supabase. Aplica la migración 20261027000100_inventory_places.sql después de las migraciones de Congelador.';
    }
    return details?.message || fallback;
  }
}
