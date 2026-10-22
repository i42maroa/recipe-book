import { CuisineType, IngredientCategory, MealType, RecipeDifficulty } from './recipe.model';

export interface AmountRow {
  amount_kind: 'none' | 'spoon' | 'glass' | 'specific';
  amount_value: number | string | null;
  amount_unit: 'ml' | 'g' | 'pieza' | null;
}

export interface IngredientRow {
  id: string;
  name: string;
  category: IngredientCategory;
  ingredient_components: (AmountRow & { component_ingredient_id: string })[];
}

export interface RecipeRow {
  id: string;
  name: string;
  minutes: number | null;
  servings: number | null;
  pending: boolean;
  meal_types: MealType[] | null;
  rating: number | null;
  source_url: string | null;
  annotations: string | null;
  fitness: boolean;
  difficulty: RecipeDifficulty | null;
  recipe_ingredients: (AmountRow & { ingredient_id: string })[];
  recipe_steps: { position: number; description: string }[];
  recipe_cuisine_types: { cuisine_types: { name: CuisineType } | null }[];
  recipe_photos: { id: string; storage_path: string; position: number; alt_text: string | null }[];
}

export interface RecipeCardRow extends Pick<RecipeRow,
  'id' | 'name' | 'minutes' | 'servings' | 'pending' | 'meal_types' |
  'rating' | 'fitness' | 'difficulty' | 'recipe_cuisine_types' | 'recipe_photos'> {
  recipe_ingredients: { count: number }[];
  matched_ingredients?: { ingredient_id: string; ingredients: { name: string } | null }[];
}
