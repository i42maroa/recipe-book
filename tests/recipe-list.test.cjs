const assert = require('node:assert/strict');
const { test } = require('node:test');
const { BehaviorSubject, firstValueFrom, filter, take } = require('rxjs');
const { loadService } = require('./helpers/load-service.cjs');
const ready = (page) => !page.loading;
const gate = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function setup() {
  const state = { calls: [], count: 75, fail: false, hold: null, maxResponse: 1000 };
  const changes = new BehaviorSubject(0);
  const recipes = {
    pageSize: 20, changes$: changes.asObservable(),
    getBatch: async (filters, offset, limit) => {
      state.calls.push({ filters: { ...filters }, offset, limit });
      if (state.hold) { const next = state.hold; state.hold = null; await next; }
      if (state.fail) throw Error('Failed');
      const length = Math.max(0, Math.min(limit, state.maxResponse, state.count - offset));
      return { items: Array.from({ length }, (_, i) => ({ id: 'recipe-' + (offset + i), name: filters.search + (offset + i) })), total: state.count, offset };
    },
  };
  const { RecipeListService } = loadService('src/app/services/recipe-list.service.ts', { RecipeService: recipes, NotificationService: { error() {} } });
  const list = new RecipeListService();
  const connect = () => {
    const pages = [];
    const subscription = list.page$.subscribe((page) => pages.push(page));
    return { pages, subscription, last: () => pages.at(-1) };
  };
  const settled = () => firstValueFrom(list.page$.pipe(filter(ready), take(1)));
  return { list, state, changes, connect, settled };
}

test('returning restores all loaded cards, filters, expanded controls and scroll without a recipe request', async () => {
  const { list, state, connect, settled } = setup();
  list.setFilters({ ...list.filters, search: 'Arroz', pending: 'pending', sort: 'name', mealType: 'Plato', difficulty: 'Media' });
  list.searchInput = 'Arroz'; list.filtersExpanded = true;
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
  assert.equal(list.filtersExpanded, true);
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
