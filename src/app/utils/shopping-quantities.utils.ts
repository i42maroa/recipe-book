import { Ingredient, RecipeIngredientAmount } from '../models/recipe.model';
import { ShoppingItem, ShoppingRequirementRow } from '../models/shopping-list.model';
import { InventoryPlace } from '../models/inventory.model';
import { ingredientAmountLabel, positiveQuantity, SPICE_SPOON_GRAMS, validIngredientAmount } from './ingredient-measures.utils';

const round = (value: number): number => Number(value.toPrecision(12));
const amountKey = (amount: RecipeIngredientAmount): string => amount.kind === 'specific'
  ? `${amount.unit}:${amount.baseUnit ?? ''}:${amount.unitQuantity ?? ''}` : amount.kind;

export function combineShoppingAmounts(amounts: RecipeIngredientAmount[]): RecipeIngredientAmount[] {
  const totals = new Map<string, RecipeIngredientAmount>();
  for (const amount of amounts) {
    if (!validIngredientAmount(amount) || amount.kind === 'glass') throw new Error('Revisa las cantidades de la compra.');
    const normalized: RecipeIngredientAmount = amount.kind === 'spoon'
      ? { kind: 'specific', unit: 'g', value: (amount.value ?? 1) * SPICE_SPOON_GRAMS } : { ...amount };
    const key = amountKey(normalized); const previous = totals.get(key);
    if (previous?.kind === 'specific' && normalized.kind === 'specific') previous.value = round(previous.value! + normalized.value!);
    else totals.set(key, normalized);
  }
  if ([...totals.values()].some(amount => amount.kind === 'specific' && !positiveQuantity(amount.value))) throw new Error('La cantidad calculada está fuera de rango.');
  return [...totals.values()];
}

export function shoppingRequirements(rows: ShoppingRequirementRow[]): ShoppingItem[] {
  const items = new Map<string, ShoppingItem>();
  for (const row of rows) {
    if (!positiveQuantity(row.factor)) throw new Error('No se pudo calcular la proporción de una receta.');
    const id = row.id.toLowerCase();
    let item = items.get(id);
    if (!item) { item = { id, name: row.name, category: row.category, occurrences: 0, amounts: [], unquantified: 0 }; items.set(id, item); }
    item.occurrences++;
    if (row.missing_servings) item.notes = ['Hay una receta sin comensales: se han usado sus cantidades completas.'];
    const missingAmount = !row.amount || (row.amount.kind === 'specific' && row.amount.value == null);
    const amount: RecipeIngredientAmount = missingAmount ? { kind: 'specific', unit: 'pieza', value: 1 } : row.amount!;
    if (amount.kind === 'glass' || !validIngredientAmount(amount) || (amount.kind === 'spoon' && row.category !== 'Especia')) { item.unquantified!++; continue; }
    // Without an original quantity, use one unit per planned appearance rather than scaling a guessed amount.
    const factor = missingAmount ? 1 : row.factor;
    const scaled: RecipeIngredientAmount = amount.kind === 'spoon'
      ? { kind: 'specific', unit: 'g', value: round((amount.value ?? 1) * SPICE_SPOON_GRAMS * factor) }
      : { ...amount, value: round(amount.value! * factor), ...(amount.unit === 'pieza' && !amount.unitQuantity && positiveQuantity(row.unit_quantity) ? { baseUnit: row.base_unit, unitQuantity: row.unit_quantity } : {}) };
    item.amounts!.push(scaled);
  }
  return [...items.values()].map(item => ({ ...item, amounts: combineShoppingAmounts(item.amounts!) }));
}

function metric(amount: RecipeIngredientAmount, ingredient?: Ingredient): { unit: string; value: number } | null {
  if (amount.kind === 'glass' || !validIngredientAmount(amount)) return null;
  if (amount.kind === 'spoon') return ingredient?.category === 'Especia' ? { unit: 'g', value: (amount.value ?? 1) * SPICE_SPOON_GRAMS } : null;
  const equivalent = amount.unitQuantity ?? ingredient?.unitQuantity;
  return amount.unit === 'pieza' && positiveQuantity(equivalent)
    ? { unit: amount.baseUnit ?? ingredient?.baseUnit ?? (ingredient?.category === 'Liquidos' ? 'ml' : 'g'), value: round(amount.value! * equivalent) }
    : { unit: amount.unit, value: amount.value! };
}

/** Each stock quantity is consumed from this calculation only, never from inventory. */
export function subtractShoppingStock(items: ShoppingItem[], places: InventoryPlace[], ingredients: Ingredient[]): ShoppingItem[] {
  const catalog = new Map(ingredients.map(ingredient => [ingredient.id.toLowerCase(), ingredient]));
  const available = new Map<string, number>();
  for (const place of places) for (const lot of place.items) {
    if (!lot.ingredientId || lot.recipeId || !lot.amount) continue;
    const id = lot.ingredientId.toLowerCase(); const measured = metric(lot.amount, catalog.get(id));
    if (measured) { const key = `${id}:${measured.unit}`; available.set(key, round((available.get(key) ?? 0) + measured.value)); }
  }
  return items.flatMap(item => {
    const ingredient = catalog.get(item.id.toLowerCase());
    const amounts = (item.amounts ?? []).flatMap(amount => {
      const measured = metric(amount, ingredient); if (!measured) return [amount];
      const key = `${item.id.toLowerCase()}:${measured.unit}`; const held = available.get(key) ?? 0;
      if (held <= 0) return [amount];
      const used = Math.min(held, measured.value); available.set(key, round(held - used));
      const missing = round(measured.value - used);
      if (missing <= Math.max(measured.value, held) * 1e-12) return [];
      return [{ kind: 'specific' as const, unit: measured.unit as 'g' | 'ml' | 'pieza', value: missing }];
    });
    return amounts.length || shoppingUnknownCount(item) ? [{ ...structuredClone(item), amounts: combineShoppingAmounts(amounts) }] : [];
  });
}

export function shoppingUnknownCount(item: ShoppingItem): number { return item.unquantified ?? (item.amounts?.length ? 0 : 1); }
export function shoppingDefaultQuantity(item: ShoppingItem): ShoppingItem {
  if (item.amounts?.length && !shoppingUnknownCount(item)) return item;
  return { ...item, amounts: [...(item.amounts ?? []), { kind: 'specific', unit: 'pieza', value: 1 }], unquantified: 0 };
}
export function shoppingQuantityLabel(item: ShoppingItem): string {
  item = shoppingDefaultQuantity(item);
  const parts = (item.amounts ?? []).map(amount => ingredientAmountLabel(amount, true)).filter(Boolean);
  if (shoppingUnknownCount(item)) parts.push('Cantidad por indicar');
  return parts.join(' + ') || 'Cantidad por indicar';
}
export function shoppingPurchaseReady(items: ShoppingItem[]): boolean {
  return items.length > 0 && items.map(shoppingDefaultQuantity).every(item => !!item.amounts?.length && item.amounts.every(amount => amount.kind !== 'glass' && validIngredientAmount(amount)));
}
