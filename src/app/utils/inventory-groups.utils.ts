import { InventoryItem } from '../models/inventory.model';
import { INGREDIENT_CATEGORIES, IngredientCategory } from '../models/recipe.model';
import { normalizeSearch } from './search.utils';
import { ingredientAmountLabel } from './ingredient-measures.utils';

export interface InventoryItemGroup {
  id: string;
  item: InventoryItem;
  items: InventoryItem[];
}

/** Sum each measure independently; never replace or merge dated lots. */
export function inventoryGroupTotal(items: InventoryItem[]): string {
  const totals = new Map<string, number>();
  let unmeasured = 0;
  for (const item of items) {
    const key = item.recipeId ? 'servings' : item.amount?.kind === 'specific' ? item.amount.unit : item.amount?.kind ?? 'none';
    const value = item.recipeId ? item.servings! : item.amount?.kind === 'specific' ? item.amount.value!
      : item.amount?.kind === 'spoon' ? item.amount.value ?? 1 : item.amount?.kind === 'glass' ? 1 : 0;
    if (key === 'none') { unmeasured++; continue; }
    totals.set(key, (totals.get(key) ?? 0) + value);
  }
  const labels = [...totals].map(([unit, total]) => {
    if (!Number.isFinite(total)) return 'Cantidad total fuera de rango';
    const value = Number(total.toPrecision(15));
    if (unit === 'servings') return `${value} ${value === 1 ? 'ración' : 'raciones'}`;
    if (unit === 'glass') return `${value} ${value === 1 ? 'vaso' : 'vasos'}`;
    return ingredientAmountLabel(unit === 'spoon' ? { kind: 'spoon', value } : { kind: 'specific', value, unit: unit as 'g' | 'ml' | 'pieza' })!;
  });
  if (unmeasured) labels.push(totals.size ? `${unmeasured} ${unmeasured === 1 ? 'registro sin cantidad' : 'registros sin cantidad'}` : 'Sin cantidad');
  return labels.join(' + ');
}

type InventoryCategory = IngredientCategory | 'recipes' | 'products';
export interface InventoryCategoryGroup {
  id: InventoryCategory;
  label: string;
  groups: InventoryItemGroup[];
}

const CATEGORY_LABELS: Record<InventoryCategory, string> = {
  Verdura: 'Verduras', Fruta: 'Frutas', Legumbre: 'Legumbres', Pescado: 'Pescados', Carne: 'Carnes',
  Lacteo: 'Lácteos', Cereal: 'Cereales', Liquidos: 'Líquidos', FrutosSecos: 'Frutos secos',
  Especia: 'Especias', Elaboracion: 'Elaboraciones', Otro: 'Otros',
  recipes: 'Recetas preparadas', products: 'Productos libres',
};

/** Category blocks keep the chosen order of their element groups. */
export function categorizeInventoryGroups(groups: InventoryItemGroup[]): InventoryCategoryGroup[] {
  const categories = new Map<InventoryCategory, InventoryItemGroup[]>();
  for (const group of groups) {
    const category = group.item.recipeId ? 'recipes' : group.item.category ?? 'products';
    const entries = categories.get(category);
    if (entries) entries.push(group);
    else categories.set(category, [group]);
  }
  return [...INGREDIENT_CATEGORIES, 'recipes', 'products'].flatMap(id => {
    const entries = categories.get(id as InventoryCategory);
    return entries ? [{ id: id as InventoryCategory, label: CATEGORY_LABELS[id as InventoryCategory], groups: entries }] : [];
  });
}

/** Group only the presentation; every dated lot keeps its identity and quantity. */
export function groupInventoryItems(items: InventoryItem[]): InventoryItemGroup[] {
  const groups = new Map<string, InventoryItemGroup>();
  for (const item of items) {
    const identity = item.recipeId ? `recipe:${item.recipeId.toLowerCase()}`
      : item.ingredientId ? `ingredient:${item.ingredientId.toLowerCase()}` : `product:${normalizeSearch(item.name)}`;
    const id = `${item.space}:${identity}`;
    const group = groups.get(id);
    if (group) group.items.push(item);
    else groups.set(id, { id, item, items: [item] });
  }
  return [...groups.values()];
}
