import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { mapIngredientAmounts } from '../../src/app/utils/ingredient-amount.utils';
import { allowedIngredientAmount } from '../../src/app/utils/ingredient-measures.utils';
import type { RecipeRow, IngredientRow } from '../../src/app/models/database.model';
import type { MealSelection } from '../../src/app/models/scheduled-meal.model';
import { createRecipeSchema, searchRecipesSchema } from './schemas';
import type { McpConfig } from './config';

export class ToolError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function checked<T>(result: { data: T; error: { code?: string; message: string } | null }): T {
  if (result.error) {
    const code = result.error.code;
    if (code === '42501') throw new ToolError('FORBIDDEN', 'Esta cuenta no tiene permisos para esta operación.');
    if (code === 'PT409') throw new ToolError('CONFLICT', 'El día ha cambiado. Consulta de nuevo el plan antes de guardarlo.');
    if (code === '23503') throw new ToolError('NOT_FOUND', 'Alguna receta o ingrediente ya no existe. Consulta los datos de nuevo.');
    if (code === '22023' || code === '23514') throw new ToolError('VALIDATION', 'Los datos no cumplen las reglas del recetario. Revisa cantidades, comensales y recetas.');
    // Do not expose SQL internals, infrastructure details or credentials to the model.
    throw new ToolError('DATABASE_ERROR', 'No se pudo completar la operación en Supabase. Si era un guardado, consulta el resultado antes de reintentarlo.');
  }
  return result.data;
}

const summary = 'id,name,minutes,servings,pending,meal_types,rating,fitness,difficulty';
const ingredientSelect = 'id,name,category,base_unit,unit_quantity';
const escapePattern = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

export class LaurelService {
  constructor(private readonly client: SupabaseClient, private readonly config: McpConfig, private readonly userId?: string) {}

  private async requireEditor(): Promise<void> {
    if (!this.userId) throw new ToolError('UNAUTHENTICATED', 'Conecta tu cuenta de Laurel.');
    if (checked(await this.client.rpc('is_recipe_editor')) !== true) throw new ToolError('FORBIDDEN', 'Necesitas una cuenta autorizada de Laurel.');
  }

  async searchRecipes(input: z.infer<typeof searchRecipesSchema>) {
    const ids = [...new Set(input.ingredientIds)];
    let query = ids.length
      ? this.client.rpc('search_recipes_by_ingredients', { p_ingredient_ids: ids, p_sort: input.sort }, { count: 'exact' }).select(summary)
      : this.client.from('recipes').select(summary, { count: 'exact' });
    if (input.search) query = query.ilike('name', escapePattern(input.search));
    if (input.pending !== 'all') query = query.eq('pending', input.pending === 'pending');
    if (input.mealType) query = query.contains('meal_types', [input.mealType]);
    if (input.difficulty) query = query.eq('difficulty', input.difficulty);
    if (!ids.length) {
      const column = { recent: 'created_at', name: 'name', rating: 'rating', time: 'minutes' }[input.sort];
      query = query.order(column, { ascending: ['name', 'time'].includes(input.sort), nullsFirst: false }).order('id');
    }
    const result = await query.range(input.offset, input.offset + input.limit - 1);
    const items = checked(result) ?? [];
    if (!Array.isArray(items)) throw new ToolError('DATABASE_ERROR', 'La consulta no devolvió una lista de recetas.');
    return { items: items.map((item: { id: string }) => ({ ...item, url: `${this.config.siteUrl}/recipes/${item.id}` })),
      total: result.count, offset: input.offset, limit: input.limit };
  }

  async getRecipe(id: string) {
    const row = checked(await this.client.from('recipes').select(`${summary},source_url,annotations,recipe_ingredients(ingredient_id,amount_kind,amount_value,amount_unit,amount_base_unit,amount_unit_quantity,ingredients(${ingredientSelect})),recipe_steps(position,description),recipe_cuisine_types(cuisine_types(name)),recipe_photos(storage_path,position,alt_text)`)
      .eq('id', id).maybeSingle());
    if (!row) throw new ToolError('NOT_FOUND', 'La receta no existe.');
    const amounts = mapIngredientAmounts(row.recipe_ingredients as RecipeRow['recipe_ingredients'], item => item.ingredient_id);
    return { ...row, url: `${this.config.siteUrl}/recipes/${id}`,
      ingredientAmounts: amounts,
      steps: [...row.recipe_steps].sort((a, b) => a.position - b.position).map(step => step.description) };
  }

  async searchIngredients(search: string, offset: number, limit: number) {
    const result = await this.client.from('ingredients').select(ingredientSelect, { count: 'exact' })
      .ilike('name', escapePattern(search)).order('name').order('id').range(offset, offset + limit - 1);
    return { items: checked(result) ?? [], total: result.count, offset, limit };
  }

  async createRecipe(input: z.infer<typeof createRecipeSchema>) {
    await this.requireEditor();
    const ingredients = checked(await this.client.from('ingredients').select(ingredientSelect).in('id', input.ingredientIds)) as IngredientRow[] | null;
    if (!ingredients || ingredients.length !== input.ingredientIds.length) throw new ToolError('NOT_FOUND', 'Busca y selecciona ingredientes existentes antes de guardar.');
    for (const row of ingredients) {
      if (!allowedIngredientAmount(input.ingredientAmounts[row.id] ?? null, { id: row.id, name: row.name, category: row.category,
        baseUnit: row.base_unit, unitQuantity: row.unit_quantity === null ? null : Number(row.unit_quantity) })) {
        throw new ToolError('VALIDATION', `La cantidad de ${row.name} no coincide con sus medidas. Consulta search_ingredients.`);
      }
    }
    // The transaction creates only; the caller cannot supply an existing recipe ID.
    const result = checked(await this.client.rpc('save_recipe_optimized', { p_id: null, p_recipe: input }));
    const id = result?.[0]?.id;
    if (typeof id !== 'string') throw new ToolError('UNCONFIRMED', 'No se pudo confirmar el guardado. Busca la receta antes de reintentarlo.');
    // No follow-up read: a failed read must not turn a committed create into a retry/duplicate.
    return { id, name: input.name, url: `${this.config.siteUrl}/recipes/${id}`, saved: true };
  }

  async getDailyPlan(date: string) {
    await this.requireEditor();
    const result = checked(await this.client.rpc('get_mcp_scheduled_day', { p_date: date }));
    if (!result || !Array.isArray(result.meals) || typeof result.version !== 'string') throw new ToolError('DATABASE_ERROR', 'El plan recibido no es válido.');
    return result;
  }

  async saveDailyPlan(date: string, meals: MealSelection[], expectedVersion: string) {
    await this.requireEditor();
    checked(await this.client.rpc('save_mcp_scheduled_day', { p_date: date, p_meals: meals, p_expected_version: expectedVersion }));
    return { date, saved: true };
  }
}
