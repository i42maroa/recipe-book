import type { FreezerItem } from './freezer.model';

export type InventorySpace = 'pantry' | 'freezer';

export interface InventoryItem extends FreezerItem {
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
