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

/** A compare-and-set change to one freezer name or one dated lot. */
export interface FreezerChange {
  freezerId: string;
  itemId: string | null;
  before: Pick<Freezer, 'name'> | FreezerItem | null;
  after: Pick<Freezer, 'name'> | FreezerItem | null;
}
