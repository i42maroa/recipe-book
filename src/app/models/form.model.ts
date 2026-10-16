import { CuisineType, IngredientCategory, MealType, RecipeDifficulty, RecipeIngredientAmount } from './recipe.model';

export type BaseFormType = 'recipe' | 'ingredient';

export interface RecipeFormValue {
  name: string;
  ingredientIds: string[];
  ingredientAmounts: Record<string, RecipeIngredientAmount>;
  minutes: number | null;
  servings: number | null;
  steps: string[];
  pending: string;
  mealTypes: MealType[];
  cuisineTypes: CuisineType[];
  rating: number | null;
  sourceUrl: string;
  annotations: string;
  fitness: boolean;
  difficulty: RecipeDifficulty;
}

export interface IngredientFormValue {
  name: string;
  category: IngredientCategory;
}



