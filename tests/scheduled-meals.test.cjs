const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadService } = require('./helpers/load-service.cjs');
const utils = loadService('src/app/utils/scheduled-meal.utils.ts', {});
const recipeId = '11111111-1111-4111-8111-111111111111';
const recipe = changes => ({ recipeId, mode: 'scale', ...changes });
const meal = changes => ({ slot: 'lunch', servings: 2, recipes: [recipe()], ...changes });

test('calendar dates reject impossible dates and work across DST, leap years and year boundaries', () => {
  for (const date of ['', '2026-02-29', '2026-02-30', '20/10/2026']) assert.ok(Number.isNaN(utils.dateNumber(date)));
  assert.equal(utils.shiftDate('2026-10-25', 1), '2026-10-26');
  assert.equal(utils.shiftDate('2028-02-28', 1), '2028-02-29');
  const days = utils.calendarWeek('2026-10-19');
  assert.equal(days.length, 7); assert.equal(days[0].shortLabel, 'Lun 19'); assert.equal(days[6].shortLabel, 'Dom 25');
  const rolling = utils.calendarWeek('2026-10-20');
  assert.equal(rolling[0].shortLabel, 'Mar 20'); assert.equal(rolling[6].shortLabel, 'Lun 26');
  assert.equal(utils.calendarWeek('2026-12-29')[6].date, '2027-01-04');
});

test('calendar heading displays one month, two months, or both years when the dates cross New Year', () => {
  assert.equal(utils.calendarPeriodLabel('2026-10-20', '2026-10-26'), 'Octubre 2026');
  assert.equal(utils.calendarPeriodLabel('2026-10-27', '2026-11-02'), 'Octubre - Noviembre 2026');
  assert.equal(utils.calendarPeriodLabel('2026-12-29', '2027-01-04'), 'Diciembre 2026 - Enero 2027');
});

test('a day requires neither a name nor a saved container and may be completely empty', () => {
  assert.equal(utils.validateDay('2026-10-20', []), null);
  assert.equal(utils.validateDay('2026-10-20', [meal({ recipes: [] })]), null);
  assert.equal(utils.validateDay('2026-10-20', [meal()]), null);
});

test('allows five distinct recipes in each meal and rejects a sixth', () => {
  const recipes = Array.from({ length: 5 }, (_, i) => recipe({ recipeId: `11111111-1111-4111-8111-11111111111${i}` }));
  assert.equal(utils.validateDay('2026-10-20', [meal({ recipes })]), null);
  assert.match(utils.validateDay('2026-10-20', [meal({ recipes: [...recipes, recipe({ recipeId: '11111111-1111-4111-8111-111111111119' })] })]), /cinco/);
});

test('duplicates are forbidden within a meal, even with different portion modes or UUID casing', () => {
  for (const slot of ['breakfast', 'lunch', 'dinner']) assert.match(utils.validateDay('2026-10-20', [meal({ slot, recipes: [recipe(), recipe({ mode: 'leftovers' })] })]), /misma receta/);
  const id = 'abcdefab-abcd-4abc-8abc-abcdefabcdef';
  assert.match(utils.validateDay('2026-10-20', [meal({ recipes: [recipe({ recipeId: id }), recipe({ recipeId: id.toUpperCase() })] })]), /misma receta/);
  assert.equal(utils.validateDay('2026-10-20', [meal(), meal({ slot: 'breakfast' }), meal({ slot: 'dinner' })]), null);
  assert.equal(utils.validateDay('2026-10-21', [meal()]), null);
});

test('rejects repeated slots, invalid modes, recipe IDs, dates and serving counts', () => {
  assert.match(utils.validateDay('2026-10-20', [meal(), meal()]), /una sola vez/);
  assert.ok(utils.validateDay('2026-10-20', [meal({ slot: 'snack' })]));
  assert.ok(utils.validateDay('2026-02-30', [meal()]));
  for (const servings of [0, -1, 1.5, 101, NaN]) assert.match(utils.validateDay('2026-10-20', [meal({ servings })]), /comensales/);
  for (const changes of [{ recipeId: 'invalid' }, { mode: 'invalid' }]) assert.ok(utils.validateDay('2026-10-20', [meal({ recipes: [recipe(changes)] })]));
});

test('proportions and leftovers retain the selected meal serving count', () => {
  assert.match(utils.portionSummary(4, 2, 'scale'), /×0,5/);
  assert.match(utils.portionSummary(4, 2, 'leftovers'), /4 raciones · 2 de sobra/);
  assert.match(utils.portionSummary(2, 5, 'leftovers'), /6 raciones.*3 veces.*1 de sobra/);
  assert.match(utils.portionSummary(null, 2, 'scale'), /Indica los comensales/);
});

function setup() {
  const state = { owner: 'user-a', allowed: true, calls: [], rows: [], error: null, hold: null, now: Date.now() };
  class Clock extends Date { static now() { return state.now; } }
  const auth = { user: () => state.owner ? { id: state.owner } : null, canEdit: () => state.allowed,
    requireEditor: async () => { if (!state.owner || !state.allowed) throw Error('Access denied'); } };
  const query = {};
  for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'in', 'abortSignal']) query[method] = (...args) => { state.calls.push([method, ...args]); return query; };
  query.returns = async () => { if (state.hold) await state.hold; return { data: state.rows, error: state.error }; };
  const client = {
    from: table => { state.calls.push(['from', table]); return query; },
    rpc: async (...args) => { state.calls.push(['rpc', ...args]); if (state.hold) await state.hold; return { error: state.error }; },
  };
  const { ScheduledMealService } = loadService('src/app/services/scheduled-meal.service.ts', {
    AuthService: auth, SupabaseService: { requireClient: () => client },
  }, { Date: Clock }, { '../utils/scheduled-meal.utils': utils });
  return { state, service: new ScheduledMealService() };
}

test('weekly reads are limited to the owner and exactly seven calendar dates', async () => {
  const { state, service } = setup();
  state.rows = [{ meal_date: '2026-10-20', ...meal() }];
  const result = await service.getWeek('2026-10-19');
  assert.equal(result[0].date, '2026-10-20'); assert.equal(result[0].recipes[0].recipeId, recipeId);
  const has = (method, field, value) => state.calls.some(call => call[0] === method && call[1] === field && call[2] === value);
  assert.ok(has('eq', 'owner_id', 'user-a'));
  assert.ok(has('gte', 'meal_date', '2026-10-19')); assert.ok(has('lte', 'meal_date', '2026-10-25'));
  assert.equal(state.calls.find(call => call[0] === 'from')[1], 'scheduled_meals');
});

test('daily reads request only today while rolling windows start on the supplied date', async () => {
  const { state, service } = setup();
  await service.getDay('2026-10-20');
  assert.ok(state.calls.some(call => call[0] === 'gte' && call[1] === 'meal_date' && call[2] === '2026-10-20'));
  assert.ok(state.calls.some(call => call[0] === 'lte' && call[1] === 'meal_date' && call[2] === '2026-10-20'));
  state.calls.length = 0;
  await service.getWeek('2026-10-20');
  assert.ok(state.calls.some(call => call[0] === 'gte' && call[2] === '2026-10-20'));
  assert.ok(state.calls.some(call => call[0] === 'lte' && call[2] === '2026-10-26'));
});

test('saving one date uses one atomic RPC, never a multi-day overwrite or client-supplied owner', async () => {
  const { state, service } = setup();
  const meals = [meal(), meal({ slot: 'dinner', recipes: [] })];
  const before = JSON.stringify(meals);
  await service.saveDay('2026-10-20', meals);
  assert.equal(state.calls.length, 1);
  const [method, rpc, payload] = state.calls[0];
  assert.equal(method, 'rpc'); assert.equal(rpc, 'save_scheduled_day'); assert.equal(payload.p_date, '2026-10-20');
  assert.equal(JSON.stringify(payload.p_meals), before); assert.equal(JSON.stringify(meals), before);
  assert.equal(Object.keys(payload).sort().join(','), 'p_date,p_meals');
});

test('planning consumers invalidate previews before a write and again after its confirmation', async () => {
  const { state, service } = setup(); let release;
  state.hold = new Promise(resolve => { release = resolve; });
  const phases = []; const subscription = service.changes$.subscribe(() => phases.push('invalidate'));
  const writing = service.saveDay('2026-10-20', [meal()]);
  await new Promise(setImmediate); assert.equal(phases.length, 1);
  release(); await writing; assert.equal(phases.length, 2);
  state.error = Error('Write failed');
  await assert.rejects(service.saveDay('2026-10-20', []), /Write failed/);
  assert.equal(phases.length, 3);
  subscription.unsubscribe();
});

test('an empty day is sent to the RPC so removing the last recipe is persisted', async () => {
  const { state, service } = setup();
  await service.saveDay('2026-10-20', []);
  assert.equal(state.calls[0][2].p_meals.length, 0);
});

test('unauthenticated and unauthorized users cannot read or save meals', async () => {
  for (const changes of [{ owner: null }, { allowed: false }]) {
    const { state, service } = setup(); Object.assign(state, changes);
    await assert.rejects(service.getWeek('2026-10-19'), /Access denied/);
    await assert.rejects(service.getDay('2026-10-20'), /Access denied/);
    await assert.rejects(service.saveDay('2026-10-20', [meal()]), /Access denied/);
    assert.equal(state.calls.length, 0);
  }
});

test('invalid input never reaches Supabase and failed saves can be retried', async () => {
  const { state, service } = setup();
  await assert.rejects(service.saveDay('2026-10-20', [meal({ recipes: [recipe(), recipe()] })]), /misma receta/);
  await assert.rejects(service.getWeek('invalid'), /fecha/); assert.equal(state.calls.length, 0);
  state.error = Error('Offline'); await assert.rejects(service.saveDay('2026-10-20', [meal()]), /Offline/);
  state.error = null; await service.saveDay('2026-10-20', [meal()]);
  assert.equal(state.calls.length, 2);
});

test('empty weekly results are distinguished from connection failures', async () => {
  const { state, service } = setup();
  assert.equal((await service.getWeek('2026-10-19')).length, 0);
  state.now += 300_001;
  state.error = Error('Offline'); await assert.rejects(service.getWeek('2026-10-19'), /Offline/);
});

test('returning to a day reuses independent cached meals, including empty dates from a week', async () => {
  const { state, service } = setup();
  state.rows = [{ meal_date: '2026-10-20', ...meal() }];
  const first = await service.getWeek('2026-10-20');
  first[0].recipes.length = 0;
  state.calls.length = 0;
  assert.equal((await service.getDay('2026-10-20'))[0].recipes.length, 1);
  assert.equal((await service.getDay('2026-10-21')).length, 0);
  assert.equal(state.calls.length, 0);
  state.now += 300_001;
  await service.getDay('2026-10-20');
  assert.ok(state.calls.some(call => call[0] === 'from'));
});

test('successful save replaces only that cached date and cache is never reused by another owner', async () => {
  const { state, service } = setup();
  state.rows = [{ meal_date: '2026-10-20', ...meal() }];
  await service.getWeek('2026-10-20');
  await service.saveDay('2026-10-20', []);
  state.calls.length = 0;
  assert.equal((await service.getDay('2026-10-20')).length, 0);
  assert.equal((await service.getDay('2026-10-21')).length, 0);
  assert.equal(state.calls.length, 0);
  state.owner = 'user-b'; state.rows = [];
  await service.getDay('2026-10-20');
  assert.ok(state.calls.some(call => call[0] === 'eq' && call[1] === 'owner_id' && call[2] === 'user-b'));
});

test('an aborted read never fills the cache even when the transport completes late', async () => {
  const { state, service } = setup();
  const request = new AbortController();
  let release; state.hold = new Promise(resolve => { release = resolve; });
  const pending = service.getDay('2026-10-20', request.signal);
  await new Promise(resolve => setImmediate(resolve));
  request.abort(); release();
  await assert.rejects(pending, { name: 'AbortError' });
  state.hold = null; state.calls.length = 0;
  await service.getDay('2026-10-20');
  assert.ok(state.calls.some(call => call[0] === 'from'));
});

test('day fingerprints detect actual changes and ignore empty slots, slot order and UUID casing', () => {
  const original = [meal(), meal({ slot: 'dinner', recipes: [] })];
  const restored = [meal({ slot: 'dinner', servings: 4, recipes: [] }), meal({ recipes: [recipe({ recipeId: recipeId.toUpperCase() })] })];
  assert.equal(utils.dayFingerprint(original), utils.dayFingerprint(restored));
  assert.notEqual(utils.dayFingerprint(original), utils.dayFingerprint([meal({ recipes: [recipe({ mode: 'leftovers' })] })]));
  assert.notEqual(utils.dayFingerprint(original), utils.dayFingerprint([]));
});

test('late reads and save acknowledgements cannot expose state after an account changes', async () => {
  for (const operation of ['read', 'save']) {
    const { state, service } = setup();
    let release; state.hold = new Promise(resolve => { release = resolve; });
    const pending = operation === 'read' ? service.getWeek('2026-10-19') : service.saveDay('2026-10-20', [meal()]);
    await new Promise(resolve => setImmediate(resolve)); state.owner = 'user-b'; release();
    await assert.rejects(pending, /sesión ha cambiado/);
  }
});

test('recipe summaries retain dish types and do not request ingredient quantities', async () => {
  const { state, service } = setup();
  state.rows = [{ id: recipeId, name: 'Arroz', servings: 4, meal_types: ['Plato'], pending: true }];
  const summaries = await service.recipeSummaries([recipeId]);
  assert.equal(summaries[recipeId].mealTypes[0], 'Plato');
  assert.equal(summaries[recipeId].pending, true);
  assert.equal(state.calls.find(call => call[0] === 'select')[1], 'id,name,servings,meal_types,pending');
});

test('scheduling access remains restricted to authenticated editors', async () => {
  for (const scenario of ['editor', 'anonymous', 'denied', 'offline']) {
    const { editorGuard } = loadService('src/app/guards/editor.guard.ts', {
      AuthService: { refreshPermission: async () => { if (scenario === 'offline') throw Error('Offline'); return scenario === 'editor'; }, user: () => scenario === 'anonymous' ? null : { id: 'user-a' } },
      Router: { createUrlTree: segments => segments.join('/') },
    });
    assert.equal(await editorGuard(), scenario === 'editor' ? true : '/login');
  }
});
