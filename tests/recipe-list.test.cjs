const assert = require('node:assert/strict');
const { test } = require('node:test');
const { BehaviorSubject, firstValueFrom, filter, take } = require('rxjs');
const { loadService } = require('./helpers/load-service.cjs');
const searchUtils = loadService('src/app/utils/search.utils.ts', {});
const filterUtils = loadService('src/app/utils/recipe-filters.utils.ts', {}, {}, { './search.utils': searchUtils });
const ready = (page) => !page.loading;
const gate = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test('ingredient selections reset pagination, survive navigation and clear as one update', async () => {
  const { list, state, connect, settled } = setup();
  const first = connect(); await settled();
  list.loadMore(); await settled();
  list.setFilters({ ...list.filters, ingredientIds: ['tomato', 'lettuce'] }); await settled();
  assert.equal(first.last().items.length, 20);
  assert.equal(state.calls.at(-1).offset, 0);
  first.subscription.unsubscribe();
  const count = state.calls.length;
  const back = connect(); await settled();
  assert.equal(state.calls.length, count);
  assert.deepEqual(Array.from(list.filters.ingredientIds), ['tomato', 'lettuce']);
  list.setFilters({ ...list.filters, ingredientIds: [] }); await settled();
  assert.equal(state.calls.length, count + 1);
  back.subscription.unsubscribe();
});

test('ingredient filter state is isolated from callers and selection order does not refetch', async () => {
  const { list, state, connect, settled } = setup();
  const ids = ['tomato', 'lettuce'];
  list.setFilters({ ...list.filters, ingredientIds: ids });
  ids.push('onion');
  list.filters.ingredientIds.push('carrot');
  assert.deepEqual(Array.from(list.filters.ingredientIds), ['tomato', 'lettuce']);
  const first = connect(); await settled();
  const count = state.calls.length;
  list.setFilters({ ...list.filters, ingredientIds: ['lettuce', 'tomato'] }); await settled();
  assert.equal(state.calls.length, count);
  first.subscription.unsubscribe();
});

function setup() {
  const state = { calls: [], errors: [], count: 75, fail: false, hold: null, maxResponse: 1000 };
  const changes = new BehaviorSubject(0);
  const recipes = {
    pageSize: 20, changes$: changes.asObservable(),
    getBatch: async (filters, offset, limit, signal) => {
      state.calls.push({ filters: { ...filters }, offset, limit, signal });
      if (state.hold) { const next = state.hold; state.hold = null; await next; }
      if (state.fail) throw Error('Failed');
      const length = Math.max(0, Math.min(limit, state.maxResponse, state.count - offset));
      return { items: Array.from({ length }, (_, i) => ({ id: 'recipe-' + (offset + i), name: filters.search + (offset + i) })), total: state.count, offset };
    },
  };
  const { RecipeListService } = loadService('src/app/services/recipe-list.service.ts', { RecipeService: recipes, NotificationService: { error(message) { state.errors.push(message); } } }, {}, { '../utils/recipe-filters.utils': filterUtils });
  const list = new RecipeListService();
  const connect = () => {
    const pages = [];
    const subscription = list.page$.subscribe((page) => pages.push(page));
    return { pages, subscription, last: () => pages.at(-1) };
  };
  const settled = () => firstValueFrom(list.page$.pipe(filter(ready), take(1)));
  return { list, state, changes, connect, settled };
}

test('returning restores all loaded cards, filters and scroll without a recipe request', async () => {
  const { list, state, connect, settled } = setup();
  list.setFilters({ ...list.filters, search: 'Arroz', pending: 'pending', sort: 'name', mealType: 'Plato', difficulty: 'Media' });
  list.searchInput = 'Arroz';
  const first = connect(); await settled();
  list.loadMore(); await settled();
  list.loadMore(); await settled();
  assert.equal(first.last().items.length, 40);
  list.scrollPosition = [0, 1700];
  first.subscription.unsubscribe(); state.calls.length = 0;
  const back = connect();
  assert.equal(back.last().items.length, 40);
  assert.equal(back.last().nextOffset, 40);
  assert.equal(back.last().loading, false);
  assert.equal(list.filters.search, 'Arroz');
  assert.equal(list.searchInput, 'Arroz');
  assert.equal(list.filters.pending, 'pending');
  assert.equal(list.filters.sort, 'name');
  assert.equal(list.scrollPosition[1], 1700);
  assert.equal(state.calls.length, 0);
  list.loadMore(); await settled();
  assert.equal(state.calls[0].offset, 40);
  assert.equal(back.last().items.length, 50);
  back.subscription.unsubscribe();
});

test('editing while away refreshes the loaded window on return and retains filters', async () => {
  const { list, state, changes, connect, settled } = setup();
  const first = connect(); await settled();
  list.loadMore(); await settled();
  first.subscription.unsubscribe(); state.calls.length = 0;
  changes.next(1); assert.equal(state.calls.length, 0);
  state.count = 27;
  const back = connect(); await settled();
  assert.equal(state.calls[0].offset, 0);
  assert.equal(state.calls[0].limit, 30);
  assert.equal(back.last().items.length, 27);
  assert.equal(back.last().total, 27);
  back.subscription.unsubscribe();
});

test('changing filters resets pagination and ignores a late response for the old filters', async () => {
  const { list, state, connect, settled } = setup();
  const first = connect(); await settled();
  const held = gate(); state.hold = held.promise;
  list.loadMore();
  list.scrollPosition = [0, 1000];
  list.setFilters({ ...list.filters, search: 'Tarta' });
  await settled(); held.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(first.last().items.length, 20);
  assert.equal(first.last().items[0].name, 'Tarta0');
  assert.equal(list.scrollPosition[1], 0);
  first.subscription.unsubscribe();
});

test('a failed extra page keeps existing cards and retries the same offset', async () => {
  const { list, state, connect, settled } = setup();
  const first = connect(); await settled();
  state.fail = true; list.loadMore(); await settled();
  assert.equal(first.last().error, true);
  assert.equal(first.last().items.length, 20);
  state.fail = false; list.loadMore(); await settled();
  assert.equal(state.calls.at(-1).offset, 20);
  assert.equal(first.last().items.length, 30);
  first.subscription.unsubscribe();
});

test('an interrupted load never replaces the saved list after leaving', async () => {
  const { list, state, connect, settled } = setup();
  const first = connect(); await settled();
  const held = gate(); state.hold = held.promise;
  list.loadMore(); first.subscription.unsubscribe();
  held.resolve(); await Promise.resolve(); await Promise.resolve();
  state.calls.length = 0;
  const back = connect();
  assert.equal(back.last().items.length, 20);
  assert.equal(back.last().loading, false);
  assert.equal(state.calls.length, 0);
  back.subscription.unsubscribe();
});

test('refreshing a saved window handles an API response limit smaller than the visible count', async () => {
  const { list, state, changes, connect, settled } = setup();
  const first = connect(); await settled();
  list.loadMore(); await settled(); list.loadMore(); await settled();
  first.subscription.unsubscribe(); changes.next(1);
  state.calls.length = 0; state.maxResponse = 15;
  const back = connect(); await settled();
  assert.equal(back.last().items.length, 40);
  assert.deepEqual(state.calls.map((call) => call.offset), [0, 15, 30]);
  back.subscription.unsubscribe();
});

test('filter changes abort the previous batch without clearing the new results or notifying an error', async () => {
  const { list, state, connect, settled } = setup();
  const first = connect(); await settled();
  const held = gate(); state.hold = held.promise;
  list.loadMore(); const oldSignal = state.calls.at(-1).signal;
  assert.equal(oldSignal.aborted, false);
  list.setFilters({ ...list.filters, search: 'Tarta' });
  assert.equal(oldSignal.aborted, true);
  await settled(); held.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(first.last().items[0].name, 'Tarta0');
  assert.deepEqual(state.errors, []);
  first.subscription.unsubscribe();
});

test('a shared pending request is aborted only after the last subscriber leaves', async () => {
  const { state, connect } = setup();
  const held = gate(); state.hold = held.promise;
  const first = connect(), second = connect();
  const signal = state.calls.at(-1).signal;
  first.subscription.unsubscribe(); assert.equal(signal.aborted, false);
  second.subscription.unsubscribe(); assert.equal(signal.aborted, true);
  held.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(state.errors, []);
});

test('an abandoned multi-batch refresh does not request further obsolete pages', async () => {
  const { list, state, changes, connect, settled } = setup();
  const first = connect(); await settled(); list.loadMore(); await settled(); list.loadMore(); await settled();
  state.calls.length = 0; state.maxResponse = 15;
  const held = gate(); state.hold = held.promise;
  changes.next(1);
  const oldSignal = state.calls[0].signal;
  list.setFilters({ ...list.filters, search: 'Nueva' });
  assert.equal(oldSignal.aborted, true);
  await settled(); held.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(state.calls.filter(call => call.filters.search === '').length, 1);
  assert.equal(first.last().items[0].name, 'Nueva0');
  assert.deepEqual(state.errors, []);
  first.subscription.unsubscribe();
});

test('completed requests are not aborted when leaving a cached list', async () => {
  const { state, connect, settled } = setup();
  const first = connect(); await settled();
  const signal = state.calls[0].signal;
  first.subscription.unsubscribe();
  assert.equal(signal.aborted, false);
});
