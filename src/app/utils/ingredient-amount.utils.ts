import { AmountRow } from '../models/database.model';
import { RecipeIngredientAmount } from '../models/recipe.model';

export function mapIngredientAmounts<T extends AmountRow>(rows: T[], ingredientId: (row: T) => string): Record<string, RecipeIngredientAmount> {
  const amounts: Record<string, RecipeIngredientAmount> = {};
  for (const row of rows) {
    if (row.amount_kind === 'none') continue;
    amounts[ingredientId(row)] = row.amount_kind === 'specific'
      ? { kind: 'specific', value: row.amount_value === null ? null : Number(row.amount_value), unit: row.amount_unit ?? 'g' }
      : { kind: row.amount_kind };
  }
  return amounts;
}
