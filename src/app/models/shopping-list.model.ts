import type { Ingredient, RecipeIngredientAmount } from './recipe.model';

export interface ShoppingItem extends Pick<Ingredient, 'id' | 'name' | 'category'> {
  occurrences: number;
  amounts?: RecipeIngredientAmount[];
  unquantified?: number;
  notes?: string[];
}

export interface ShoppingRequirementRow {
  source: string;
  id: string;
  name: string;
  category: Ingredient['category'];
  base_unit: 'g' | 'ml';
  unit_quantity: number | null;
  amount: RecipeIngredientAmount | null;
  factor: number;
  missing_servings: boolean;
}

export interface ShoppingDateRange { from: string; to: string }
