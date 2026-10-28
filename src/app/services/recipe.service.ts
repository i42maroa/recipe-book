import { LoadingService } from './loading.service';
import { RecipeCard } from '../models/recipe-card.model';
import { AuthService } from './auth.service';
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { MealType, Recipe, RecipeDifficulty, RecipeIngredientUsage } from '../models/recipe.model';
import { NotificationService } from './notification.service';
import { SupabaseService } from './supabase.service';
import { RecipePhotoChanges, RecipePhotoService } from './recipe-photo.service';
import { CacheService } from './cache.service';
import { environment } from '../../environments/environment';
import { MIN_SEARCH_LENGTH } from '../utils/search.utils';
import { RecipeCardRow, RecipeRow } from '../models/database.model';
import { mapIngredientAmounts } from '../utils/ingredient-amount.utils';

const RECIPE_SELECT = '*, recipe_ingredients(ingredient_id,amount_kind,amount_value,amount_unit,amount_base_unit,amount_unit_quantity), recipe_steps(position,description), recipe_cuisine_types(cuisine_types(name)), recipe_photos(id,storage_path,position,alt_text)';
const RECIPE_CARD_SELECT = 'id,name,minutes,servings,pending,meal_types,rating,fitness,difficulty,recipe_ingredients(count),recipe_cuisine_types(cuisine_types(name)),recipe_photos(id,storage_path,position,alt_text)';
export interface RecipeFilters {
  search: string;
  pending: string;
  sort: string;
  mealType: MealType | '';
  difficulty: RecipeDifficulty | '';
  ingredientIds?: string[];
  ingredientMatch?: 'all';
}
export interface RecipeBatch {
  items: RecipeCard[];
  offset: number;
  total: number;
}

interface RecipeStats { total: number; pending: number }

export class RecipeSaveError extends Error {
  constructor(message: string, readonly recipeId: string) { super(message); }
}

@Injectable({ providedIn: 'root' })
export class RecipeService {
  private readonly loading = inject(LoadingService);
  private readonly auth = inject(AuthService);
  private readonly cacheStore = inject(CacheService);
  readonly pageSize = 20;
  private readonly recipesSubject = new BehaviorSubject<Recipe[]>([]);
  readonly recipes$ = this.recipesSubject.asObservable();
  private readonly statsSubject = new BehaviorSubject({ total: 0, pending: 0 });
  readonly stats$ = this.statsSubject.asObservable();
  private readonly changesSubject = new BehaviorSubject(0);
  readonly changes$ = this.changesSubject.asObservable();
  private readonly detailRequests = new Map<string, { generation: number; promise: Promise<Recipe | null> }>();
  private readonly detailGenerations = new Map<string, number>();
  private readonly removedIds = new Set<string>();
  private statsGeneration = 0;
  private statsRequest: { generation: number; promise: Promise<void> } | null = null;
  private readonly statsKey = `recipe-stats:v1:${environment.supabaseUrl}`;

  constructor(private readonly supabase: SupabaseService, private readonly notifications: NotificationService, private readonly photoService: RecipePhotoService) {
    if (!supabase.configured) this.notifications.error('Falta configurar la conexión con Supabase.');
  }

  async loadStats(): Promise<void> {
    const cached = this.cacheStore.get<RecipeStats>(this.statsKey);
    if (cached) { this.statsSubject.next(cached); return; }
    const generation = this.statsGeneration;
    if (this.statsRequest?.generation === generation) return this.statsRequest.promise;
    const promise = this.loading.run(() => this.fetchStats(generation), 'recipe-stats');
    this.statsRequest = { generation, promise };
    try { await promise; }
    finally { if (this.statsRequest?.promise === promise) this.statsRequest = null; }
  }

  private async fetchStats(generation: number): Promise<void> {
    const { data, error } = await this.supabase.requireClient().rpc('get_recipe_stats');
    if (generation !== this.statsGeneration) return this.loadStats();
    if (error) throw error;
    const row = (data as RecipeStats[] | null)?.[0];
    if (!row) throw new Error('No se pudieron obtener los contadores de recetas.');
    const stats = { total: Number(row.total), pending: Number(row.pending) };
    this.statsSubject.next(stats);
    this.cacheStore.set(this.statsKey, stats, environment.recipeStatsCacheTtlMs);
  }

  private invalidateStats(): void {
    this.statsGeneration++;
    this.cacheStore.remove(this.statsKey);
  }

  private async refreshChangedStats(): Promise<void> {
    try { await this.loadStats(); }
    catch { this.notifications.error('El cambio se ha guardado, pero no se pudieron actualizar los contadores.'); }
  }

  async getBatch(filters: RecipeFilters, offset = 0, limit = this.pageSize, signal?: AbortSignal): Promise<RecipeBatch> {
    const client = this.supabase.requireClient();
    const from = Math.max(0, Math.floor(offset));
    const batchSize = Math.max(1, Math.floor(limit));
    const ingredientIds = [...new Set(filters.ingredientIds ?? [])];
    // With one ingredient, any-match and all-match are the same query.
    const allIngredients = filters.ingredientMatch === 'all' && ingredientIds.length > 1;
    let query = ingredientIds.length
      ? client.rpc(allIngredients ? 'search_recipes_with_all_ingredients' : 'search_recipes_by_ingredients', { p_ingredient_ids: ingredientIds, p_sort: filters.sort }, { count: 'exact' }).returns<RecipeCardRow[]>()
        .select(`${RECIPE_CARD_SELECT},matched_ingredients:recipe_ingredients(ingredient_id,ingredients(name))`)
      : client.from('recipes').select(RECIPE_CARD_SELECT, { count: 'exact' });
    const search = filters.search.trim();
    if (search.length >= MIN_SEARCH_LENGTH) {
      const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      query = query.ilike('name', pattern);
    }
    if (filters.pending !== 'all') query = query.eq('pending', filters.pending === 'pending');
    if (filters.mealType) query = query.contains('meal_types', [filters.mealType]);
    if (filters.difficulty) query = query.eq('difficulty', filters.difficulty);
    if (!ingredientIds.length) {
      switch (filters.sort) {
        case 'name': query = query.order('name'); break;
        case 'rating': query = query.order('rating', { ascending: false, nullsFirst: false }); break;
        case 'time': query = query.order('minutes', { ascending: true, nullsFirst: false }); break;
        default: query = query.order('created_at', { ascending: false });
      }
      query = query.order('id');
    }
    if (signal) query = query.abortSignal(signal);
    const { data, count, error } = await query.range(from, from + batchSize - 1).returns<RecipeCardRow[]>();
    if (error) {
      if (allIngredients && ['PGRST202', '42883'].includes(error.code)) {
        return this.getAllIngredientMatches(filters, from, batchSize, signal);
      }
      // Recipes may have been deleted since the previous batch was loaded.
      if (from > 0 && error.code === 'PGRST103') {
        const first = await query.range(0, 0);
        if (first.error) throw first.error;
        return { items: [], total: first.count ?? 0, offset: from };
      }
      throw error;
    }
    const total = count ?? 0;
    if (data && !Array.isArray(data)) throw new Error('La consulta de recetas no devolvió una lista.');
    const items = this.mapCardRows(data ?? [], ingredientIds);
    return { items, total, offset: from };
  }

  /** Compatibility for projects where the dedicated all-ingredient RPC is not installed yet. */
  private async getAllIngredientMatches(filters: RecipeFilters, from: number, limit: number, signal?: AbortSignal): Promise<RecipeBatch> {
    const ids = new Set((filters.ingredientIds ?? []).map(id => id.toLowerCase()));
    const items: RecipeCard[] = [];
    let offset = 0; let total = 0;
    // Scan every candidate page before reporting the filtered count. Keep only
    // the requested output page, preserving the server's ranking and filters.
    for (;;) {
      signal?.throwIfAborted();
      const page = await this.getBatch({ ...filters, ingredientMatch: undefined }, offset, 200, signal);
      signal?.throwIfAborted();
      for (const recipe of page.items) {
        const matches = new Set((recipe.matchedIngredients ?? []).map(ingredient => ingredient.id.toLowerCase()));
        if (![...ids].every(id => matches.has(id))) continue;
        if (total >= from && items.length < limit) items.push(recipe);
        total++;
      }
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) break;
    }
    return { items, total, offset: from };
  }

  async getCardsByIds(ids: string[], signal?: AbortSignal): Promise<RecipeCard[]> {
    const uniqueIds = [...new Set(ids)];
    const cards: RecipeCard[] = [];
    for (let offset = 0; offset < uniqueIds.length; offset += 100) {
      signal?.throwIfAborted();
      let query = this.supabase.requireClient().from('recipes').select(RECIPE_CARD_SELECT)
        .in('id', uniqueIds.slice(offset, offset + 100));
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query.returns<RecipeCardRow[]>();
      if (error) throw error;
      cards.push(...this.mapCardRows(data ?? []));
    }
    return cards;
  }

  async loadRecipe(id: string): Promise<Recipe | null> {
    const cached = this.cacheStore.get<Recipe>(this.detailKey(id));
    if (cached) { this.cache([cached], false); return cached; }
    return this.fetchRecipe(id);
  }

  private detailKey(id: string): string { return `recipe-detail:v1:${environment.supabaseUrl}:${id}`; }

  private invalidateDetail(id: string): void {
    this.detailGenerations.set(id, (this.detailGenerations.get(id) ?? 0) + 1);
    this.cacheStore.remove(this.detailKey(id));
  }

  private async fetchRecipe(id: string): Promise<Recipe | null> {
    const generation = this.detailGenerations.get(id) ?? 0;
    const existing = this.detailRequests.get(id);
    if (existing?.generation === generation) return existing.promise;
    const promise = this.loading.run(() => this.fetchRecipeFromServer(id, generation), `recipe-detail:${id}`);
    this.detailRequests.set(id, { generation, promise });
    try { return await promise; }
    finally { if (this.detailRequests.get(id)?.promise === promise) this.detailRequests.delete(id); }
  }

  private async fetchRecipeFromServer(id: string, generation: number): Promise<Recipe | null> {
    const { data, error } = await this.supabase.requireClient().from('recipes').select(RECIPE_SELECT).eq('id', id).returns<RecipeRow[]>().maybeSingle();
    if (generation !== (this.detailGenerations.get(id) ?? 0)) return this.removedIds.has(id) ? null : this.loadRecipe(id);
    if (error) throw error;
    const recipe = data ? this.mapRows([data])[0] : null;
    if (recipe) { this.removedIds.delete(id); this.cache([recipe]); }
    else {
      this.cacheStore.remove(this.detailKey(id));
      this.recipesSubject.next(this.recipesSubject.value.filter((item) => item.id !== id));
    }
    return recipe;
  }

  async getForIngredient(id: string): Promise<RecipeIngredientUsage[]> {
    const ingredientId = id.toLowerCase(); const result: RecipeIngredientUsage[] = [];
    let offset = 0; let total: number | null = null;
    for (;;) {
      const { data, count, error } = await this.supabase.requireClient().from('recipes')
        .select('id,name,recipe_ingredients!inner(ingredient_id,amount_kind,amount_value,amount_unit,amount_base_unit,amount_unit_quantity)', offset === 0 ? { count: 'exact' } : undefined)
        .eq('recipe_ingredients.ingredient_id', ingredientId).order('name').order('id').range(offset, offset + 199)
        .returns<Pick<RecipeRow, 'id' | 'name' | 'recipe_ingredients'>[]>();
      if (error) throw error;
      if (offset === 0) total = count ?? null;
      const rows = data ?? [];
      result.push(...rows.map(row => ({ id: row.id, name: row.name,
        ingredientAmount: mapIngredientAmounts(row.recipe_ingredients, entry => entry.ingredient_id.toLowerCase())[ingredientId] ?? null,
      })));
      offset += rows.length;
      if (!rows.length && total !== null && offset < total) throw new Error('Las recetas relacionadas han cambiado durante la consulta. Reintenta.');
      if (!rows.length || (total !== null && offset >= total)) return result;
    }
  }

  private cache(recipes: Recipe[], persist = true): void {
    const cache = new Map(this.recipesSubject.value.map((recipe) => [recipe.id, recipe]));
    for (const recipe of recipes) {
      cache.delete(recipe.id);
      cache.set(recipe.id, recipe);
      if (persist) this.cacheStore.set(this.detailKey(recipe.id), recipe, environment.recipeDetailCacheTtlMs);
    }
    while (cache.size > 40) cache.delete(cache.keys().next().value!);
    this.recipesSubject.next([...cache.values()]);
  }

  private mapCardRows(rows: RecipeCardRow[], ingredientIds: string[] = []): RecipeCard[] {
    const selectedIds = new Set(ingredientIds.map(id => id.toLowerCase()));
    return rows.map((row) => ({
      ...this.mapSummary(row),
      ingredientCount: row.recipe_ingredients?.[0]?.count ?? 0,
      ...(row.matched_ingredients ? { matchedIngredients: row.matched_ingredients.flatMap(item =>
        item.ingredients && selectedIds.has(item.ingredient_id.toLowerCase())
          ? [{ id: item.ingredient_id, name: item.ingredients.name }] : []) } : {}),
    }));
  }

  private mapRows(rows: RecipeRow[]): Recipe[] {
    return rows.map((row) => ({
      ...this.mapSummary(row),
      sourceUrl: row.source_url ?? '', annotations: row.annotations ?? '',
      steps: [...(row.recipe_steps ?? [])].sort((a, b) => a.position - b.position).map((step) => step.description),
      ingredientIds: (row.recipe_ingredients ?? []).map((item) => item.ingredient_id),
      ingredientAmounts: mapIngredientAmounts(row.recipe_ingredients ?? [], (item) => item.ingredient_id),
    }));
  }

  private mapSummary(row: Omit<RecipeCardRow, 'recipe_ingredients'>) {
    return {
      id: row.id, name: row.name, minutes: row.minutes, servings: row.servings,
      pending: row.pending, mealTypes: row.meal_types ?? [], rating: row.rating,
      fitness: row.fitness, difficulty: row.difficulty ?? undefined,
      cuisineTypes: (row.recipe_cuisine_types ?? []).flatMap(item => item.cuisine_types ? [item.cuisine_types.name] : []),
      photos: [...(row.recipe_photos ?? [])].sort((a, b) => a.position - b.position).map((photo) => ({
        id: photo.id, storagePath: photo.storage_path, url: this.photoService.publicUrl(photo.storage_path), position: photo.position, altText: photo.alt_text,
      })),
    };
  }

  async create(recipe: Omit<Recipe, 'id'>, photos?: RecipePhotoChanges): Promise<string> { return this.loading.run(() => this.save(null, recipe, photos), 'recipe-save'); }
  async update(id: string, recipe: Omit<Recipe, 'id'>, photos?: RecipePhotoChanges): Promise<string> { return this.loading.run(() => this.save(id, recipe, photos), 'recipe-save'); }

  async rate(id: string, rating: number): Promise<void> {
    if (!Number.isInteger(rating) || rating < 1 || rating > 10) throw new Error('La valoración debe ser un entero del 1 al 10.');
    await this.loading.run(async () => {
      await this.auth.requireEditor();
      const { data, error } = await this.supabase.requireClient().rpc('rate_recipe', { p_id: id, p_rating: rating });
      if (error) throw error;
      const row = (data as { id: string; rating: number; pending: boolean; stats_changed: boolean }[] | null)?.[0];
      if (!row) throw new Error('Supabase no devolvió la valoración guardada.');
      this.invalidateDetail(id);
      const recipe = this.getById(id);
      // Patch the visible detail, but do not extend the lifetime of other cached fields.
      if (recipe) this.cache([{ ...recipe, rating: row.rating, pending: row.pending }], false);
      if (row.stats_changed) { this.invalidateStats(); await this.refreshChangedStats(); }
      this.changesSubject.next(this.changesSubject.value + 1);
    }, 'recipe-save');
  }

  private async save(id: string | null, recipe: Omit<Recipe, 'id'>, photos?: RecipePhotoChanges): Promise<string> {
    await this.auth.requireEditor();
    const { data, error } = await this.supabase.requireClient().rpc('save_recipe_optimized', { p_id: id, p_recipe: recipe });
    if (error) throw error;
    const result = (data as { id: string; stats_changed: boolean }[] | null)?.[0];
    if (!result) throw new Error('Supabase no devolvió la receta guardada.');
    const savedId = result.id;
    this.removedIds.delete(savedId);
    this.invalidateDetail(savedId);
    if (result.stats_changed) this.invalidateStats();
    try {
      if (photos) await this.photoService.sync(savedId, photos.retainedPhotos, photos.files, recipe.name, photos.originalPhotos);
      await this.fetchRecipe(savedId);
      return savedId;
    } catch (error) {
      // The base recipe is already committed. Preserve its ID for a retry as an
      // edit, rather than accidentally creating a second recipe after a failure.
      this.cache([{ ...recipe, id: savedId, photos: photos?.originalPhotos ?? recipe.photos ?? [] }], false);
      this.cacheStore.remove(this.detailKey(savedId));
      const message = error instanceof Error ? error.message : (error as { message?: string })?.message;
      throw new RecipeSaveError(`La receta ya está guardada. ${message || 'No se pudo completar la actualización de las fotos o la carga final.'}`, savedId);
    } finally {
      if (result.stats_changed) await this.refreshChangedStats();
      this.changesSubject.next(this.changesSubject.value + 1);
    }
  }
  async remove(id: string): Promise<void> {
    await this.auth.requireEditor();
    const { data, error } = await this.supabase.requireClient().rpc('delete_recipe_with_photos', { p_id: id });
    if (error) throw error;
    if (data !== id) throw new Error('No se pudo confirmar la eliminación de la receta.');
    this.removedIds.add(id);
    this.invalidateDetail(id);
    this.invalidateStats();
    this.recipesSubject.next(this.recipesSubject.value.filter((recipe) => recipe.id !== id));
    await this.refreshChangedStats();
    this.changesSubject.next(this.changesSubject.value + 1);
    if (!await this.photoService.cleanupPending()) this.notifications.error('La receta se ha eliminado. Quedan archivos pendientes de limpieza; se reintentará en la próxima operación de fotos.');
  }
  getById(id: string): Recipe | undefined { return this.recipesSubject.value.find((recipe) => recipe.id === id); }
}
