import { Freezer, FreezerItem } from '../models/freezer.model';
import { INGREDIENT_CATEGORIES, RecipeIngredientAmount } from '../models/recipe.model';
import { dateNumber } from './scheduled-meal.utils';
import { isUuid } from './uuid.utils';

export type FreezerSort = 'oldest' | 'newest' | 'name' | 'name-desc';

export function sortFreezerItems(items: FreezerItem[], order: FreezerSort): FreezerItem[] {
  return items.slice().sort((a, b) => {
    const date = a.enteredOn.localeCompare(b.enteredOn);
    const name = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    const primary = order === 'oldest' ? date : order === 'newest' ? -date : order === 'name-desc' ? -name : name;
    return primary || (order === 'oldest' || order === 'newest' ? name : date) || a.id.localeCompare(b.id);
  });
}

export function validFreezerAmount(value: unknown): value is RecipeIngredientAmount | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const amount = value as RecipeIngredientAmount;
  return amount.kind === 'spoon' || amount.kind === 'glass' || (amount.kind === 'specific'
    && typeof amount.value === 'number' && Number.isFinite(amount.value) && amount.value > 0
    && ['g', 'ml', 'pieza'].includes(amount.unit));
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
      amount: item.amount?.kind === 'specific'
        ? { kind: 'specific', value: item.amount.value, unit: item.amount.unit } : item.amount ? { kind: item.amount.kind } : null,
    })).sort((a, b) => a.id.localeCompare(b.id)),
  })).sort((a, b) => a.id.localeCompare(b.id)));
}

export function freezerAmountLabel(amount: RecipeIngredientAmount | null): string {
  if (!amount) return 'Sin cantidad';
  if (amount.kind === 'spoon') return '1 cucharada';
  if (amount.kind === 'glass') return '1 vaso';
  return `${new Intl.NumberFormat('es', { maximumSignificantDigits: 15 }).format(amount.value ?? 0)} ${amount.unit === 'pieza' ? (amount.value === 1 ? 'pieza' : 'piezas') : amount.unit}`;
}

/** A fully consumed lot disappears. Never merge lots with different entry dates. */
export function withdrawFreezerItem(item: FreezerItem, quantity: number): FreezerItem | null {
  const amount = item.amount;
  if (amount?.kind !== 'specific' || amount.value === null || !Number.isFinite(quantity) || quantity <= 0 || quantity > amount.value) {
    throw new Error('Indica una cantidad mayor que cero y no superior a la disponible.');
  }
  if (quantity === amount.value) return null;
  const remaining = Number((amount.value - quantity).toPrecision(15));
  return { ...item, amount: { ...amount, value: remaining } };
}
