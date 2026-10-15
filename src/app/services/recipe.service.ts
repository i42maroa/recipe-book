import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Recipe } from '../models/recipe.model';
import { NotificationService } from './notification.service';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class RecipeService {
  private readonly recipesSubject = new BehaviorSubject<Recipe[]>([]);
  readonly recipes$ = this.recipesSubject.asObservable();
  constructor(private readonly supabase: SupabaseService, private readonly notifications: NotificationService) {
    if (supabase.configured) void this.refresh().catch((error: unknown) => this.reportLoadError(error));
    else this.notifications.error('Falta configurar la conexión con Supabase.');
  }

  private reportLoadError(error: unknown): void {
    console.error('Error al cargar recetas desde Supabase:', error);
    const detail = error instanceof Error ? error.message : 'Error desconocido';
    this.notifications.error(`No se pudieron cargar las recetas de Supabase: ${detail}`);
  }

  async refresh(): Promise<void> {
    const { data, error } = await this.supabase.requireClient().from('recipes').select('*, recipe_ingredients(ingredient_id,amount_kind,amount_value,amount_unit), recipe_steps(position,description), recipe_cuisine_types(cuisine_types(name))').order('name');
    if (error) throw error;
    this.recipesSubject.next((data ?? []).map((row: any) => ({
      id: row.id, name: row.name, minutes: row.minutes, pending: row.pending, mealTypes: row.meal_types ?? [],
      rating: row.rating, sourceUrl: row.source_url ?? '', annotations: row.annotations ?? '', fitness: row.fitness,
      difficulty: row.difficulty, steps: (row.recipe_steps ?? []).sort((a: any,b: any) => a.position-b.position).map((s: any) => s.description),
      ingredientIds: (row.recipe_ingredients ?? []).map((i: any) => i.ingredient_id),
      ingredientAmounts: Object.fromEntries((row.recipe_ingredients ?? []).filter((i: any) => i.amount_kind !== 'none').map((i: any) => [i.ingredient_id, i.amount_kind === 'specific' ? { kind: 'specific', value: Number(i.amount_value), unit: i.amount_unit } : { kind: i.amount_kind }])),
      cuisineTypes: (row.recipe_cuisine_types ?? []).map((c: any) => c.cuisine_types?.name).filter(Boolean),
    } as Recipe)));
  }

  async create(recipe: Omit<Recipe, 'id'>): Promise<void> { await this.save(null, recipe); }
  async update(id: string, recipe: Omit<Recipe, 'id'>): Promise<void> { await this.save(id, recipe); }
  private async save(id: string | null, recipe: Omit<Recipe, 'id'>): Promise<void> {
    const { error } = await this.supabase.requireClient().rpc('save_recipe', { p_id: id, p_recipe: recipe });
    if (error) throw error;
    await this.refresh();
  }
  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.requireClient().from('recipes').delete().eq('id', id);
    if (error) throw error;
    this.recipesSubject.next(this.recipesSubject.value.filter((recipe) => recipe.id !== id));
  }
  getById(id: string): Recipe | undefined { return this.recipesSubject.value.find((recipe) => recipe.id === id); }
  usesIngredient(id: string): boolean { return this.recipesSubject.value.some((recipe) => recipe.ingredientIds.includes(id)); }
}
