const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Subject, BehaviorSubject } = require('rxjs');
const { TestScheduler } = require('rxjs/testing');
const { loadService } = require('./helpers/load-service.cjs');

const search = loadService('src/app/utils/search.utils.ts', {});
const ingredients = loadService('src/app/utils/ingredient-search.utils.ts', {}, {}, { './search.utils': search });
const recipe = loadService('src/app/utils/recipe-filters.utils.ts', {}, {}, { './search.utils': search });

function control(value) {
  const changes = new Subject();
  return { value, valueChanges: changes, set(value) { this.value = value; changes.next(value); } };
}
function controls() { return { search: control(''), sort: control('recent'), mealType: control(''), difficulty: control(''), ingredientIds: control([]) }; }

test('status selection switches between all, done and pending without clearing other filters', () => {
  const c = controls();
  c.ingredientIds.value = ['tomato'];
  c.difficulty.value = 'Fácil';
  const pending = new BehaviorSubject('all');
  const seen = [];
  const subscription = recipe.recipeFilterChanges(c, { pending }).subscribe(value => seen.push(value));
  for (const status of ['done', 'pending', 'all']) pending.next(status);
  assert.deepEqual(seen.map(value => value.pending), ['all', 'done', 'pending', 'all']);
  for (const value of seen) {
    assert.equal(value.difficulty, 'Fácil');
    assert.deepEqual(Array.from(value.ingredientIds), ['tomato']);
  }
  assert.notEqual(recipe.recipeFilterKey(seen[0]), recipe.recipeFilterKey(seen[1]));
  subscription.unsubscribe();
});

test('search normalization and minimum length treat whitespace, accents and casing consistently', () => {
  assert.equal(search.normalizeSearch('  PÍMÍENTO  '), 'pimiento');
  assert.equal(search.isCompleteSearch(' a '), false);
  assert.equal(search.isCompleteSearch('  '), true);
  assert.equal(search.isCompleteSearch('ar'), true);
});

test('ingredient names are normalized once per index, with Map lookups and Set exclusions', () => {
  let calls = 0;
  const indexed = loadService('src/app/utils/ingredient-search.utils.ts', {}, {}, {
    './search.utils': { normalizeSearch(value) { calls++; return search.normalizeSearch(value); } },
  });
  const items = [{ id: 'a', name: 'Pimiento', category: 'Verdura' }, { id: 'b', name: 'PIMIENTÓ', category: 'Elaboracion' }];
  const index = indexed.indexIngredients(items);
  assert.equal(calls, 2);
  assert.equal(index.byId.get('a'), items[0]);
  assert.equal(index.byName.get('pimiento'), items[0]);
  assert.deepEqual(Array.from(indexed.findIngredients(index, 'míen', { excludedIds: new Set(['b']) })), [items[0]]);
  assert.equal(calls, 3); // Only the query is normalized on subsequent searches.
  assert.deepEqual(Array.from(indexed.findIngredients(index, '', { excludeElaborations: true })), [items[0]]);
  assert.equal(calls, 4);
  assert.equal(ingredients.indexIngredients([]).byId.size, 0);
});

test('shared recipe filtering debounces search and deduplicates equivalent ingredient sets', () => {
  new TestScheduler(() => {}).run(({ flush }) => {
    const c = controls(); const seen = [];
    const subscription = recipe.recipeFilterChanges(c).subscribe(value => seen.push(value));
    assert.equal(seen.length, 1);
    c.ingredientIds.set(['a', 'b']); c.ingredientIds.set(['b', 'a', 'b']);
    assert.equal(seen.length, 2);
    c.search.set(' ar '); c.search.set(' arroz ');
    assert.equal(seen.length, 2);
    flush();
    assert.equal(seen.length, 3);
    assert.equal(seen.at(-1).search, 'arroz');
    subscription.unsubscribe();
  });
});

test('list filtering keeps the last complete term, clears once and cancels pending searches on reset', () => {
  new TestScheduler(() => {}).run(({ flush }) => {
    const c = controls(); c.search.value = 'Arroz'; const pending = new BehaviorSubject('all'); const seen = [];
    let subscription = recipe.recipeFilterChanges(c, { pending, ignoreIncomplete: true }).subscribe(value => seen.push(value));
    c.search.set('a'); flush(); assert.equal(seen.at(-1).search, 'Arroz');
    c.search.set('Tarta'); subscription.unsubscribe();
    c.search.value = ''; c.mealType.value = ''; c.ingredientIds.value = [];
    subscription = recipe.recipeFilterChanges(c, { pending, ignoreIncomplete: true }).subscribe(value => seen.push(value));
    const count = seen.length; flush();
    assert.equal(seen.length, count); assert.equal(seen.at(-1).search, '');
    subscription.unsubscribe();
  });
});

test('picker filtering emits incomplete input and restores results when returning to the previous term', () => {
  new TestScheduler(() => {}).run(({ flush }) => {
    const c = controls(); c.search.value = 'Arroz'; const seen = [];
    const subscription = recipe.recipeFilterChanges(c, { deduplicate: false }).subscribe(value => seen.push(value));
    c.search.set('a'); flush(); assert.equal(seen.at(-1).search, 'a');
    c.search.set('otra'); c.search.set('Arroz'); flush();
    assert.equal(seen.at(-1).search, 'Arroz');
    c.search.set(' Arroz '); flush(); assert.equal(seen.at(-1).search, 'Arroz');
    assert.equal(seen.length, 4);
    subscription.unsubscribe();
  });
});
