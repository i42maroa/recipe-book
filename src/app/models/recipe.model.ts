export type MealType = 'Desayuno' | 'Entrante' | 'Plato' | 'Postre';
export type CuisineType = 'Española' | 'Italiana' | 'Mexicana' | 'Japonesa' | 'China' | 'India' | 'Francesa' | 'Peruana' | 'Árabe' | 'Otra';
export const INGREDIENT_CATEGORIES = ['Verdura', 'Fruta', 'Legumbre', 'Pescado', 'Carne', 'Lacteo', 'Cereal', 'Liquidos', 'FrutosSecos', 'Especia', 'Elaboracion', 'Otro'] as const;
export type IngredientCategory = typeof INGREDIENT_CATEGORIES[number];
export type IngredientBaseUnit = 'g' | 'ml';
export interface IngredientMeasures {
  baseUnit: IngredientBaseUnit;
  unitQuantity: number | null;
}

export interface Ingredient {
  id: string;
  name: string;
  category: IngredientCategory;
  baseUnit?: IngredientBaseUnit;
  unitQuantity?: number | null;
  derivedFromIds?: string[];
  derivedFromAmounts?: Record<string, RecipeIngredientAmount>;
}

export type RecipeIngredientAmount =
  | { kind: 'spoon'; value?: number | null }
  | { kind: 'glass' }
  | { kind: 'specific'; value: number | null; unit: 'ml' | 'g' | 'pieza'; baseUnit?: IngredientBaseUnit; unitQuantity?: number };

export type RecipeDifficulty = 'Fácil' | 'Media' | 'Difícil';

export interface Recipe {
  id: string;
  name: string;
  ingredientIds: string[];
  ingredientAmounts?: Record<string, RecipeIngredientAmount>;
  minutes: number | null;
  servings: number | null;
  steps: string[];
  pending: boolean;
  mealTypes: MealType[];
  cuisineTypes?: CuisineType[];
  rating: number | null;
  sourceUrl: string;
  annotations?: string;
  fitness?: boolean;
  difficulty?: RecipeDifficulty;
  photos?: RecipePhoto[];
}

export interface RecipeIngredientUsage extends Pick<Recipe, 'id' | 'name'> {
  ingredientAmount: RecipeIngredientAmount | null;
}

export interface RecipePhoto {
  id: string;
  storagePath: string;
  url: string;
  position: number;
  altText: string | null;
}

