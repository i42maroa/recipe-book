import { z } from 'zod';
import { validateDay } from '../../src/app/utils/scheduled-meal.utils';

export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'UUID no válido.').transform(value => value.toLowerCase());
const text = z.string().trim().min(1).max(200);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value && value >= '1900-01-01';
}, 'Fecha no válida. Usa YYYY-MM-DD.');
const mealType = z.enum(['Desayuno', 'Entrante', 'Plato', 'Postre']);
const difficulty = z.enum(['Fácil', 'Media', 'Difícil']);
const paging = { offset: z.number().int().min(0).max(10000).default(0), limit: z.number().int().min(1).max(50).default(20) };

export const searchRecipesSchema = z.object({
  search: z.string().trim().max(200).default(''), pending: z.enum(['all', 'pending', 'done']).default('all'),
  sort: z.enum(['recent', 'name', 'rating', 'time']).default('recent'),
  mealType: mealType.optional(), difficulty: difficulty.optional(),
  ingredientIds: z.array(uuid).max(20).default([]).describe('IDs reales de ingredientes. Coincidencia con al menos uno; ordena por número de coincidencias.'),
  ...paging,
}).strict();
export const getRecipeSchema = z.object({ id: uuid }).strict();
export const searchIngredientsSchema = z.object({ search: z.string().trim().min(2).max(200), ...paging }).strict();
const amount = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('spoon'), value: z.number().positive().default(1) }).strict(),
  z.object({ kind: z.literal('specific'), value: z.number().positive(), unit: z.enum(['g', 'ml', 'pieza']) }).strict(),
]);
export const createRecipeSchema = z.object({
  name: text, ingredientIds: z.array(uuid).min(1).max(100),
  ingredientAmounts: z.record(uuid, amount).default({}),
  minutes: z.number().int().positive().max(100000).nullable().default(null),
  servings: z.number().int().positive().max(10000).nullable().default(2),
  steps: z.array(z.string().trim().min(1).max(10000)).max(100).default([]),
  pending: z.boolean().default(true), mealTypes: z.array(mealType).max(4).default([]),
  cuisineTypes: z.array(z.enum(['Española', 'Italiana', 'Mexicana', 'Japonesa', 'China', 'India', 'Francesa', 'Peruana', 'Árabe', 'Otra'])).max(10).default([]),
  rating: z.number().int().min(1).max(10).nullable().default(null),
  sourceUrl: z.union([z.literal(''), z.url().refine(value => ['https:', 'http:'].includes(new URL(value).protocol))]).default(''),
  annotations: z.string().max(20000).default(''), fitness: z.boolean().default(false), difficulty: difficulty.optional(),
}).strict().superRefine((recipe, context) => {
  if (new Set(recipe.ingredientIds).size !== recipe.ingredientIds.length) context.addIssue({ code: 'custom', message: 'No repitas ingredientes.' });
  if (Object.keys(recipe.ingredientAmounts).some(id => !recipe.ingredientIds.includes(id))) context.addIssue({ code: 'custom', message: 'Hay cantidades de ingredientes no incluidos.' });
  if (recipe.pending && recipe.rating !== null) context.addIssue({ code: 'custom', message: 'Una receta pendiente no puede tener valoración.' });
});
export const getDailyPlanSchema = z.object({ date }).strict();
export const saveDailyPlanSchema = z.object({
  date,
  expectedVersion: z.string().regex(/^[0-9a-f]{32}$/).describe('Versión devuelta por get_daily_plan. Evita sobrescribir cambios posteriores.'),
  meals: z.array(z.object({
    slot: z.enum(['breakfast', 'lunch', 'dinner']), servings: z.number().int().min(1).max(100),
    recipes: z.array(z.object({ recipeId: uuid, mode: z.enum(['scale', 'leftovers']).default('scale') }).strict()).max(5),
  }).strict()).max(3),
}).strict().superRefine((day, context) => {
  const message = validateDay(day.date, day.meals);
  if (message) context.addIssue({ code: 'custom', message });
});
