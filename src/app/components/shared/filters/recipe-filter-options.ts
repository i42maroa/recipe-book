import { MealType, RecipeDifficulty } from '../../../models/recipe.model';
import { SelectFilterOption } from './select-filter-options';

export const RECIPE_STATUS_OPTIONS: SelectFilterOption[] = [
  { value: 'all', label: 'Todas' }, { value: 'done', label: 'Hechas' }, { value: 'pending', label: 'Pendientes' },
];
export const RECIPE_SORT_OPTIONS: SelectFilterOption[] = [
  { value: 'recent', label: 'Más recientes' }, { value: 'name', label: 'Nombre A–Z' },
  { value: 'rating', label: 'Mejor puntuación' }, { value: 'time', label: 'Menor tiempo' },
];
export const RECIPE_MEAL_TYPES: MealType[] = ['Desayuno', 'Entrante', 'Plato', 'Postre'];
export const RECIPE_DIFFICULTIES: RecipeDifficulty[] = ['Fácil', 'Media', 'Difícil'];
export const RECIPE_MEAL_TYPE_OPTIONS: SelectFilterOption[] = [
  { value: '', label: 'Todos los tipos' }, ...RECIPE_MEAL_TYPES.map(type => ({ value: type, label: type })),
];
export const RECIPE_DIFFICULTY_OPTIONS: SelectFilterOption[] = [
  { value: '', label: 'Todas' }, ...RECIPE_DIFFICULTIES.map(difficulty => ({ value: difficulty, label: difficulty })),
];
