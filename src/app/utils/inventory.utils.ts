import { InventoryItem, InventoryPlace } from '../models/inventory.model';
import { freezerAmountLabel, validFreezers, withdrawFreezerItem } from './freezer.utils';
import { dateNumber } from './scheduled-meal.utils';
import { isUuid } from './uuid.utils';
import { canonicalAmount } from './ingredient-measures.utils';

export function validInventory(value: unknown): value is InventoryPlace[] {
  if (!validFreezers(value)) return false;
  return (value as InventoryPlace[]).every(place => place.items.every(item => {
    if (!['pantry', 'freezer'].includes(item.space) || typeof item.arrivedOn !== 'string'
      || !Number.isFinite(dateNumber(item.arrivedOn)) || item.arrivedOn < item.enteredOn) return false;
    if (item.recipeId === null) return item.servings === null;
    return typeof item.recipeId === 'string' && isUuid(item.recipeId)
      && item.ingredientId === null && item.category === null && item.amount === null
      && Number.isInteger(item.servings) && item.servings! > 0 && item.servings! <= 2147483647;
  }));
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
  return item.recipeId ? `${item.servings} ${item.servings === 1 ? 'ración' : 'raciones'}` : freezerAmountLabel(item.amount);
}

export function withdrawInventoryItem(item: InventoryItem, quantity: number): InventoryItem | null {
  if (!item.recipeId) return withdrawFreezerItem(item, quantity) as InventoryItem | null;
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > item.servings!) {
    throw new Error('Indica un número entero de raciones mayor que cero y no superior al disponible.');
  }
  return quantity === item.servings ? null : { ...item, servings: item.servings! - quantity };
}

