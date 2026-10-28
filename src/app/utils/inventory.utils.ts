import { InventoryItem, InventoryPlace } from '../models/inventory.model';
import { INGREDIENT_CATEGORIES } from '../models/recipe.model';
import { dateNumber } from './scheduled-meal.utils';
import { isUuid } from './uuid.utils';
import { canonicalAmount, ingredientAmountLabel, validIngredientAmount } from './ingredient-measures.utils';

export type InventorySort = 'oldest' | 'newest' | 'name' | 'name-desc';

export function sortInventoryItems(items: InventoryItem[], order: InventorySort): InventoryItem[] {
  return items.slice().sort((a, b) => {
    const date = a.enteredOn.localeCompare(b.enteredOn);
    const name = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    const primary = order === 'oldest' ? date : order === 'newest' ? -date : order === 'name-desc' ? -name : name;
    return primary || (order === 'oldest' || order === 'newest' ? name : date) || a.id.localeCompare(b.id);
  });
}

export function validInventory(value: unknown): value is InventoryPlace[] {
  if (!Array.isArray(value)) return false;
  const placeIds = new Set<string>();
  const itemIds = new Set<string>();
  for (const place of value) {
    if (!place || !isUuid(place.id) || placeIds.has(place.id.toLowerCase())
      || typeof place.name !== 'string' || !place.name.trim() || !Array.isArray(place.items)) return false;
    placeIds.add(place.id.toLowerCase());
    for (const item of place.items) {
      if (!item || !isUuid(item.id) || itemIds.has(item.id.toLowerCase())
        || typeof item.name !== 'string' || !item.name.trim()
        || typeof item.enteredOn !== 'string' || !Number.isFinite(dateNumber(item.enteredOn))
        || item.enteredOn < '0001-01-01' || !validIngredientAmount(item.amount)) return false;
      if (item.ingredientId === null ? item.category !== null
        : !isUuid(item.ingredientId) || !INGREDIENT_CATEGORIES.includes(item.category)) return false;
      if (!['pantry', 'freezer'].includes(item.space) || typeof item.arrivedOn !== 'string'
        || !Number.isFinite(dateNumber(item.arrivedOn)) || item.arrivedOn < item.enteredOn) return false;
      if (item.recipeId === null ? item.servings !== null
        : !isUuid(item.recipeId) || item.ingredientId !== null || item.category !== null || item.amount !== null
          || !Number.isInteger(item.servings) || item.servings <= 0 || item.servings > 2147483647) return false;
      itemIds.add(item.id.toLowerCase());
    }
  }
  return true;
}

export function inventoryFingerprint(places: InventoryPlace[]): string {
  return JSON.stringify(places.map(place => ({ id: place.id.toLowerCase(), name: place.name,
    items: place.items.map(item => ({
      id: item.id.toLowerCase(), ingredientId: item.ingredientId?.toLowerCase() ?? null,
      recipeId: item.recipeId?.toLowerCase() ?? null, name: item.name, category: item.category,
      space: item.space, enteredOn: item.enteredOn, arrivedOn: item.arrivedOn, servings: item.servings,
      amount: canonicalAmount(item.amount),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  })).sort((a, b) => a.id.localeCompare(b.id)));
}

export function inventoryAmountLabel(item: InventoryItem): string {
  return item.recipeId ? `${item.servings} ${item.servings === 1 ? 'ración' : 'raciones'}` : ingredientAmountLabel(item.amount) ?? 'Sin cantidad';
}

export function withdrawInventoryItem(item: InventoryItem, quantity: number): InventoryItem | null {
  if (item.recipeId) {
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > item.servings!) {
      throw new Error('Indica un número entero de raciones mayor que cero y no superior al disponible.');
    }
    return quantity === item.servings ? null : { ...item, servings: item.servings! - quantity };
  }
  const amount = item.amount;
  if (amount?.kind === 'spoon') {
    const value = amount.value ?? 1;
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > value) throw new Error('Revisa la cantidad de cucharadas que retiras.');
    return quantity === value ? null : { ...item, amount: { kind: 'spoon', value: Number((value - quantity).toPrecision(15)) } };
  }
  if (amount?.kind !== 'specific' || amount.value === null || !Number.isFinite(quantity) || quantity <= 0 || quantity > amount.value) {
    throw new Error('Indica una cantidad mayor que cero y no superior a la disponible.');
  }
  return quantity === amount.value ? null : { ...item, amount: { ...amount, value: Number((amount.value - quantity).toPrecision(15)) } };
}

