const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadService } = require('./helpers/load-service.cjs');
const search = loadService('src/app/utils/search.utils.ts', {});
const index = loadService('src/app/utils/ingredient-search.utils.ts', {}, {}, { './search.utils': search });
const amounts = loadService('src/app/utils/ingredient-amount.utils.ts', {});
const { LoadingService } = loadService('src/app/services/loading.service.ts', {});
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function setup(size = 7) {
  const state = { calls: [], cap: 3, count: true, failOffset: null, hold: null, holdDetail: null, failDetail: false };
  state.rows = Array.from({ length: size }, (_, n) => ({ id: `ingredient-${String(n).padStart(4, '0')}`, name: `Ingrediente ${n}`, category: 'Verdura',
    ingredient_components: n === 0 && size > 1 ? [{ component_ingredient_id: 'ingredient-0001', amount_kind: 'specific', amount_value: 25, amount_unit: 'g' }] : [],
  }));
  const supabase = { configured: true, requireClient: () => ({
    async rpc(name, args) {
      assert.equal(name, 'save_ingredient');
      const row = { id: args.p_id, name: args.p_name, category: args.p_category, ingredient_components: [] };
      state.rows = [...state.rows.filter(item => item.id !== args.p_id), row];
      return { error: null };
    },
    from(table) {
    assert.equal(table, 'ingredients');
    const call = { selection: '', options: null, offset: 0, end: 0, orders: [], id: null, deletion: false };
    return {
      select(selection, options) { call.selection = selection; call.options = options; return this; },
      order(field) { call.orders.push(field); return this; },
      range(offset, end) { call.offset = offset; call.end = end; return this; },
      eq(field, id) { assert.equal(field, 'id'); call.id = id; return this; },
      delete() { call.deletion = true; return this; },
      returns() { return this; },
      maybeSingle() { return run(true); },
      then(resolve, reject) { return run(false).then(resolve, reject); },
    };
    async function run(detail) {
      state.calls.push(call);
      if (call.deletion) { state.rows = state.rows.filter(row => row.id !== call.id); return { error: null }; }
      const snapshot = structuredClone(state.rows);
      if (detail && state.holdDetail) { const held = state.holdDetail; state.holdDetail = null; await held; }
      if (!detail && state.hold) { const held = state.hold; state.hold = null; await held; }
      if (detail) return state.failDetail ? { error: Error('Detail failed') } : { data: snapshot.find(row => row.id === call.id) ?? null, error: null };
      if (state.failOffset === call.offset) return { error: Error('Page failed') };
      return { data: snapshot.slice(call.offset, Math.min(call.end + 1, call.offset + state.cap)).map(({ id, name, category }) => ({ id, name, category })),
        count: state.count && call.options?.count === 'exact' ? snapshot.length : null, error: null };
    }
  } }) };
  const { IngredientService } = loadService('src/app/services/ingredient.service.ts', { AuthService: { requireEditor: async () => {} }, LoadingService: new LoadingService() }, { crypto: require('node:crypto').webcrypto }, {
    '../utils/ingredient-search.utils': index, '../utils/ingredient-amount.utils': amounts,
  });
  const service = new IngredientService(supabase, { error() {}, success() {} });
  return { service, state };
}

test('construction and index subscriptions do not trigger ingredient requests', () => {
  const { service, state } = setup();
  const subscription = service.ingredients$.subscribe(() => {});
  assert.equal(state.calls.length, 0);
  assert.equal(service.loaded(), false);
  subscription.unsubscribe();
});

test('catalog paging loads every ingredient despite a smaller API response cap', async () => {
  const { service, state } = setup(1005);
  state.cap = 100;
  await service.ensureLoaded();
  assert.equal(service.loaded(), true);
  assert.equal(service.getById('ingredient-1004').name, 'Ingrediente 1004');
  assert.equal(state.calls.length, 11);
  assert.deepEqual(state.calls.map(call => call.offset), Array.from({ length: 11 }, (_, n) => n * 100));
  for (const call of state.calls) { assert.equal(call.selection, 'id,name,category'); assert.deepEqual(call.orders, ['id']); }
  assert.equal(state.calls.filter(call => call.options?.count === 'exact').length, 1);
  assert.equal(service.getById('ingredient-0000').derivedFromIds, undefined);
});

test('simultaneous loads share one request and reuse the completed catalog', async () => {
  const { service, state } = setup();
  const held = gate(); state.hold = held.promise;
  const first = service.ensureLoaded(), second = service.ensureLoaded();
  assert.equal(first, second);
  held.resolve(); await first;
  const count = state.calls.length;
  await service.ensureLoaded();
  assert.equal(state.calls.length, count);
});

test('unknown counts still paginate until an empty response', async () => {
  const { service, state } = setup(); state.count = false;
  await service.ensureLoaded();
  assert.deepEqual(state.calls.map(call => call.offset), [0, 3, 6, 7]);
  assert.ok(service.getById('ingredient-0006'));
});

test('a failed later page never publishes a partial catalog and retry recovers', async () => {
  const { service, state } = setup(); const sizes = [];
  service.ingredients$.subscribe(items => sizes.push(items.length));
  state.failOffset = 3;
  await assert.rejects(service.ensureLoaded(), /Page failed/);
  assert.equal(service.loaded(), false);
  assert.equal(service.error(), true);
  assert.deepEqual(sizes, [0]);
  state.failOffset = null; await service.ensureLoaded();
  assert.deepEqual(sizes, [0, 7]);
  assert.equal(service.error(), false);
});

test('failed refresh retains the previously complete catalog', async () => {
  const { service, state } = setup(); await service.ensureLoaded();
  state.failOffset = 3;
  await assert.rejects(service.refresh(), /Page failed/);
  assert.equal(service.loaded(), true);
  assert.ok(service.getById('ingredient-0006'));
});

test('composition and quantities load only for the requested ingredient and are shared', async () => {
  const { service, state } = setup(); await service.ensureLoaded();
  const held = gate(); state.holdDetail = held.promise;
  const first = service.ensureDetails('ingredient-0000'), second = service.ensureDetails('ingredient-0000');
  await Promise.resolve(); held.resolve();
  const [ingredient, also] = await Promise.all([first, second]);
  assert.equal(ingredient, also);
  assert.deepEqual(Array.from(ingredient.derivedFromIds), ['ingredient-0001']);
  assert.equal(ingredient.derivedFromAmounts['ingredient-0001'].value, 25);
  assert.equal(state.calls.filter(call => call.id).length, 1);
  assert.ok(state.calls.at(-1).selection.includes('ingredient_components'));
  assert.equal(service.getById('ingredient-0001').derivedFromIds, undefined);
  await service.ensureDetails('ingredient-0000');
  assert.equal(state.calls.filter(call => call.id).length, 1);
});

test('a stale detail response cannot overwrite a refreshed catalog', async () => {
  const { service, state } = setup(); await service.ensureLoaded();
  const held = gate(); state.holdDetail = held.promise;
  const pending = service.ensureDetails('ingredient-0000'); await Promise.resolve();
  state.rows[0].name = 'Nuevo nombre'; await service.refresh();
  held.resolve();
  assert.equal((await pending).name, 'Nuevo nombre');
  assert.equal(service.getById('ingredient-0000').name, 'Nuevo nombre');
});

test('missing and failed ingredient details do not masquerade as complete data', async () => {
  const { service, state } = setup(); await service.ensureLoaded();
  state.failDetail = true;
  await assert.rejects(service.ensureDetails('ingredient-0000'), /Detail failed/);
  assert.equal(service.getById('ingredient-0000').derivedFromIds, undefined);
  assert.equal(service.error(), true);
  state.failDetail = false;
  assert.equal(await service.ensureDetails('missing'), null);
  assert.equal(service.error(), false);
});

test('an ingredient save during catalog loading restarts the stale scan and preserves complete saved data', async () => {
  const { service, state } = setup();
  const held = gate(); state.hold = held.promise;
  const loading = service.ensureLoaded();
  const updating = service.update('ingredient-0000', { name: 'Editado', category: 'Elaboracion', derivedFromIds: ['ingredient-0001'], derivedFromAmounts: {} });
  await new Promise(setImmediate); held.resolve();
  await Promise.all([loading, updating]);
  assert.equal(service.getById('ingredient-0000').name, 'Editado');
  assert.deepEqual(Array.from(service.getById('ingredient-0000').derivedFromIds), ['ingredient-0001']);
  assert.equal(state.calls.filter(call => !call.id && call.offset === 0).length, 2);
  assert.equal(service.loaded(), true);
});

test('a detail request started before deletion cannot bring the ingredient back', async () => {
  const { service, state } = setup(); await service.ensureLoaded();
  const held = gate(); state.holdDetail = held.promise;
  const detail = service.ensureDetails('ingredient-0000'); await Promise.resolve();
  assert.equal(await service.remove('ingredient-0000'), true);
  held.resolve();
  assert.equal(await detail, null);
  assert.equal(service.getById('ingredient-0000'), undefined);
});
