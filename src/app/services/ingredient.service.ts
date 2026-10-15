import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Ingredient, IngredientCategory } from '../models/recipe.model';
import { NotificationService } from './notification.service';
import { RecipeService } from './recipe.service';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class IngredientService {
  private readonly ingredientsSubject = new BehaviorSubject<Ingredient[]>([]);
  readonly ingredients$ = this.ingredientsSubject.asObservable();
  constructor(private readonly supabase: SupabaseService, private readonly recipes: RecipeService, private readonly notifications: NotificationService) {
    if (supabase.configured) void this.refresh().catch((error: unknown) => {
      console.error('Error al cargar ingredientes desde Supabase:', error);
      const detail = error instanceof Error ? error.message : 'Error desconocido';
      this.notifications.error(`No se pudieron cargar los ingredientes de Supabase: ${detail}`);
    });
  }

  async refresh(): Promise<void> {
    const { data, error } = await this.supabase.requireClient().from('ingredients').select('*, ingredient_components!ingredient_components_parent_ingredient_id_fkey(component_ingredient_id,amount_kind,amount_value,amount_unit)').order('name');
    if (error) throw error;
    this.ingredientsSubject.next((data ?? []).map((row: any) => {
      const components = row.ingredient_components ?? [];
      return { id: row.id, name: row.name, category: row.category, derivedFromIds: components.map((c: any) => c.component_ingredient_id),
        derivedFromAmounts: Object.fromEntries(components.filter((c: any) => c.amount_kind !== 'none').map((c: any) => [c.component_ingredient_id, c.amount_kind === 'specific' ? { kind: 'specific', value: Number(c.amount_value), unit: c.amount_unit } : { kind: c.amount_kind }])) } as Ingredient;
    }));
  }
  async add(name: string, category: IngredientCategory, derivedFromIds: string[] = [], derivedFromAmounts: Ingredient['derivedFromAmounts'] = {}): Promise<Ingredient> {
    const id = crypto.randomUUID();
    const ingredient: Ingredient = { id, name: name.trim(), category, derivedFromIds, derivedFromAmounts };
    const { error } = await this.supabase.requireClient().rpc('save_ingredient', { p_id: id, p_name: ingredient.name, p_category: category, p_components: this.components(ingredient) });
    if (error) throw error;
    await this.refresh();
    return this.getById(id) ?? ingredient;
  }
  getById(id: string): Ingredient | undefined { return this.ingredientsSubject.value.find((item) => item.id === id); }
  async update(id: string, changes: Pick<Ingredient, 'name' | 'category' | 'derivedFromIds' | 'derivedFromAmounts'>): Promise<void> {
    const { error } = await this.supabase.requireClient().rpc('save_ingredient', { p_id: id, p_name: changes.name.trim(), p_category: changes.category, p_components: this.components({ id, ...changes }) });
    if (error) throw error;
    await this.refresh();
  }
  private components(ingredient: Ingredient): object[] { return (ingredient.derivedFromIds ?? []).map((componentId) => ({ ingredient_id: componentId, ...(ingredient.derivedFromAmounts?.[componentId] ?? { kind: 'none' }) })); }
  isUsed(id: string): boolean { return this.recipes.usesIngredient(id) || this.ingredientsSubject.value.some((item) => item.derivedFromIds?.includes(id)); }
  async remove(id: string): Promise<boolean> {
    try {
      const { error } = await this.supabase.requireClient().from('ingredients').delete().eq('id', id);
      if (error) throw error;
      this.ingredientsSubject.next(this.ingredientsSubject.value.filter((item) => item.id !== id));
      this.notifications.success('Ingrediente eliminado.'); return true;
    } catch (error) {
      this.notifications.error('No se pudo eliminar: puede estar asociado a una receta o elaboración.'); return false;
    }
  }
}
