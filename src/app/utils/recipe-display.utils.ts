import { CuisineType, IngredientCategory, MealType } from '../models/recipe.model';

const CUISINE_FLAGS: Record<CuisineType, string> = {
  Española: '🇪🇸', Italiana: '🇮🇹', Mexicana: '🇲🇽', Japonesa: '🇯🇵', China: '🇨🇳',
  India: '🇮🇳', Francesa: '🇫🇷', Peruana: '🇵🇪', Árabe: '🇸🇦', Otra: '🌐',
};
const MEAL_PHOTO_CLASSES: Record<MealType, string> = {
  Desayuno: 'photo-breakfast', Entrante: 'photo-starter', Plato: 'photo-main', Postre: 'photo-dessert',
};

export function cuisineFlag(cuisine: CuisineType): string {
  return CUISINE_FLAGS[cuisine];
}

export function mealPhotoClass(mealType: MealType | undefined): string {
  return mealType ? MEAL_PHOTO_CLASSES[mealType] ?? 'photo-neutral' : 'photo-neutral';
}

export function ingredientCategoryLabel(category: IngredientCategory): string {
  if (category === 'Lacteo') return 'Lácteo';
  if (category === 'Elaboracion') return 'Elaboración';
  return category;
}
