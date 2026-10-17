import { Ingredient, IngredientCategory } from '../models/recipe.model';

export function groupIngredients(ingredients: Ingredient[], categoryOrder?: IngredientCategory[]): { category: IngredientCategory; ingredients: Ingredient[] }[] {
  const groups = new Map<IngredientCategory, Ingredient[]>();
  for (const ingredient of ingredients) {
    const group = groups.get(ingredient.category);
    if (group) group.push(ingredient);
    else groups.set(ingredient.category, [ingredient]);
  }
  return (categoryOrder ?? [...groups.keys()]).flatMap((category) => {
    const items = groups.get(category);
    return items ? [{ category, ingredients: items }] : [];
  });
}

export function selectedIngredients(ingredients: Ingredient[], ids: string[]): Ingredient[] {
  const byId = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  return ids.map((id) => byId.get(id)).filter((ingredient): ingredient is Ingredient => ingredient !== undefined);
}
