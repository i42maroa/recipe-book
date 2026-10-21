import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { merge } from 'rxjs';
import type { Ingredient } from '../models/recipe.model';
import type { ShoppingItem } from '../models/shopping-list.model';
import { addManualShoppingItems, shoppingFingerprint, validShoppingItems, validShoppingRange } from '../utils/shopping-list.utils';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { IngredientService } from './ingredient.service';
import { RecipeService } from './recipe.service';
import { ScheduledMealService } from './scheduled-meal.service';

const MIGRATION = '20261020000400_shopping_lists.sql';
const PREVIEW_TTL = 300_000;
const MAX_PREVIEWS = 20;

interface PlanningRequest {
  promise: Promise<ShoppingItem[]>;
  controller: AbortController;
  consumers: number;
}

@Injectable({ providedIn: 'root' })
export class ShoppingListService {
  private readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService);
  private owner: string | undefined;
  private generation = 0;
  private version = 0;
  private savedFingerprint = signal(shoppingFingerprint([]));
  private readonly draft = signal<ShoppingItem[]>([]);
  readonly items = this.draft.asReadonly();
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly ready = signal(false);
  readonly error = signal('');
  readonly saveError = signal('');
  readonly dirty = computed(() => shoppingFingerprint(this.items()) !== this.savedFingerprint());
  private request: { generation: number; promise: Promise<void>; controller: AbortController } | undefined;
  private previewRevision = 0;
  private readonly previews = new Map<string, { items: ShoppingItem[]; expires: number }>();
  private readonly previewRequests = new Map<string, PlanningRequest>();

  constructor() {
    effect(() => { this.syncOwner(); });
    merge(inject(RecipeService).changes$, inject(ScheduledMealService).changes$, inject(IngredientService).ingredientIndex$)
      .pipe(takeUntilDestroyed()).subscribe(() => this.invalidatePreviews());
  }

  private invalidatePreviews(): void {
    this.previewRevision++;
    this.previews.clear();
    // Existing consumers may finish, but their results must not repopulate the cache.
    this.previewRequests.clear();
  }

  private syncOwner(): string | undefined {
    const owner = this.auth.canEdit() ? this.auth.user()?.id : undefined;
    if (owner !== this.owner) {
      this.request?.controller.abort(); this.request = undefined;
      for (const request of this.previewRequests.values()) request.controller.abort();
      this.invalidatePreviews();
      this.owner = owner; this.generation++; this.version = 0;
      this.draft.set([]); this.savedFingerprint.set(shoppingFingerprint([]));
      this.ready.set(false); this.loading.set(false); this.saving.set(false); this.error.set(''); this.saveError.set('');
    }
    return owner;
  }

  private active(owner: string, generation: number): boolean {
    return this.auth.canEdit() && this.auth.user()?.id === owner && this.owner === owner && this.generation === generation;
  }

  async load(force = false): Promise<void> {
    const owner = this.syncOwner();
    if (!owner) throw new Error('Necesitas una sesión autorizada.');
    if (this.request?.generation === this.generation) return this.request.promise;
    if ((this.ready() && !force) || this.saving()) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.loading.set(true); this.error.set('');
    const promise = this.read(owner, generation, controller.signal).finally(() => {
      if (this.request?.promise === promise) this.request = undefined;
      if (this.active(owner, generation)) this.loading.set(false);
    });
    this.request = { generation, promise, controller };
    return promise;
  }

  private async read(owner: string, generation: number, signal: AbortSignal): Promise<void> {
    try {
      await this.auth.requireEditor();
      signal.throwIfAborted();
      const { data, error } = await this.supabase.requireClient().from('shopping_lists')
        .select('items,version').eq('owner_id', owner).abortSignal(signal).maybeSingle();
      if (!this.active(owner, generation)) return;
      if (error) throw error;
      const items: unknown = data?.items ?? [];
      const version = data ? Number(data.version) : 0;
      if (!validShoppingItems(items) || !Number.isSafeInteger(version) || (data && version < 1)) throw new Error('No se pudo interpretar la lista guardada.');
      this.draft.set(structuredClone(items)); this.version = version;
      this.savedFingerprint.set(shoppingFingerprint(items)); this.ready.set(true); this.saveError.set('');
    } catch (error) {
      if (this.active(owner, generation) && !signal.aborted) this.error.set(this.message(error, 'No se pudo cargar la lista de la compra.'));
    }
  }

  add(ingredients: Ingredient[]): void {
    if (!this.editable()) return;
    this.draft.set(addManualShoppingItems(this.items(), ingredients)); this.saveError.set('');
  }

  remove(id: string): void {
    if (!this.editable()) return;
    this.draft.update(items => items.filter(item => item.id !== id)); this.saveError.set('');
  }

  clear(): void {
    if (!this.editable()) return;
    this.draft.set([]); this.saveError.set('');
  }

  increment(id: string): void {
    if (!this.editable()) return;
    this.draft.update(items => items.map(item => item.id === id && item.occurrences < 2147483647
      ? { ...item, occurrences: item.occurrences + 1 } : item));
    this.saveError.set('');
  }

  replace(items: ShoppingItem[]): void {
    if (!this.editable()) return;
    if (!validShoppingItems(items)) throw new Error('La lista calculada no es válida.');
    this.draft.set(structuredClone(items)); this.saveError.set('');
  }

  private editable(): boolean {
    return !!this.syncOwner() && this.ready() && !this.loading() && !this.saving();
  }

  async save(): Promise<boolean> {
    if (!this.editable() || !this.dirty()) return false;
    const owner = this.owner!; const generation = this.generation;
    const items = structuredClone(this.items());
    this.saving.set(true); this.saveError.set('');
    try {
      await this.auth.requireEditor();
      if (!this.active(owner, generation)) return false;
      const { data, error } = await this.supabase.requireClient().rpc('save_shopping_list', {
        p_items: items, p_expected_version: this.version,
      });
      if (!this.active(owner, generation)) return false;
      if (error) throw error;
      const version = Number(data);
      if (!Number.isSafeInteger(version) || version < 1) throw new Error('No se pudo confirmar el guardado de la lista.');
      this.version = version; this.savedFingerprint.set(shoppingFingerprint(items));
      return true;
    } catch (error) {
      if (this.active(owner, generation)) this.saveError.set(this.message(error, 'No se pudo guardar la lista. Se conserva tu borrador.'));
      return false;
    } finally { if (this.active(owner, generation)) this.saving.set(false); }
  }

  async fromPlanning(from: string, to: string, signal: AbortSignal): Promise<ShoppingItem[]> {
    if (!validShoppingRange(from, to)) throw new Error('Selecciona un intervalo de fechas válido.');
    const owner = this.syncOwner(); const generation = this.generation;
    if (!owner) throw new Error('Necesitas una sesión autorizada.');
    signal.throwIfAborted();
    if (!this.active(owner, generation)) throw new Error('La sesión ha cambiado.');
    const key = `${from}:${to}`;
    const cached = this.previews.get(key);
    if (cached && cached.expires > Date.now()) return structuredClone(cached.items);
    this.previews.delete(key);
    let request = this.previewRequests.get(key);
    if (request?.controller.signal.aborted) request = undefined;
    if (!request) {
      const controller = new AbortController();
      const revision = this.previewRevision;
      const promise = this.readPlanning(from, to, owner, generation, controller.signal).then(items => {
        if (revision === this.previewRevision && !controller.signal.aborted && this.active(owner, generation)) {
          this.previews.set(key, { items: structuredClone(items), expires: Date.now() + PREVIEW_TTL });
          while (this.previews.size > MAX_PREVIEWS) this.previews.delete(this.previews.keys().next().value!);
        }
        return items;
      });
      request = { promise, controller, consumers: 0 };
      this.previewRequests.set(key, request);
    }
    return this.waitForPlanning(key, request, signal);
  }

  private waitForPlanning(key: string, request: PlanningRequest, signal: AbortSignal): Promise<ShoppingItem[]> {
    request.consumers++;
    let aborted: () => void;
    return new Promise<ShoppingItem[]>((resolve, reject) => {
      aborted = () => reject(signal.reason);
      signal.addEventListener('abort', aborted, { once: true });
      request.promise.then(items => {
        if (signal.aborted) aborted();
        else resolve(structuredClone(items));
      }, reject);
    }).finally(() => {
      signal.removeEventListener('abort', aborted);
      request.consumers--;
      if (!request.consumers) {
        request.controller.abort();
        if (this.previewRequests.get(key) === request) this.previewRequests.delete(key);
      }
    });
  }

  private async readPlanning(from: string, to: string, owner: string, generation: number, signal: AbortSignal): Promise<ShoppingItem[]> {
    await this.auth.requireEditor();
    const items: ShoppingItem[] = [];
    let total: number | null = null;
    for (;;) {
      signal.throwIfAborted();
      if (!this.active(owner, generation)) throw new Error('La sesión ha cambiado.');
      const { data, count, error } = await this.supabase.requireClient().rpc('shopping_ingredients_from_plan', {
        p_from: from, p_to: to,
      }, items.length === 0 ? { count: 'exact' } : {}).order('name').order('id')
        .range(items.length, items.length + 199).abortSignal(signal);
      signal.throwIfAborted();
      if (!this.active(owner, generation)) throw new Error('La sesión ha cambiado.');
      if (error) throw new Error(this.message(error, 'No se pudieron calcular los ingredientes del planning.'));
      if (items.length === 0) total = count ?? null;
      if (!Array.isArray(data)) throw new Error('No se pudo interpretar la lista de ingredientes del planning.');
      const batch = data.map(row => ({ id: row.id, name: row.name, category: row.category, occurrences: Number(row.occurrences) }));
      if (!validShoppingItems(batch)) throw new Error('Los ingredientes calculados no son válidos.');
      items.push(...batch);
      if (!batch.length && total !== null && items.length < total) throw new Error('El planning ha cambiado durante el cálculo. Vuelve a intentarlo.');
      if (!batch.length || (total !== null && items.length >= total)) break;
    }
    if (!validShoppingItems(items)) throw new Error('La lista calculada contiene ingredientes repetidos. Vuelve a intentarlo.');
    return items;
  }

  private message(error: unknown, fallback: string): string {
    const details = error as { code?: string; message?: string } | null;
    if (details?.code === 'PGRST202' || details?.code === 'PGRST205') return `Falta configurar la lista de la compra en Supabase. Aplica la migración ${MIGRATION}.`;
    return details?.message || fallback;
  }
}
