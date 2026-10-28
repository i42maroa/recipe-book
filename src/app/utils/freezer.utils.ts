import { Freezer, FreezerItem } from '../models/freezer.model';
import { INGREDIENT_CATEGORIES, RecipeIngredientAmount } from '../models/recipe.model';
import { dateNumber } from './scheduled-meal.utils';
import { isUuid } from './uuid.utils';
import { canonicalAmount, ingredientAmountLabel, validIngredientAmount } from './ingredient-measures.utils';

export type FreezerSort = 'oldest' | 'newest' | 'name' | 'name-desc';

export function sortFreezerItems<T extends FreezerItem>(items: T[], order: FreezerSort): T[] {
  return items.slice().sort((a, b) => {
    const date = a.enteredOn.localeCompare(b.enteredOn);
    const name = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    const primary = order === 'oldest' ? date : order === 'newest' ? -date : order === 'name-desc' ? -name : name;
    return primary || (order === 'oldest' || order === 'newest' ? name : date) || a.id.localeCompare(b.id);
  });
}

export function validFreezerAmount(value: unknown): value is RecipeIngredientAmount | null {
  return validIngredientAmount(value as RecipeIngredientAmount | null);
}

export function validFreezers(value: unknown): value is Freezer[] {
  if (!Array.isArray(value)) return false;
  const freezerIds = new Set<string>();
  const itemIds = new Set<string>();
  for (const freezer of value) {
    if (!freezer || typeof freezer.id !== 'string' || !isUuid(freezer.id) || freezerIds.has(freezer.id.toLowerCase())
      || typeof freezer.name !== 'string' || !freezer.name.trim() || !Array.isArray(freezer.items)) return false;
    freezerIds.add(freezer.id.toLowerCase());
    for (const item of freezer.items) {
      if (!item || typeof item.id !== 'string' || !isUuid(item.id) || itemIds.has(item.id.toLowerCase())
        || typeof item.name !== 'string' || !item.name.trim()
        || typeof item.enteredOn !== 'string' || !Number.isFinite(dateNumber(item.enteredOn))
        || item.enteredOn < '0001-01-01' || !validFreezerAmount(item.amount)) return false;
      if (item.ingredientId === null ? item.category !== null
        : typeof item.ingredientId !== 'string' || !isUuid(item.ingredientId) || !INGREDIENT_CATEGORIES.includes(item.category)) return false;
      itemIds.add(item.id.toLowerCase());
    }
  }
  return true;
}

export function freezerFingerprint(freezers: Freezer[]): string {
  return JSON.stringify(freezers.map(freezer => ({
    id: freezer.id.toLowerCase(), name: freezer.name,
    items: freezer.items.map(item => ({
      id: item.id.toLowerCase(), ingredientId: item.ingredientId?.toLowerCase() ?? null,
      name: item.name, category: item.category, enteredOn: item.enteredOn,
      amount: canonicalAmount(item.amount),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  })).sort((a, b) => a.id.localeCompare(b.id)));
}

export function freezerAmountLabel(amount: RecipeIngredientAmount | null): string {
  return ingredientAmountLabel(amount) ?? 'Sin cantidad';
}

/** A fully consumed lot disappears. Never merge lots with different entry dates. */
export function withdrawFreezerItem(item: FreezerItem, quantity: number): FreezerItem | null {
  const amount = item.amount;
  if (amount?.kind === 'spoon') {
    const value = amount.value ?? 1;
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > value) throw new Error('Revisa la cantidad de cucharadas que retiras.');
    return quantity === value ? null : { ...item, amount: { kind: 'spoon', value: Number((value - quantity).toPrecision(15)) } };
  }
  if (amount?.kind !== 'specific' || amount.value === null || !Number.isFinite(quantity) || quantity <= 0 || quantity > amount.value) {
    throw new Error('Indica una cantidad mayor que cero y no superior a la disponible.');
  }
  if (quantity === amount.value) return null;
  const remaining = Number((amount.value - quantity).toPrecision(15));
  return { ...item, amount: { ...amount, value: remaining } };
}
