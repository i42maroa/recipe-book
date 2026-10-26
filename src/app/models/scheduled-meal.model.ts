import type { Recipe } from './recipe.model';

export type RecipeSummary = Pick<Recipe, 'id' | 'name' | 'servings' | 'mealTypes' | 'pending'>;
export type MealSlot = 'breakfast' | 'lunch' | 'dinner';
export type PortionMode = 'scale' | 'leftovers';
export interface ScheduledRecipe { recipeId: string; mode: PortionMode }
export interface MealSelection { slot: MealSlot; servings: number; recipes: ScheduledRecipe[] }
export interface ScheduledMeal extends MealSelection { date: string }
export interface ScheduledRecipeAddition { added: boolean; meal: ScheduledMeal }
export const MEAL_SLOTS: { id: MealSlot; label: string }[] = [
  { id: 'breakfast', label: 'Desayuno' }, { id: 'lunch', label: 'Comida' }, { id: 'dinner', label: 'Cena' },
];
