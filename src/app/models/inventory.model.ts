import type { IngredientCategory, RecipeIngredientAmount } from './recipe.model';

export type InventorySpace = 'pantry' | 'freezer';

export interface InventoryItem {
  id: string;
  ingredientId: string | null;
  name: string;
  category: IngredientCategory | null;
  amount: RecipeIngredientAmount | null;
  enteredOn: string;
  space: InventorySpace;
  recipeId: string | null;
  servings: number | null;
  arrivedOn: string;
}

export interface InventoryPlace {
  id: string;
  name: string;
  items: InventoryItem[];
}

/** Compare-and-set changes in one atomic operation, including transfers. */
export interface InventoryChange {
  placeId: string;
  itemId: string | null;
  before: Pick<InventoryPlace, 'name'> | InventoryItem | null;
  after: Pick<InventoryPlace, 'name'> | InventoryItem | null;
}
