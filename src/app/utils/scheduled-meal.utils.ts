import { MealSelection } from '../models/scheduled-meal.model';

const DAY_MS = 86400000;
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function dateNumber(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const number = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(number) && new Date(number).toISOString().slice(0, 10) === value ? number : NaN;
}
export function shiftDate(start: string, days: number): string {
  return new Date(dateNumber(start) + days * DAY_MS).toISOString().slice(0, 10);
}
export function calendarWeek(start: string): { offset: number; date: string; shortLabel: string; label: string }[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = shiftDate(start, offset);
    const value = new Date(`${date}T00:00:00Z`);
    return { offset, date, shortLabel: `${['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][value.getUTCDay()]} ${value.getUTCDate()}`,
      label: new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(value) };
  });
}
export function calendarPeriodLabel(start: string, end: string): string {
  const first = new Date(dateNumber(start));
  const last = new Date(dateNumber(end));
  const month = (date: Date): string => {
    const label = new Intl.DateTimeFormat('es', { month: 'long', timeZone: 'UTC' }).format(date);
    return label.charAt(0).toUpperCase() + label.slice(1);
  };
  if (first.getUTCFullYear() !== last.getUTCFullYear()) return `${month(first)} ${first.getUTCFullYear()} - ${month(last)} ${last.getUTCFullYear()}`;
  if (first.getUTCMonth() !== last.getUTCMonth()) return `${month(first)} - ${month(last)} ${first.getUTCFullYear()}`;
  return `${month(first)} ${first.getUTCFullYear()}`;
}
export function validateDay(date: string, meals: MealSelection[]): string | null {
  if (!Number.isFinite(dateNumber(date))) return 'La fecha no es válida.';
  if (meals.length > 3) return 'Solo se permiten desayuno, comida y cena.';
  const slots = new Set<string>();
  for (const meal of meals) {
    if (!['breakfast', 'lunch', 'dinner'].includes(meal.slot) || slots.has(meal.slot)) return 'Cada comida debe aparecer una sola vez.';
    slots.add(meal.slot);
    if (!Number.isInteger(meal.servings) || meal.servings < 1 || meal.servings > 100) return 'Los comensales deben ser un entero entre 1 y 100.';
    if (meal.recipes.length > 5) return 'Cada comida permite un máximo de cinco recetas.';
    const ids = new Set<string>();
    for (const recipe of meal.recipes) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recipe.recipeId) || !['scale', 'leftovers'].includes(recipe.mode)) return 'La receta o preparación no es válida.';
      const id = recipe.recipeId.toLowerCase();
      if (ids.has(id)) return 'No puedes repetir la misma receta en el mismo día y comida.';
      ids.add(id);
    }
  }
  return null;
}
/** Empty slots have no persisted state; recipe order and portion mode do. */
export function dayFingerprint(meals: MealSelection[]): string {
  return JSON.stringify(meals.filter(meal => meal.recipes.length).map(meal => ({
    slot: meal.slot, servings: meal.servings,
    recipes: meal.recipes.map(recipe => ({ recipeId: recipe.recipeId.toLowerCase(), mode: recipe.mode })),
  })).sort((first, second) => first.slot.localeCompare(second.slot)));
}
export function portionSummary(original: number | null, guests: number, mode: string): string {
  if (!original) return 'Indica los comensales de la receta para calcular la proporción.';
  if (mode === 'scale') return `Preparar ${guests} raciones · proporción ×${new Intl.NumberFormat('es', { maximumFractionDigits: 2 }).format(guests / original)}`;
  const batches = Math.ceil(guests / original);
  const total = batches * original;
  return `Preparar ${total} raciones${batches > 1 ? ` (${batches} veces la receta)` : ''} · ${total - guests} de sobra`;
}
