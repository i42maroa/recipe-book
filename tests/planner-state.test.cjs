const assert = require('node:assert/strict');
const { test } = require('node:test');
const { BehaviorSubject } = require('rxjs');
const { loadService } = require('./helpers/load-service.cjs');
const searchUtils = loadService('src/app/utils/search.utils.ts', {});
const filterUtils = loadService('src/app/utils/recipe-filters.utils.ts', {}, {}, { './search.utils': searchUtils });

const filters = { search: '', pending: 'all', sort: 'recent', mealType: '', difficulty: '' };
const card = { id: 'recipe-a', name: 'Arroz', servings: 2, pending: true, mealTypes: ['Plato'], ingredientCount: 2, photos: [] };

test('picker cache distinguishes ingredient sets and preserves isolated selections', () => {
  const { service } = setup();
  const selected = { ...filters, ingredientIds: ['tomato', 'lettuce'] };
  service.pickerFilters = selected;
  selected.ingredientIds.push('onion');
  service.pickerFilters.ingredientIds.push('carrot');
  assert.deepEqual(Array.from(service.pickerFilters.ingredientIds), ['tomato', 'lettuce']);
  service.rememberPicker(service.pickerFilters, { items: [card], offset: 1, total: 1 });
  assert.equal(service.pickerPage(filters), undefined);
  assert.equal(service.pickerPage({ ...filters, ingredientIds: ['tomato'] }), undefined);
  assert.equal(service.pickerPage({ ...filters, ingredientIds: ['lettuce', 'tomato', 'tomato'] }).items[0].id, card.id);
});

function setup() {
  const state = { owner: 'user-a', allowed: true, now: Date.now(), reads: 0, hold: null };
  const changes = new BehaviorSubject(0);
  class Clock extends Date { static now() { return state.now; } }
  const { PlannerStateService } = loadService('src/app/services/planner-state.service.ts', {
    AuthService: { user: () => state.owner ? { id: state.owner } : null, canEdit: () => state.allowed },
    DestroyRef: {},
    RecipeService: { changes$: changes, getCardsByIds: async () => { state.reads++; if (state.hold) await state.hold; return [card]; } },
    ScheduledMealService: { recipeSummaries: async () => { state.reads++; return { [card.id]: card }; } },
  }, { Date: Clock }, { '@angular/core/rxjs-interop': { takeUntilDestroyed: () => source => source }, '../utils/recipe-filters.utils': filterUtils });
  return { state, changes, service: new PlannerStateService() };
}

test('returning from a recipe reuses cards and summaries without sharing mutable data', async () => {
  const { state, service } = setup();
  const signal = new AbortController().signal;
  const first = await service.recipeData([card.id], true, signal);
  first.cards[card.id].name = 'Changed locally';
  assert.equal((await service.recipeData([card.id], true, signal)).cards[card.id].name, 'Arroz');
  assert.equal((await service.recipeData([card.id], false, signal)).summaries[card.id].name, 'Arroz');
  assert.equal(state.reads, 1);
  state.now += 300_001;
  await service.recipeData([card.id], true, signal);
  assert.equal(state.reads, 2);
});

test('recipe edits invalidate metadata and selector pages, but preserve selected filters', async () => {
  const { state, changes, service } = setup();
  service.pickerFilters = { ...filters, search: 'arroz' };
  service.rememberPicker(filters, { items: [card], offset: 1, total: 1 });
  await service.recipeData([card.id], true, new AbortController().signal);
  changes.next(1);
  assert.equal(service.pickerPage(filters), undefined);
  assert.equal(service.pickerFilters.search, 'arroz');
  await service.recipeData([card.id], true, new AbortController().signal);
  assert.equal(state.reads, 2);
});

test('selector filters and loaded pages survive reopening with bounded, expiring snapshots', () => {
  const { state, service } = setup();
  service.pickerFilters = { ...filters, search: 'arroz' };
  service.rememberPicker(filters, { items: [card], offset: 1, total: 1 });
  const page = service.pickerPage(filters);
  page.items.length = 0;
  assert.equal(service.pickerPage(filters).items.length, 1);
  assert.equal(service.pickerFilters.search, 'arroz');
  for (let n = 0; n < 9; n++) service.rememberPicker({ ...filters, search: String(n) }, { items: [], offset: 0, total: 0 });
  assert.equal(service.pickerPage(filters), undefined);
  assert.ok(service.pickerPage({ ...filters, search: '8' }));
  state.now += 300_001;
  assert.equal(service.pickerPage({ ...filters, search: '8' }), undefined);
});

test('owner changes and permission revocation clear all private navigation state', async () => {
  const { state, service } = setup();
  const signal = new AbortController().signal;
  await service.recipeData([card.id], true, signal);
  service.pickerFilters = { ...filters, search: 'private' };
  service.rememberPicker(filters, { items: [card], offset: 1, total: 1 });
  state.owner = 'user-b';
  assert.equal(service.pickerPage(filters), undefined);
  assert.equal(service.pickerFilters.search, '');
  await service.recipeData([card.id], true, signal);
  assert.equal(state.reads, 2);
  state.allowed = false;
  await assert.rejects(service.recipeData([card.id], true, signal), /sesión/);
});

test('late metadata responses cannot repopulate invalidated or cancelled caches', async () => {
  for (const reason of ['edit', 'abort', 'owner']) {
    const { state, changes, service } = setup();
    let release; state.hold = new Promise(resolve => { release = resolve; });
    const controller = new AbortController();
    const pending = service.recipeData([card.id], true, controller.signal);
    if (reason === 'edit') changes.next(1);
    if (reason === 'abort') controller.abort();
    if (reason === 'owner') state.owner = 'user-b';
    release();
    await assert.rejects(pending);
    state.hold = null;
    await service.recipeData([card.id], true, new AbortController().signal);
    assert.equal(state.reads, 2);
  }
});
