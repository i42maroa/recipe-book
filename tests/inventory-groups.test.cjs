const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadService } = require('./helpers/load-service.cjs');
const measures = loadService('src/app/utils/ingredient-measures.utils.ts', {});
const search = loadService('src/app/utils/search.utils.ts', {});
const model = loadService('src/app/models/recipe.model.ts', {});
const { groupInventoryItems, categorizeInventoryGroups } = loadService('src/app/utils/inventory-groups.utils.ts', {}, {}, {
  './ingredient-measures.utils': measures, './search.utils': search, '../models/recipe.model': model,
});
const plain = value => JSON.parse(JSON.stringify(value));
const tomato = { id: 'lot-12', ingredientId: 'ABC', recipeId: null, name: 'Tomate natural', category: 'Verdura',
  enteredOn: '2026-10-12', arrivedOn: '2026-10-12', space: 'pantry', amount: { kind: 'specific', value: 500, unit: 'g' }, servings: null };

test('repeated ingredients appear once with independent dates, quantities, units and identifiers', () => {
  const later = { ...tomato, id: 'lot-16', ingredientId: 'abc', enteredOn: '2026-10-16', arrivedOn: '2026-10-16', amount: { kind: 'specific', value: 2, unit: 'pieza' } };
  const input = [tomato, later]; const original = structuredClone(input);
  const groups = groupInventoryItems(input);
  assert.equal(groups.length, 1); assert.equal(groups[0].item.name, 'Tomate natural');
  assert.deepEqual(plain(groups[0].items), original);
  assert.equal(groups[0].items[0], tomato); assert.equal(groups[0].items[1], later);
  assert.deepEqual(input, original);
});

test('ingredients, recipes and free products with identical names remain distinct, including spaces', () => {
  const recipe = { ...tomato, id: 'recipe-lot', ingredientId: null, recipeId: 'ABC', category: null, amount: null, servings: 2 };
  const product = { ...tomato, id: 'product-lot', ingredientId: null, category: null };
  const freezer = { ...tomato, id: 'freezer-lot', space: 'freezer' };
  const groups = groupInventoryItems([tomato, recipe, product, freezer]);
  assert.equal(groups.length, 4);
  assert.equal(new Set(groups.map(group => group.id)).size, 4);
  assert.deepEqual(plain(groups.map(group => group.items.map(item => item.id))), [['lot-12'], ['recipe-lot'], ['product-lot'], ['freezer-lot']]);
});

test('grouping follows the input order and retains renamed recipe snapshots and separate portions', () => {
  const recipe = { ...tomato, id: 'recipe-old', ingredientId: null, recipeId: 'DEF', category: null, amount: null, servings: 2 };
  const renamed = { ...recipe, id: 'recipe-new', recipeId: 'def', name: 'Tomate preparado', servings: 3 };
  const groups = groupInventoryItems([recipe, tomato, renamed]);
  assert.deepEqual(plain(groups.map(group => group.item.id)), ['recipe-old', 'lot-12']);
  assert.deepEqual(plain(groups[0].items.map(item => [item.name, item.servings])), [['Tomate natural', 2], ['Tomate preparado', 3]]);
  const newest = groupInventoryItems([renamed, tomato, recipe]);
  assert.equal(newest[0].item.name, 'Tomate preparado'); assert.equal(newest[0].items[1].servings, 2);
});

test('free products group by normalized names without combining their records or quantities', () => {
  const first = { ...tomato, ingredientId: null, category: null, name: 'Puré casero' };
  const second = { ...first, id: 'second', name: ' PURE CASERO ', amount: null };
  const groups = groupInventoryItems([first, second]);
  assert.equal(groups.length, 1); assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].items[0].amount.value, 500); assert.equal(groups[0].items[1].amount, null);
  assert.deepEqual(plain(groupInventoryItems([])), []);
});

test('category blocks collect all spices and keep preparations, recipes and free products separate', () => {
  const items = [
    { ...tomato, id: 'spice-1', ingredientId: 'spice-1', name: 'Comino', category: 'Especia' },
    { ...tomato, id: 'recipe', ingredientId: null, recipeId: 'recipe', amount: null, category: null, servings: 2 },
    tomato,
    { ...tomato, id: 'spice-2', ingredientId: 'spice-2', name: 'Pimentón', category: 'Especia' },
    { ...tomato, id: 'preparation', ingredientId: 'preparation', name: 'Salsa', category: 'Elaboracion' },
    { ...tomato, id: 'free', ingredientId: null, category: null },
  ];
  const categories = categorizeInventoryGroups(groupInventoryItems(items));
  assert.deepEqual(plain(categories.map(category => category.label)), ['Verduras', 'Especias', 'Elaboraciones', 'Recetas preparadas', 'Productos libres']);
  assert.deepEqual(plain(categories[1].groups.map(group => group.item.name)), ['Comino', 'Pimentón']);
  assert.equal(categories[2].groups[0].item.name, 'Salsa');
});

test('category blocks preserve element ordering and dated lots without empty categories', () => {
  const later = { ...tomato, id: 'later', enteredOn: '2026-10-16' };
  const categories = categorizeInventoryGroups(groupInventoryItems([later, tomato]));
  assert.equal(categories.length, 1); assert.equal(categories[0].id, 'Verdura');
  assert.deepEqual(plain(categories[0].groups[0].items.map(item => item.id)), ['later', 'lot-12']);
  assert.deepEqual(plain(categorizeInventoryGroups([])), []);
});
