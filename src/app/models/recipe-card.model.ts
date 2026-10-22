import { Recipe } from './recipe.model';

/** Display data only. Fetch the full Recipe before reading or editing its details. */
export interface RecipeCard extends Pick<Recipe,
  'id' | 'name' | 'minutes' | 'servings' | 'pending' | 'mealTypes' |
  'cuisineTypes' | 'rating' | 'fitness' | 'difficulty' | 'photos'> {
  ingredientCount: number;
  matchedIngredients?: { id: string; name: string }[];
}
