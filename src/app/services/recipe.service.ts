import { AuthService } from './auth.service';
﻿import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { MealType, Recipe, RecipeDifficulty } from '../models/recipe.model';
import { NotificationService } from './notification.service';
import { SupabaseService } from './supabase.service';
import { RecipePhotoService } from './recipe-photo.service';
import { MIN_SEARCH_LENGTH } from '../utils/search.utils';
import { RecipeRow } from '../models/database.model';
import { mapIngredientAmounts } from '../utils/ingredient-amount.utils';

const RECIPE_SELECT = '*, recipe_ingredients(ingredient_id,amount_kind,amount_value,amount_unit), recipe_steps(position,description), recipe_cuisine_types(cuisine_types(name)), recipe_photos(id,storage_path,position,alt_text)';
export interface RecipeFilters {
  search: string;
  matchingIngredientIds: string[];
  pending: string;
  sort: string;
  mealType: MealType | '';
  difficulty: RecipeDifficulty | '';
}
export interface RecipeBatch {
  items: Recipe[];
  offset: number;
  total: number;
}

@Injectable({ providedIn: 'root' })
export class RecipeService {
  private readonly auth = inject(AuthService);
  readonly pageSize = 20;
  private readonly recipesSubject = new BehaviorSubject<Recipe[]>([]);
  readonly recipes$ = this.recipesSubject.asObservable();
  private readonly statsSubject = new BehaviorSubject({ total: 0, pending: 0 });
  readonly stats$ = this.statsSubject.asObservable();
  private readonly changesSubject = new BehaviorSubject(0);
  readonly changes$ = this.changesSubject.asObservable();
  private detailId: string | null = null;

  constructor(private readonly supabase: SupabaseService, private readonly notifications: NotificationService, private readonly photoService: RecipePhotoService) {
    if (supabase.configured) void this.refreshStats().catch((error: unknown) => this.reportLoadError(error));
    else this.notifications.error('Falta configurar la conexión con Supabase.');
  }

  private reportLoadError(error: unknown): void {
    console.error('Error al cargar recetas desde Supabase:', error);
    const detail = error instanceof Error ? error.message : 'Error desconocido';
    this.notifications.error(`No se pudieron cargar las recetas de Supabase: ${detail}`);
  }

  private async refreshStats(): Promise<void> {
    const client = this.supabase.requireClient();
    const total = await client.from('recipes').select('id', { count: 'exact', head: true });
    if (total.error) throw total.error;
    const pending = await client.from('recipes').select('id', { count: 'exact', head: true }).eq('pending', true);
    if (pending.error) throw pending.error;
    this.statsSubject.next({ total: total.count ?? 0, pending: pending.count ?? 0 });
  }

  private async refresh(recipeId: string | null = this.detailId): Promise<void> {
    if (recipeId) await this.fetchRecipe(recipeId);
    await this.refreshStats();
    this.changesSubject.next(this.changesSubject.value + 1);
  }

  async refreshRecipe(id: string): Promise<void> {
    await this.fetchRecipe(id);
    this.changesSubject.next(this.changesSubject.value + 1);
  }

  async getBatch(filters: RecipeFilters, offset = 0, limit = this.pageSize): Promise<RecipeBatch> {
    const client = this.supabase.requireClient();
    const from = Math.max(0, Math.floor(offset));
    const batchSize = Math.max(1, Math.floor(limit));
    let query = client.from('recipes').select(RECIPE_SELECT, { count: 'exact' });
    const search = filters.search.trim();
    if (search.length >= MIN_SEARCH_LENGTH) {
      const matchingRecipeIds = new Set<string>();
      if (filters.matchingIngredientIds.length) {
        // Read only matching links; the recipe records themselves are always paginated.
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await client.from('recipe_ingredients').select('recipe_id')
            .in('ingredient_id', filters.matchingIngredientIds).order('recipe_id').order('ingredient_id').range(offset, offset + 999);
          if (error) throw error;
          for (const row of data ?? []) matchingRecipeIds.add(row.recipe_id);
          if (!data || data.length < 1000) break;
        }
      }
      const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      if (matchingRecipeIds.size) {
        const quotedPattern = pattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        query = query.or(`name.ilike."${quotedPattern}",id.in.(${[...matchingRecipeIds].join(',')})`);
      } else query = query.ilike('name', pattern);
    }
    if (filters.pending !== 'all') query = query.eq('pending', filters.pending === 'pending');
    if (filters.mealType) query = query.contains('meal_types', [filters.mealType]);
    if (filters.difficulty) query = query.eq('difficulty', filters.difficulty);
    switch (filters.sort) {
      case 'name': query = query.order('name'); break;
      case 'rating': query = query.order('rating', { ascending: false, nullsFirst: false }); break;
      case 'time': query = query.order('minutes', { ascending: true, nullsFirst: false }); break;
      default: query = query.order('created_at', { ascending: false });
    }
    const { data, count, error } = await query.order('id').range(from, from + batchSize - 1).returns<RecipeRow[]>();
    if (error) {
      // Recipes may have been deleted since the previous batch was loaded.
      if (from > 0 && error.code === 'PGRST103') {
        const first = await query.range(0, 0);
        if (first.error) throw first.error;
        return { items: [], total: first.count ?? 0, offset: from };
      }
      throw error;
    }
    const total = count ?? 0;
    const items = this.mapRows(data ?? []);
    this.cache(items);
    return { items, total, offset: from };
  }

  async loadRecipe(id: string): Promise<Recipe | null> {
    this.detailId = id;
    return this.fetchRecipe(id);
  }

  private async fetchRecipe(id: string): Promise<Recipe | null> {
    const { data, error } = await this.supabase.requireClient().from('recipes').select(RECIPE_SELECT).eq('id', id).returns<RecipeRow[]>().maybeSingle();
    if (error) throw error;
    const recipe = data ? this.mapRows([data])[0] : null;
    if (recipe) this.cache([recipe]);
    else this.recipesSubject.next(this.recipesSubject.value.filter((item) => item.id !== id));
    return recipe;
  }

  async getForIngredient(id: string): Promise<Pick<Recipe, 'id' | 'name' | 'minutes'>[]> {
    const result: Pick<Recipe, 'id' | 'name' | 'minutes'>[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.supabase.requireClient().from('recipes')
        .select('id,name,minutes,recipe_ingredients!inner(ingredient_id)')
        .eq('recipe_ingredients.ingredient_id', id).order('name').order('id').range(offset, offset + 999);
      if (error) throw error;
      result.push(...(data ?? []));
      if (!data || data.length < 1000) return result;
    }
  }

  private cache(recipes: Recipe[]): void {
    const cache = new Map(this.recipesSubject.value.map((recipe) => [recipe.id, recipe]));
    for (const recipe of recipes) cache.set(recipe.id, recipe);
    this.recipesSubject.next([...cache.values()]);
  }

  private mapRows(rows: RecipeRow[]): Recipe[] {
    return rows.map((row) => ({
      id: row.id, name: row.name, minutes: row.minutes, servings: row.servings, pending: row.pending, mealTypes: row.meal_types ?? [],
      rating: row.rating, sourceUrl: row.source_url ?? '', annotations: row.annotations ?? '', fitness: row.fitness,
      difficulty: row.difficulty ?? undefined, steps: [...(row.recipe_steps ?? [])].sort((a, b) => a.position - b.position).map((step) => step.description),
      ingredientIds: (row.recipe_ingredients ?? []).map((item) => item.ingredient_id),
      ingredientAmounts: mapIngredientAmounts(row.recipe_ingredients ?? [], (item) => item.ingredient_id),
      cuisineTypes: (row.recipe_cuisine_types ?? []).map((item) => item.cuisine_types?.name).filter((name): name is NonNullable<typeof name> => name !== undefined),
      photos: [...(row.recipe_photos ?? [])].sort((a, b) => a.position - b.position).map((photo) => ({
        id: photo.id, storagePath: photo.storage_path, url: this.photoService.publicUrl(photo.storage_path), position: photo.position, altText: photo.alt_text,
      })),
    }));
  }



  async create(recipe: Omit<Recipe, 'id'>): Promise<string> { return this.save(null, recipe); }
  async update(id: string, recipe: Omit<Recipe, 'id'>): Promise<string> { return this.save(id, recipe); }
  private async save(id: string | null, recipe: Omit<Recipe, 'id'>): Promise<string> {
    await this.auth.requireEditor();
    const { data, error } = await this.supabase.requireClient().rpc('save_recipe', { p_id: id, p_recipe: recipe });
    if (error) throw error;
    const savedId = id ?? String(data);
    await this.refresh(savedId);
    return savedId;
  }
  async remove(id: string): Promise<void> {
    await this.auth.requireEditor();
    await this.photoService.deleteFilesForRecipe(id);
    const { error } = await this.supabase.requireClient().from('recipes').delete().eq('id', id);
    if (error) throw error;
    if (this.detailId === id) this.detailId = null;
    this.recipesSubject.next(this.recipesSubject.value.filter((recipe) => recipe.id !== id));
    await this.refresh();
  }
  getById(id: string): Recipe | undefined { return this.recipesSubject.value.find((recipe) => recipe.id === id); }
}
