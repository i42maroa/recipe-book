import { INGREDIENT_CATEGORIES, type Ingredient, type IngredientCategory } from '../models/recipe.model';
import type { ShoppingItem } from '../models/shopping-list.model';
import { ingredientCategoryLabel } from './recipe-display.utils';
import { dateNumber } from './scheduled-meal.utils';
import { isUuid } from './uuid.utils';

const categories = new Set<string>(INGREDIENT_CATEGORIES);

export function validShoppingRange(from: string, to: string): boolean {
  return Number.isFinite(dateNumber(from)) && Number.isFinite(dateNumber(to)) && from <= to;
}

export function validShoppingItems(value: unknown): value is ShoppingItem[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || !isUuid(item.id) || typeof item.name !== 'string' || !item.name.trim()
      || !categories.has(item.category) || !Number.isInteger(item.occurrences) || item.occurrences < 1 || item.occurrences > 2147483647) return false;
    const id = item.id.toLowerCase();
    if (ids.has(id)) return false;
    ids.add(id);
  }
  return true;
}

export function shoppingFingerprint(items: ShoppingItem[]): string {
  return JSON.stringify(items.map(item => [item.id.toLowerCase(), item.name, item.category, item.occurrences])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

export function addManualShoppingItems(items: ShoppingItem[], ingredients: Ingredient[]): ShoppingItem[] {
  const next = new Map(items.map(item => [item.id.toLowerCase(), { ...item }]));
  for (const ingredient of ingredients) {
    const id = ingredient.id.toLowerCase();
    if (!next.has(id)) next.set(id, { id, name: ingredient.name, category: ingredient.category, occurrences: 1 });
  }
  return [...next.values()];
}

export function shoppingGroups(items: ShoppingItem[]): { category: IngredientCategory; label: string; items: ShoppingItem[] }[] {
  const groups = new Map<IngredientCategory, ShoppingItem[]>();
  for (const item of items) {
    const group = groups.get(item.category);
    if (group) group.push(item);
    else groups.set(item.category, [item]);
  }
  return [...groups].map(([category, items]) => ({ category, label: ingredientCategoryLabel(category),
    items: [...items].sort((a, b) => a.name.localeCompare(b.name, 'es')),
  })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

export function shoppingShareText(items: ShoppingItem[]): string {
  return ['Lista de la compra · Laurel', ...shoppingGroups(items).map(group =>
    `\n${group.label}\n${group.items.map(item => `• ${item.name}${item.occurrences > 1 ? ` ×${item.occurrences}` : ''}`).join('\n')}`)].join('\n');
}
