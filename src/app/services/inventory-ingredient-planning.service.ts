import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { merge, skip } from 'rxjs';
import { InventoryIngredientPlanningLink } from '../models/inventory-planning.model';
import { MealSlot } from '../models/scheduled-meal.model';
import { dateNumber, localDate } from '../utils/scheduled-meal.utils';
import { isUuid } from '../utils/uuid.utils';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { ScheduledMealService } from './scheduled-meal.service';
import { RecipeService } from './recipe.service';

interface PlannedRecipe { recipeId: string; date: string; slot: MealSlot }
interface IngredientRow { recipe_id: string; ingredient_id: string; recipes: { name: string } | null }

/** Derived ingredient-level commitments. Reads planning without reserving or consuming stock. */
@Injectable({ providedIn: 'root' })
export class InventoryIngredientPlanningService {
  private readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService);
  private owner: string | undefined;
  private revision = 0;
  private from = '';
  private expires = 0;
  private request: { controller: AbortController; promise: Promise<void> } | undefined;
  readonly links = signal<InventoryIngredientPlanningLink[]>([]);
  readonly loading = signal(false);
  readonly ready = signal(false);
  readonly error = signal('');
  private readonly ids = computed(() => new Set(this.links().map(link => link.ingredientId.toLowerCase())));

  constructor() {
    effect(() => this.syncOwner());
    merge(inject(ScheduledMealService).changes$, inject(RecipeService).changes$.pipe(skip(1)))
      .pipe(takeUntilDestroyed()).subscribe(() => {
        if (!this.ready() && !this.loading()) return;
        this.revision++; this.request?.controller.abort(); this.request = undefined;
        this.ready.set(false); void this.load(true);
      });
    inject(DestroyRef).onDestroy(() => this.request?.controller.abort());
  }
  private syncOwner(): string | undefined {
    const owner = this.auth.canEdit() ? this.auth.user()?.id : undefined;
    if (owner !== this.owner) {
      this.owner = owner; this.revision++; this.request?.controller.abort(); this.request = undefined;
      this.links.set([]); this.ready.set(false); this.loading.set(false); this.error.set(''); this.from = ''; this.expires = 0;
    }
    return owner;
  }
  load(force = false): Promise<void> {
    const owner = this.syncOwner(); const from = localDate();
    if (!owner) return Promise.resolve();
    if (this.request) return this.request.promise;
    if (!force && this.ready() && this.from === from && Date.now() < this.expires) return Promise.resolve();
    const revision = ++this.revision; const controller = new AbortController();
    this.loading.set(true); this.error.set('');
    const active = (): boolean => this.auth.user()?.id === owner && this.auth.canEdit() && this.owner === owner && revision === this.revision && !controller.signal.aborted;
    const promise = this.read(owner, from, controller.signal).then(links => {
      if (active()) { this.links.set(links); this.ready.set(true); this.from = from; this.expires = Date.now() + 300_000; }
    }).catch(error => {
      if (active()) { this.ready.set(false); this.error.set(error instanceof Error ? error.message : 'No se pudieron comprobar los ingredientes planificados.'); }
    }).finally(() => {
      if (this.request?.promise === promise) this.request = undefined;
      if (active()) this.loading.set(false);
    });
    this.request = { controller, promise }; return promise;
  }
  private async read(owner: string, from: string, signal: AbortSignal): Promise<InventoryIngredientPlanningLink[]> {
    await this.auth.requireEditor();
    const check = (): void => {
      signal.throwIfAborted();
      if (this.auth.user()?.id !== owner || !this.auth.canEdit()) throw new Error('La sesión ha cambiado.');
    };
    const planned: PlannedRecipe[] = [];
    let offset = 0; let total: number | null = null;
    for (;;) {
      check();
      const { data, count, error } = await this.supabase.requireClient().from('scheduled_meals')
        .select('meal_date,slot,recipes', offset === 0 ? { count: 'exact' } : undefined)
        .eq('owner_id', owner).gte('meal_date', from).order('meal_date').order('slot').range(offset, offset + 199).abortSignal(signal);
      check(); if (error) throw error;
      if (!Array.isArray(data)) throw new Error('No se pudieron interpretar las comidas planificadas.');
      if (offset === 0) total = count ?? null;
      for (const meal of data) {
        if (typeof meal.meal_date !== 'string' || !Number.isFinite(dateNumber(meal.meal_date)) || meal.meal_date < from
          || !['breakfast', 'lunch', 'dinner'].includes(meal.slot) || !Array.isArray(meal.recipes)) throw new Error('La planificación recibida no es válida.');
        for (const recipe of meal.recipes) {
          if (!recipe || typeof recipe.recipeId !== 'string' || !isUuid(recipe.recipeId)) throw new Error('La receta planificada no es válida.');
          // Prepared dishes already own their ingredients; raw stock is not committed again.
          if (!recipe.inventory) planned.push({ recipeId: recipe.recipeId.toLowerCase(), date: meal.meal_date, slot: meal.slot });
        }
      }
      offset += data.length;
      if (!data.length && total !== null && offset < total) throw new Error('La planificación ha cambiado durante la consulta. Reintenta.');
      if (!data.length || (total !== null && offset >= total)) break;
    }
    const recipeIds = [...new Set(planned.map(meal => meal.recipeId))];
    const ingredients = new Map<string, IngredientRow[]>();
    for (let start = 0; start < recipeIds.length; start += 100) {
      const ids = recipeIds.slice(start, start + 100); offset = 0; total = null;
      for (;;) {
        check();
        const { data, count, error } = await this.supabase.requireClient().from('recipe_ingredients')
          .select('recipe_id,ingredient_id,recipes(name)', offset === 0 ? { count: 'exact' } : undefined)
          .in('recipe_id', ids).order('recipe_id').order('ingredient_id').range(offset, offset + 199).abortSignal(signal)
          .returns<IngredientRow[]>();
        check(); if (error) throw error;
        if (!Array.isArray(data)) throw new Error('No se pudieron interpretar los ingredientes planificados.');
        if (offset === 0) total = count ?? null;
        for (const row of data) {
          if (typeof row.recipe_id !== 'string' || !ids.includes(row.recipe_id.toLowerCase()) || typeof row.ingredient_id !== 'string'
            || !isUuid(row.ingredient_id) || typeof row.recipes?.name !== 'string' || !row.recipes.name.trim()) throw new Error('Los ingredientes planificados recibidos no son válidos.');
          const key = row.recipe_id.toLowerCase(); const entries = ingredients.get(key) ?? []; entries.push(row); ingredients.set(key, entries);
        }
        offset += data.length;
        if (!data.length && total !== null && offset < total) throw new Error('Los ingredientes han cambiado durante la consulta. Reintenta.');
        if (!data.length || (total !== null && offset >= total)) break;
      }
    }
    const links = new Map<string, InventoryIngredientPlanningLink>();
    for (const meal of planned) for (const ingredient of ingredients.get(meal.recipeId) ?? []) {
      const ingredientId = ingredient.ingredient_id.toLowerCase();
      links.set(`${ingredientId}:${meal.date}:${meal.slot}:${meal.recipeId}`, { ingredientId, ...meal, recipeName: ingredient.recipes!.name });
    }
    const slots = { breakfast: 0, lunch: 1, dinner: 2 };
    return [...links.values()].sort((a, b) => a.date.localeCompare(b.date) || slots[a.slot] - slots[b.slot] || a.recipeName.localeCompare(b.recipeName, 'es'));
  }
  isPlanned(ingredientId: string): boolean { return this.ids().has(ingredientId.toLowerCase()); }
  forIngredient(ingredientId: string): InventoryIngredientPlanningLink[] { return this.links().filter(link => link.ingredientId === ingredientId.toLowerCase()); }
  label(link: InventoryIngredientPlanningLink): string {
    return `${link.date.split('-').reverse().join('/')} · ${{ breakfast: 'Desayuno', lunch: 'Comida', dinner: 'Cena' }[link.slot]} · ${link.recipeName}`;
  }
}
