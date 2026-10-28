import type { IngredientCategory, RecipeIngredientAmount } from './recipe.model';

export interface FreezerItem {
  id: string;
  ingredientId: string | null;
  name: string;
  category: IngredientCategory | null;
  amount: RecipeIngredientAmount | null;
  enteredOn: string;
}

export interface Freezer {
  id: string;
  name: string;
  items: FreezerItem[];
}
