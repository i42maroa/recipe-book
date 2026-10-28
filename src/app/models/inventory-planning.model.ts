import type { InventorySpace } from './inventory.model';
import type { RecipeCard } from './recipe-card.model';
import type { MealSlot } from './scheduled-meal.model';

export interface InventoryPlanningSource {
  placeId: string;
  itemId: string;
  placeName: string;
  space: InventorySpace;
}
export interface InventoryRecipeSelection { recipe: RecipeCard; inventory: InventoryPlanningSource }
export interface InventoryPlanningLink {
  placeId: string;
  itemId: string;
  recipeId: string;
  date: string;
  slot: MealSlot;
}

export interface InventoryIngredientPlanningLink {
  ingredientId: string;
  recipeId: string;
  recipeName: string;
  date: string;
  slot: MealSlot;
}
