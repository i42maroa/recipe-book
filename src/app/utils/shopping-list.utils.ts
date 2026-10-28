import { INGREDIENT_CATEGORIES, type Ingredient, type IngredientCategory } from '../models/recipe.model';
import type { ShoppingItem } from '../models/shopping-list.model';
import { ingredientCategoryLabel } from './recipe-display.utils';
import { dateNumber } from './scheduled-meal.utils';
import { isUuid } from './uuid.utils';
import { canonicalAmount, validIngredientAmount } from './ingredient-measures.utils';
import { combineShoppingAmounts, shoppingQuantityLabel, shoppingUnknownCount } from './shopping-quantities.utils';

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
    if (item.amounts !== undefined && (!Array.isArray(item.amounts) || item.amounts.length > 32 || item.amounts.some((amount: unknown) => !amount || !validIngredientAmount(amount)))) return false;
    if (item.unquantified !== undefined && (!Number.isSafeInteger(item.unquantified) || item.unquantified < 0)) return false;
    if (item.notes !== undefined && (!Array.isArray(item.notes) || item.notes.some((note: unknown) => typeof note !== 'string' || note.length > 500))) return false;
    const id = item.id.toLowerCase();
    if (ids.has(id)) return false;
    ids.add(id);
  }
  return true;
}

export function shoppingFingerprint(items: ShoppingItem[]): string {
  return JSON.stringify(items.map(item => [item.id.toLowerCase(), item.name, item.category, item.occurrences,
    item.amounts?.map(canonicalAmount), item.unquantified, item.notes])
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

export function addPlannedShoppingItems(items: ShoppingItem[], additions: ShoppingItem[]): ShoppingItem[] {
  if (!validShoppingItems(items) || !validShoppingItems(additions)) throw new Error('La lista calculada no es válida.');
  const next = new Map(items.map(item => [item.id.toLowerCase(), structuredClone(item)]));
  for (const addition of structuredClone(additions)) {
    const id = addition.id.toLowerCase(); const previous = next.get(id);
    if (!previous) { next.set(id, { ...addition, id }); continue; }
    const amounts = [...(previous.amounts ?? []), ...(addition.amounts ?? [])];
    next.set(id, { ...previous, occurrences: previous.occurrences + addition.occurrences,
      amounts: [...combineShoppingAmounts(amounts.filter(amount => amount.kind !== 'glass')), ...amounts.filter(amount => amount.kind === 'glass')],
      unquantified: shoppingUnknownCount(previous) + shoppingUnknownCount(addition),
      ...((previous.notes?.length || addition.notes?.length) ? { notes: [...new Set([...(previous.notes ?? []), ...(addition.notes ?? [])])] } : {}),
    });
  }
  const combined = [...next.values()];
  if (!validShoppingItems(combined)) throw new Error('Las cantidades combinadas superan los límites de la lista.');
  return combined;
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
    `\n${group.label}\n${group.items.map(item => `• ${item.name} · ${shoppingQuantityLabel(item)}`).join('\n')}`)].join('\n');
}
