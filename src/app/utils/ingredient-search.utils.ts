import { Ingredient, IngredientCategory } from '../models/recipe.model';
import { normalizeSearch } from './search.utils';

export interface IngredientIndex {
  ingredients: Ingredient[];
  entries: { ingredient: Ingredient; name: string }[];
  byId: Map<string, Ingredient>;
  byName: Map<string, Ingredient>;
}

/** Build once when the catalog changes, rather than for every search keystroke. */
export function indexIngredients(ingredients: Ingredient[]): IngredientIndex {
  const entries = ingredients.map(ingredient => ({ ingredient, name: normalizeSearch(ingredient.name) }));
  const byName = new Map<string, Ingredient>();
  for (const entry of entries) if (!byName.has(entry.name)) byName.set(entry.name, entry.ingredient);
  return { ingredients, entries, byId: new Map(ingredients.map(item => [item.id, item])), byName };
}

export function findIngredients(index: IngredientIndex, query: string, options: {
  category?: IngredientCategory | ''; excludedIds?: ReadonlySet<string>; excludeElaborations?: boolean;
} = {}): Ingredient[] {
  const name = normalizeSearch(query);
  return index.entries.filter(entry => (!name || entry.name.includes(name))
    && (!options.category || entry.ingredient.category === options.category)
    && !options.excludedIds?.has(entry.ingredient.id)
    && (!options.excludeElaborations || entry.ingredient.category !== 'Elaboracion'))
    .map(entry => entry.ingredient);
}
