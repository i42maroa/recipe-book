import { InventoryItem, InventoryPlace, InventorySpace } from '../models/inventory.model';
import { RecipeCard } from '../models/recipe-card.model';
import { normalizeSearch } from './search.utils';

export interface PlannerInventoryLot { item: InventoryItem; recipe: RecipeCard | undefined }
export interface PlannerInventoryPlace {
  id: string;
  name: string;
  spaces: { id: InventorySpace; label: string; lots: PlannerInventoryLot[] }[];
}

export interface PlannerInventoryIngredient {
  id: string;
  name: string;
  items: InventoryItem[];
  locations: { placeId: string; name: string; space: InventorySpace }[];
}

/** Only ingredient references actually held in stock can become recipe filters. */
export function plannerInventoryIngredients(places: InventoryPlace[], search = ''): PlannerInventoryIngredient[] {
  const ingredients = new Map<string, PlannerInventoryIngredient>();
  for (const place of places) for (const item of place.items) {
    if (!item.ingredientId || item.recipeId) continue;
    const id = item.ingredientId.toLowerCase();
    let ingredient = ingredients.get(id);
    if (!ingredient) { ingredient = { id, name: item.name, items: [], locations: [] }; ingredients.set(id, ingredient); }
    ingredient.items.push(item);
    if (!ingredient.locations.some(location => location.placeId === place.id && location.space === item.space)) {
      ingredient.locations.push({ placeId: place.id, name: place.name, space: item.space });
    }
  }
  const query = normalizeSearch(search);
  return [...ingredients.values()].filter(ingredient => !query || ingredient.items.some(item => normalizeSearch(item.name).includes(query)))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Read-only view: retain each prepared lot and its actual place, space and portions. */
export function plannerInventoryGroups(places: InventoryPlace[], cards: Record<string, RecipeCard>,
  search = '', placeId = '', space: InventorySpace | '' = ''): PlannerInventoryPlace[] {
  const query = normalizeSearch(search);
  const spaces: { id: InventorySpace; label: string }[] = [{ id: 'pantry', label: 'Alacena' }, { id: 'freezer', label: 'Congelador' }];
  return places.filter(place => !placeId || place.id === placeId).flatMap(place => {
    const groups = spaces.filter(value => !space || value.id === space).flatMap(value => {
      const lots = place.items.filter(item => item.recipeId && item.space === value.id)
        .map(item => ({ item, recipe: cards[item.recipeId!.toLowerCase()] }))
        .filter(({ item, recipe }) => !query || [item.name, recipe?.name ?? ''].some(name => normalizeSearch(name).includes(query)))
        .sort((a, b) => a.item.enteredOn.localeCompare(b.item.enteredOn) || a.item.id.localeCompare(b.item.id));
      return lots.length ? [{ ...value, lots }] : [];
    });
    return groups.length ? [{ id: place.id, name: place.name, spaces: groups }] : [];
  });
}
