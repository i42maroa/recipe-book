import { Ingredient, IngredientMeasures, RecipeIngredientAmount } from '../models/recipe.model';

export const SPICE_SPOON_GRAMS = 5;
export const positiveQuantity = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function validIngredientMeasures(value: unknown): value is IngredientMeasures {
  if (!value || typeof value !== 'object') return false;
  const measures = value as IngredientMeasures;
  return ['g', 'ml'].includes(measures.baseUnit) && (measures.unitQuantity === null || positiveQuantity(measures.unitQuantity));
}

export function ingredientBaseUnit(ingredient?: Ingredient): 'g' | 'ml' {
  return ingredient?.baseUnit ?? (ingredient?.category === 'Liquidos' ? 'ml' : 'g');
}

export function canonicalAmount(amount: RecipeIngredientAmount | null): object | null {
  if (!amount) return null;
  if (amount.kind === 'specific') return { kind: amount.kind, value: amount.value, unit: amount.unit,
    ...(amount.baseUnit !== undefined ? { baseUnit: amount.baseUnit } : {}),
    ...(amount.unitQuantity !== undefined ? { unitQuantity: amount.unitQuantity } : {}) };
  return amount.kind === 'spoon' && amount.value !== undefined ? { kind: 'spoon', value: amount.value } : { kind: amount.kind };
}

export function validIngredientAmount(amount: RecipeIngredientAmount | null): boolean {
  if (amount === null) return true;
  if (!amount || typeof amount !== 'object') return false;
  if (amount.kind === 'glass') return true; // Historical values remain readable.
  if (amount.kind === 'spoon') return amount.value === undefined || positiveQuantity(amount.value);
  return amount.kind === 'specific' && positiveQuantity(amount.value) && ['g', 'ml', 'pieza'].includes(amount.unit)
    && ((amount.baseUnit === undefined && amount.unitQuantity === undefined)
      || (amount.unit === 'pieza' && ['g', 'ml'].includes(amount.baseUnit ?? '') && positiveQuantity(amount.unitQuantity)));
}

export function measuredAmount(unit: 'g' | 'ml' | 'pieza' | 'spoon', value: number | null, ingredient?: Ingredient,
  previous?: RecipeIngredientAmount | null): RecipeIngredientAmount {
  if (unit === 'spoon') return { kind: 'spoon', value };
  if (unit !== 'pieza') return { kind: 'specific', value, unit };
  if (previous?.kind === 'specific' && previous.unit === 'pieza' && previous.baseUnit && previous.unitQuantity) return { ...previous, value };
  return { kind: 'specific', value, unit, ...(positiveQuantity(ingredient?.unitQuantity)
    ? { baseUnit: ingredientBaseUnit(ingredient), unitQuantity: ingredient!.unitQuantity! } : {}) };
}

const quantityLabel = (value: number): string => new Intl.NumberFormat('es', { maximumSignificantDigits: 15 }).format(value);

export function ingredientAmountLabel(amount: RecipeIngredientAmount | null | undefined, equivalents = false, ingredient?: Ingredient): string | null {
  if (!amount) return null;
  if (amount.kind === 'glass') return '1 vaso';
  if (amount.kind === 'spoon') {
    const value = amount.value === undefined ? 1 : amount.value;
    if (!positiveQuantity(value)) return null;
    return `${quantityLabel(value)} ${value === 1 ? 'cucharada' : 'cucharadas'}${equivalents && ingredient?.category === 'Especia' ? ` (${quantityLabel(value * SPICE_SPOON_GRAMS)} g)` : ''}`;
  }
  if (!positiveQuantity(amount.value)) return null;
  const label = `${quantityLabel(amount.value)} ${amount.unit === 'pieza' ? amount.value === 1 ? 'unidad' : 'unidades' : amount.unit}`;
  const conversion = amount.unitQuantity ?? ingredient?.unitQuantity;
  const base = amount.baseUnit ?? ingredientBaseUnit(ingredient);
  return label + (equivalents && amount.unit === 'pieza' && positiveQuantity(conversion) && Number.isFinite(amount.value * conversion)
    ? ` (${quantityLabel(amount.value * conversion)} ${base})` : '');
}

/** Preserve the original amount when editing unrelated fields of a legacy record. */
export function allowedIngredientAmount(amount: RecipeIngredientAmount | null, ingredient: Ingredient | undefined,
  original?: RecipeIngredientAmount | null): boolean {
  if (!validIngredientAmount(amount)) return false;
  if (!amount || JSON.stringify(amount) === JSON.stringify(original)) return true;
  if (original && amount.kind !== 'glass' && original.kind !== 'glass') {
    const withoutValue = (value: RecipeIngredientAmount): string => { const shape = canonicalAmount(value) as Record<string, unknown>; delete shape['value']; return JSON.stringify(shape); };
    const previousValue = original.kind === 'spoon' ? original.value ?? 1 : original.value;
    const nextValue = amount.kind === 'spoon' ? amount.value ?? 1 : amount.value;
    if (withoutValue(amount) === withoutValue(original) && positiveQuantity(nextValue) && positiveQuantity(previousValue) && nextValue <= previousValue) return true;
  }
  if (amount.kind === 'glass') return false;
  if (amount.kind === 'spoon') return ingredient?.category === 'Especia';
  if (!ingredient) return true; // Free products have no catalogue configuration.
  if (amount.unit !== 'pieza') return amount.unit === ingredientBaseUnit(ingredient);
  return positiveQuantity(ingredient.unitQuantity)
    || (original?.kind === 'specific' && original.unit === 'pieza' && positiveQuantity(original.unitQuantity)
      && original.unitQuantity === amount.unitQuantity && original.baseUnit === amount.baseUnit);
}
