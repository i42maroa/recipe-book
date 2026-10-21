import type { Ingredient } from './recipe.model';

export interface ShoppingItem extends Pick<Ingredient, 'id' | 'name' | 'category'> {
  occurrences: number;
}

export interface ShoppingDateRange { from: string; to: string }
