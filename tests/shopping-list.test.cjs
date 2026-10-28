const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Subject } = require('rxjs');
const { loadService } = require('./helpers/load-service.cjs');
const calendar = loadService('src/app/utils/scheduled-meal.utils.ts', {});
const uuid = loadService('src/app/utils/uuid.utils.ts', {});
const display = loadService('src/app/utils/recipe-display.utils.ts', {});
const model = loadService('src/app/models/recipe.model.ts', {});
const measures = loadService('src/app/utils/ingredient-measures.utils.ts', {});
const quantities = loadService('src/app/utils/shopping-quantities.utils.ts', {}, {}, { './ingredient-measures.utils': measures });
const utils = loadService('src/app/utils/shopping-list.utils.ts', {}, {}, {
  './scheduled-meal.utils': calendar, './uuid.utils': uuid, './recipe-display.utils': display, '../models/recipe.model': model,
  './ingredient-measures.utils': measures, './shopping-quantities.utils': quantities,
});
const tomato = { id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Tomate', category: 'Verdura', occurrences: 3 };
const rice = { id: 'bbbbbbbb-1111-4111-8111-111111111111', name: 'Arroz', category: 'Cereal', occurrences: 1 };
const planned = items => items.map(item => ({ ...item, occurrences: 1, amounts: [{ kind: 'specific', unit: 'g', value: item.occurrences }], unquantified: 0 }));
const plain = value => JSON.parse(JSON.stringify(value));
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function setup() {
  const recipeChanges = new Subject(), mealChanges = new Subject(), ingredientChanges = new Subject();
  const state = { owner: 'owner-a', editor: true, saved: null, calls: [], readError: null, saveError: null, holdRead: null, holdSave: null,
    preview: [tomato, rice], cap: 1, count: true, previewErrorAt: null, holdPreview: null, now: Date.now() };
  class Clock extends Date { static now() { return state.now; } }
  const client = {
    from(table) {
      assert.equal(table, 'shopping_lists');
      const call = { type: 'read' };
      return {
        select() { return this; }, eq(field, value) { assert.equal(field, 'owner_id'); call.owner = value; return this; },
        abortSignal(signal) { call.signal = signal; return this; },
        async maybeSingle() {
          state.calls.push(call); const snapshot = structuredClone(state.saved);
          const hold = state.holdRead; state.holdRead = null; if (hold) await hold;
          return { data: snapshot, error: state.readError };
        },
      };
    },
    rpc(name, args, options) {
      const call = { type: name, args, options, offset: 0, orders: [] };
      state.calls.push(call);
      if (name === 'save_shopping_list') return (async () => {
        const hold = state.holdSave; state.holdSave = null; if (hold) await hold;
        if (state.saveError) return { data: null, error: state.saveError };
        state.saved = { items: structuredClone(args.p_items), version: args.p_expected_version + 1 };
        return { data: state.saved.version, error: null };
      })();
      assert.equal(name, 'shopping_plan_amounts');
      return {
        order(field) { call.orders.push(field); return this; },
        range(offset) { call.offset = offset; return this; },
        abortSignal(signal) { call.signal = signal; return this; },
        async then(resolve, reject) {
          try {
            const hold = state.holdPreview; state.holdPreview = null; if (hold) await hold;
            resolve({ data: state.preview.slice(call.offset, call.offset + state.cap).map(item => ({ ...item, source: item.id, base_unit: 'g', unit_quantity: null, amount: { kind: 'specific', unit: 'g', value: item.occurrences }, factor: 1, missing_servings: false })),
              count: state.count && options?.count === 'exact' ? state.preview.length : null,
              error: state.previewErrorAt === call.offset ? Error('Preview failed') : null });
          } catch (error) { reject(error); }
        },
      };
    },
  };
  const auth = { user: () => state.owner ? { id: state.owner } : null, canEdit: () => state.editor,
    requireEditor: async () => { if (!state.owner || !state.editor) throw Error('Unauthorized'); } };
  const { ShoppingListService } = loadService('src/app/services/shopping-list.service.ts', {
    AuthService: auth, SupabaseService: { requireClient: () => client },
    RecipeService: { changes$: recipeChanges }, ScheduledMealService: { changes$: mealChanges }, IngredientService: { ingredientIndex$: ingredientChanges },
  }, { Date: Clock }, { '../utils/shopping-list.utils': utils, '../utils/shopping-quantities.utils': quantities, '../utils/scheduled-meal.utils': calendar, '../utils/uuid.utils': uuid, '@angular/core/rxjs-interop': { takeUntilDestroyed: () => source => source } });
  return { state, service: new ShoppingListService(), recipeChanges, mealChanges, ingredientChanges };
}

test('manual additions are unique by ID and preserve planning counts', () => {
  const next = utils.addManualShoppingItems([tomato], [{ ...tomato, id: tomato.id.toUpperCase() }, rice, rice]);
  assert.deepEqual(plain(next), [tomato, rice]);
  assert.equal(tomato.occurrences, 3);
});

test('liquids and nuts validate, display readable labels and persist in shopping lists', async () => {
  const items = [{ ...tomato, name: 'Agua', category: 'Liquidos' }, { ...rice, name: 'Almendras', category: 'FrutosSecos' }];
  assert.equal(utils.validShoppingItems(items), true);
  assert.deepEqual(plain(utils.shoppingGroups(items)).map(group => group.label), ['Frutos secos','Líquidos']);
  const { service, state } = setup(); await service.load(); service.replace(items);
  assert.equal(await service.save(), true); assert.deepEqual(plain(state.saved.items), items);
});

test('list validation rejects invalid types, duplicate IDs and invalid counts', () => {
  assert.equal(utils.validShoppingItems([]), true);
  assert.equal(utils.validShoppingItems([tomato, rice]), true);
  for (const value of [null, {}, [null], [{ ...tomato, id: 'bad' }], [{ ...tomato, name: ' ' }], [{ ...tomato, category: 'bad' }],
    [{ ...tomato, occurrences: 0 }], [{ ...tomato, occurrences: 1.5 }], [{ ...tomato, occurrences: '3' }],
    [{ ...tomato, occurrences: 2147483648 }], [tomato, { ...tomato, id: tomato.id.toUpperCase() }]]) assert.equal(utils.validShoppingItems(value), false);
});

test('date ranges include a single day and support month/year boundaries', () => {
  for (const dates of [['2026-10-20','2026-10-20'], ['2026-12-31','2027-01-02']]) assert.equal(utils.validShoppingRange(...dates), true);
  for (const dates of [['2026-10-21','2026-10-20'], ['2026-02-30','2026-03-01'], ['bad','2026-10-20']]) assert.equal(utils.validShoppingRange(...dates), false);
});

test('dirty comparison ignores ordering but includes counts and names; sharing groups readable text', () => {
  assert.equal(utils.shoppingFingerprint([tomato, rice]), utils.shoppingFingerprint([rice, tomato]));
  assert.notEqual(utils.shoppingFingerprint([tomato]), utils.shoppingFingerprint([{ ...tomato, occurrences: 2 }]));
  assert.notEqual(utils.shoppingFingerprint([tomato]), utils.shoppingFingerprint([{ ...tomato, name: 'Nuevo' }]));
  const text = utils.shoppingShareText([tomato, rice]);
  assert.match(text, /Lista de la compra · Laurel/); assert.match(text, /Tomate · 1 unidad/); assert.match(text, /• Arroz · 1 unidad/);
  assert.doesNotMatch(text, /×1\b/);
});

test('new personal list loads empty; manual draft is reused until explicit save', async () => {
  const { service, state } = setup(); await service.load();
  assert.equal(service.ready(), true); assert.equal(service.dirty(), false);
  service.add([tomato]); await service.load();
  assert.equal(state.calls.length, 1); assert.equal(service.dirty(), true); assert.equal(state.saved, null);
  assert.equal(await service.save(), true); assert.equal(service.dirty(), false);
  assert.equal(state.calls.at(-1).args.p_expected_version, 0);
  assert.deepEqual(plain(state.saved.items), [{ ...tomato, occurrences: 1 }]);
  service.remove(tomato.id); assert.equal(await service.save(), true);
  assert.deepEqual(plain(state.saved.items), []); assert.equal(state.saved.version, 2);
});

test('planning replacement changes only the draft until saved', async () => {
  const { service, state } = setup(); await service.load(); service.add([rice]);
  const preview = await service.fromPlanning('2026-10-20','2026-10-22', new AbortController().signal);
  assert.deepEqual(plain(service.items()), [rice]);
  service.replace([preview[0]]); preview[0].name = 'Changed externally';
  assert.deepEqual(plain(service.items()), planned([tomato])); assert.equal(state.saved, null);
});

test('adding the whole planning preview preserves existing ingredients, sums repeated quantities and persists once saved', async () => {
  const { service, state } = setup(); await service.load();
  const extra={...rice,id:'cccccccc-1111-4111-8111-111111111111',name:'Extra'};
  const prior={...tomato,amounts:[{kind:'specific',unit:'g',value:100}],unquantified:0};
  service.replace([prior,extra]);await service.save();
  const preview=await service.fromPlanning('2026-10-20','2026-10-22',new AbortController().signal);
  assert.equal(service.addPlanning(preview),true);preview[0].amounts[0].value=999;
  assert.deepEqual(plain(service.items()),[{...prior,occurrences:4,amounts:[{kind:'specific',unit:'g',value:103}]},extra,planned([rice])[0]]);
  assert.equal(service.dirty(),true);assert.deepEqual(plain(state.saved.items),[prior,extra]);
  assert.equal(await service.save(),true);assert.deepEqual(plain(state.saved.items),plain(service.items()));
  await service.load(true);assert.equal(service.items()[0].amounts[0].value,103);
});

test('planning additions merge by ingredient ID, preserve measure equivalents and deduplicate notes without mutating either list',()=>{
  const grams={kind:'specific',unit:'g',value:0.1},unit={kind:'specific',unit:'pieza',value:1,baseUnit:'g',unitQuantity:150};
  const previous=[{...tomato,amounts:[grams,unit],unquantified:0,notes:['Aviso']}];
  const additions=[{...tomato,id:tomato.id.toUpperCase(),occurrences:1,amounts:[{...grams,value:0.2},unit],unquantified:0,notes:['Aviso','Otro aviso']},planned([rice])[0]];
  const before=structuredClone([previous,additions]);const result=utils.addPlannedShoppingItems(previous,additions);
  assert.equal(result.length,2);assert.equal(result[0].occurrences,4);
  assert.deepEqual(plain(result[0].amounts),[{...grams,value:0.3},{...unit,value:2}]);assert.deepEqual(plain(result[0].notes),['Aviso','Otro aviso']);
  assert.deepEqual([previous,additions],before);result[1].amounts[0].value=999;assert.equal(additions[1].amounts[0].value,1);
});

test('planning additions retain source data while missing quantities default to units and legacy glasses still need review',()=>{
  const addition={...tomato,occurrences:1,amounts:[{kind:'specific',unit:'g',value:250}],unquantified:0};
  const result=utils.addPlannedShoppingItems([tomato],[addition]);assert.equal(result[0].unquantified,1);assert.equal(quantities.shoppingPurchaseReady(result),true);
  const glasses=[{...tomato,amounts:[{kind:'glass'}],unquantified:0}];
  const mixed=utils.addPlannedShoppingItems([addition],glasses);assert.deepEqual(plain(mixed[0].amounts),[addition.amounts[0],{kind:'glass'}]);mixed[0].amounts[1].kind='spoon';assert.equal(glasses[0].amounts[0].kind,'glass');
});

test('planning additions are atomic on invalid totals and blocked during unavailable, saving, pending-purchase or changed-owner states',async()=>{
  const {service,state}=setup();assert.equal(service.addPlanning(planned([tomato])),false);await service.load();service.replace([tomato]);
  const before=plain(service.items());assert.throws(()=>service.addPlanning([{...rice,occurrences:0}]),/válida/);assert.deepEqual(plain(service.items()),before);
  assert.throws(()=>service.addPlanning([{...tomato,occurrences:2147483647}]),/límites/);assert.deepEqual(plain(service.items()),before);
  for(const flag of [service.saving,service.loading,service.purchasePending]){flag.set(true);assert.equal(service.addPlanning(planned([rice])),false);flag.set(false);assert.deepEqual(plain(service.items()),before);}
  state.owner='owner-b';assert.equal(service.addPlanning(planned([rice])),false);assert.equal(service.items().length,0);
});

test('editing real quantities preserves other ingredients and persists measures instead of appearance counters', async () => {
  const { service, state } = setup(); await service.load(); service.replace([tomato, rice]); await service.save();
  service.setAmounts(rice.id, [{ kind: 'specific', value: 350, unit: 'g' }]);
  assert.deepEqual(plain(service.items()), [tomato, { ...rice, amounts: [{ kind: 'specific', value: 350, unit: 'g' }], unquantified: 0 }]);
  assert.equal(service.dirty(), true); assert.equal(state.saved.items[1].occurrences, 1);
  assert.equal(await service.save(), true); assert.equal(state.saved.items[1].amounts[0].value, 350);
  assert.equal(service.dirty(), false);
});

test('quantity editing respects loading, saving, ownership and validation', async () => {
  const { service, state } = setup();
  service.setAmounts(rice.id, []); assert.equal(service.items().length, 0);
  await service.load(); service.replace([{ ...tomato, occurrences: 2147483647 }, rice]);
  service.setAmounts('missing', []);
  assert.throws(() => service.setAmounts(tomato.id, [{ kind: 'specific', unit: 'g', value: -1 }]), /cantidades/);
  assert.equal(service.items()[0].occurrences, 2147483647);
  const held = gate(); state.holdSave = held.promise; const saving = service.save();
  service.setAmounts(rice.id, [{ kind: 'specific', unit: 'g', value: 400 }]); assert.equal(service.items()[1].amounts, undefined);
  held.resolve(); await saving;
  state.owner = 'owner-b'; service.setAmounts(rice.id, []);
  assert.equal(service.items().length, 0);
});

test('unit buttons increment real units and persist their equivalents without changing other measures or ingredients',async()=>{
  const {service,state}=setup();await service.load();
  const unit={kind:'specific',unit:'pieza',value:1,baseUnit:'g',unitQuantity:150};
  const measured={...tomato,amounts:[{kind:'specific',unit:'g',value:250},unit],unquantified:1,notes:['Aviso']};
  service.replace([measured,rice]);await service.save();
  service.incrementUnit(tomato.id,1);service.incrementUnit(tomato.id,1);
  const expected={...measured,amounts:[measured.amounts[0],{...unit,value:3},{kind:'specific',unit:'pieza',value:1}],unquantified:0};
  assert.deepEqual(plain(service.items()),[expected,rice]);assert.equal(measured.amounts[1].value,1);assert.equal(service.dirty(),true);
  assert.equal(state.saved.items[0].amounts[1].value,1);assert.equal(await service.save(),true);await service.load(true);
  assert.equal(service.items()[0].amounts[1].value,3);assert.equal(service.items()[0].amounts[1].unitQuantity,150);
});

test('a missing quantity starts at one unit and its first increment saves two without treating the legacy count as units',async()=>{
  const {service}=setup();await service.load();service.replace([{...tomato,occurrences:9}]);
  assert.equal(quantities.shoppingQuantityLabel(service.items()[0]),'1 unidad');service.incrementUnit(tomato.id,0);
  assert.deepEqual(plain(service.items()[0].amounts),[{kind:'specific',unit:'pieza',value:2}]);assert.equal(service.items()[0].unquantified,0);assert.equal(service.items()[0].occurrences,9);
  await service.save();await service.load(true);assert.equal(service.items()[0].amounts[0].value,2);
});

test('unit increments reject unrelated measures and overflow, and respect load, save, purchase and owner locks',async()=>{
  const {service,state}=setup();service.incrementUnit(tomato.id,0);await service.load();
  const unit={kind:'specific',unit:'pieza',value:0.5};service.replace([{...tomato,amounts:[unit],unquantified:0},planned([rice])[0]]);
  service.incrementUnit(tomato.id,0);assert.equal(service.items()[0].amounts[0].value,1.5);
  const before=plain(service.items());service.incrementUnit(rice.id,0);service.incrementUnit(tomato.id,1);service.incrementUnit('missing',0);assert.deepEqual(plain(service.items()),before);
  for(const flag of [service.loading,service.saving,service.purchasePending]){flag.set(true);service.incrementUnit(tomato.id,0);flag.set(false);assert.deepEqual(plain(service.items()),before);}
  service.replace([{...tomato,amounts:[{...unit,value:Number.MAX_VALUE}],unquantified:0}]);assert.throws(()=>service.incrementUnit(tomato.id,0),/rango/);assert.equal(service.items()[0].amounts[0].value,Number.MAX_VALUE);
  state.owner='owner-b';service.incrementUnit(tomato.id,0);assert.equal(service.items().length,0);
});

test('clearing the list changes the draft and explicitly saving persists its removal', async () => {
  const { service, state } = setup(); await service.load(); service.replace([tomato, rice]); await service.save();
  service.clear(); assert.deepEqual(plain(service.items()), []); assert.equal(service.dirty(), true);
  assert.deepEqual(plain(state.saved.items), [tomato, rice]);
  state.saveError = Error('Offline'); assert.equal(await service.save(), false);
  assert.equal(service.dirty(), true); assert.deepEqual(plain(service.items()), []);
  state.saveError = null; assert.equal(await service.save(), true);
  assert.deepEqual(plain(state.saved.items), []); assert.equal(service.dirty(), false);
});

test('clearing is blocked during saving and cannot change another owner’s list', async () => {
  const { service, state } = setup(); await service.load(); service.replace([tomato]);
  const held = gate(); state.holdSave = held.promise; const pending = service.save();
  service.clear(); assert.deepEqual(plain(service.items()), [tomato]);
  held.resolve(); await pending;
  state.owner = 'owner-b'; state.saved = { items: [rice], version: 1 };
  service.clear(); await service.load(); assert.deepEqual(plain(service.items()), [rice]);
});

test('failed reload preserves draft and failed save stays retryable', async () => {
  const { service, state } = setup(); await service.load(); service.replace([tomato]);
  state.readError = Error('Offline'); await service.load(true);
  assert.equal(service.error(), 'Offline'); assert.deepEqual(plain(service.items()), [tomato]);
  state.saveError = { code: '40001', message: 'Conflict' };
  assert.equal(await service.save(), false); assert.equal(service.saveError(), 'Conflict'); assert.equal(service.dirty(), true);
  state.saveError = null; assert.equal(await service.save(), true); assert.equal(service.dirty(), false);
});

test('missing Supabase migration is explained and does not enable editing an unknown list', async () => {
  const { service, state } = setup(); state.readError = { code: 'PGRST205', message: 'Not found' };
  await service.load(); assert.equal(service.ready(), false); assert.match(service.error(), /20261020000400_shopping_lists.sql/);
  service.add([tomato]); assert.equal(service.items().length, 0);
});

test('concurrent load and save attempts are shared or blocked and edits cannot race saving', async () => {
  const { service, state } = setup(); const read = gate(); state.holdRead = read.promise;
  const a = service.load(), b = service.load(); await new Promise(setImmediate);
  assert.equal(state.calls.length, 1); read.resolve(); await Promise.all([a,b]);
  service.replace([tomato]); const write = gate(); state.holdSave = write.promise;
  const pending = service.save(); await new Promise(setImmediate);
  assert.equal(await service.save(), false); service.remove(tomato.id); service.add([rice]);
  assert.deepEqual(plain(service.items()), [tomato]); write.resolve(); assert.equal(await pending, true);
  assert.equal(state.calls.filter(call => call.type === 'save_shopping_list').length, 1);
});

test('account changes discard the previous draft and ignore delayed reads', async () => {
  const { service, state } = setup(); state.saved = { items: [tomato], version: 1 };
  const held = gate(); state.holdRead = held.promise; const pending = service.load(); await new Promise(setImmediate);
  const old = state.calls[0]; state.owner = 'owner-b'; state.saved = null; await service.load();
  assert.equal(old.signal.aborted, true); held.resolve(); await pending;
  assert.deepEqual(plain(service.items()), []); assert.equal(service.dirty(), false);
});

test('a delayed save cannot populate a different account or mark its draft saved', async () => {
  const { service, state } = setup(); await service.load(); service.replace([tomato]);
  const held = gate(); state.holdSave = held.promise; const pending = service.save(); await new Promise(setImmediate);
  state.owner = 'owner-b'; await service.load(); service.replace([rice]); held.resolve();
  assert.equal(await pending, false); assert.deepEqual(plain(service.items()), [rice]); assert.equal(service.dirty(), true);
});

test('planning preview pages beyond API caps and forwards inclusive dates without changing the draft', async () => {
  const { service, state } = setup(); await service.load();
  const result = await service.fromPlanning('2026-12-31','2027-01-02', new AbortController().signal);
  assert.deepEqual(plain(result), planned([tomato, rice])); assert.equal(service.items().length, 0);
  const calls = state.calls.filter(call => call.type === 'shopping_plan_amounts');
  assert.deepEqual(calls.map(call => call.offset), [0,1]); assert.equal(calls.filter(call => call.options.count === 'exact').length, 1);
  for (const call of calls) { assert.deepEqual(plain(call.args), { p_from: '2026-12-31', p_to: '2027-01-02' }); assert.deepEqual(call.orders, ['source']); }
  state.count = false;
  assert.deepEqual(plain(await service.fromPlanning('2026-10-20','2026-10-20', new AbortController().signal)), planned([tomato, rice]));
});

test('failed, aborted or account-obsolete previews never expose a partial result', async () => {
  const { service, state } = setup(); state.previewErrorAt = 1;
  await assert.rejects(service.fromPlanning('2026-10-20','2026-10-22', new AbortController().signal), /Preview failed/);
  state.previewErrorAt = null; const held = gate(); state.holdPreview = held.promise;
  const controller = new AbortController(); const pending = service.fromPlanning('2026-10-20','2026-10-22', controller.signal);
  await new Promise(setImmediate); controller.abort(); held.resolve(); await assert.rejects(pending);
  const other = gate(); state.holdPreview = other.promise;
  const obsolete = service.fromPlanning('2026-10-20','2026-10-22', new AbortController().signal);
  await new Promise(setImmediate); state.owner = 'owner-b'; other.resolve(); await assert.rejects(obsolete, /sesión ha cambiado/);
  assert.equal(service.items().length, 0);
});

test('invalid ranges and signed out access fail before requesting planning data', async () => {
  const { service, state } = setup();
  await assert.rejects(service.fromPlanning('2026-10-22','2026-10-20', new AbortController().signal), /intervalo/);
  state.owner = null; await assert.rejects(service.load(), /sesión/);
  await assert.rejects(service.fromPlanning('2026-10-20','2026-10-22', new AbortController().signal), /sesión/);
  assert.equal(state.calls.length, 0);
});

const previewCalls = state => state.calls.filter(call => call.type === 'shopping_plan_amounts');
const preview = (service, from = '2026-10-20', to = '2026-10-22', signal = new AbortController().signal) => service.fromPlanning(from, to, signal);

test('identical intervals reuse independent complete results, including empty intervals', async () => {
  const { service, state } = setup();
  const first = await preview(service); const count = previewCalls(state).length;
  first[0].name = 'External change'; first.pop();
  assert.deepEqual(plain(await preview(service)), planned([tomato, rice]));
  assert.equal(previewCalls(state).length, count);
  state.preview = []; await preview(service, '2026-11-01', '2026-11-01');
  const emptyCount = previewCalls(state).length;
  assert.deepEqual(plain(await preview(service, '2026-11-01', '2026-11-01')), []);
  assert.equal(previewCalls(state).length, emptyCount);
});

test('simultaneous identical intervals share pages and one cancelled consumer does not cancel another', async () => {
  const { service, state } = setup(); const held = gate(); state.holdPreview = held.promise;
  const controller = new AbortController();
  const first = preview(service, undefined, undefined, controller.signal);
  const cancelled = assert.rejects(first);
  const second = preview(service); await new Promise(setImmediate);
  assert.equal(previewCalls(state).length, 1);
  const transport = previewCalls(state)[0].signal;
  controller.abort(); await cancelled; assert.equal(transport.aborted, false);
  held.resolve(); assert.deepEqual(plain(await second), planned([tomato, rice]));
  assert.equal(previewCalls(state).length, 2);
});

test('cancelling the final preview consumer aborts transport and cannot cache its late response', async () => {
  const { service, state } = setup(); const held = gate(); state.holdPreview = held.promise;
  const controller = new AbortController(); const cancelled = assert.rejects(preview(service, undefined, undefined, controller.signal));
  await new Promise(setImmediate); const transport = previewCalls(state)[0].signal;
  controller.abort(); await cancelled; assert.equal(transport.aborted, true);
  held.resolve(); await new Promise(setImmediate);
  state.preview = [rice]; assert.deepEqual(plain(await preview(service)), planned([rice]));
  assert.equal(previewCalls(state).length, 2);
});

test('cache expires after five minutes and never reuses another account or revoked editor access', async () => {
  const { service, state } = setup(); await preview(service);
  state.now += 300_000; state.preview = [rice];
  assert.deepEqual(plain(await preview(service)), planned([rice]));
  const count = previewCalls(state).length;
  state.owner = 'owner-b'; state.preview = [tomato];
  assert.deepEqual(plain(await preview(service)), planned([tomato]));
  assert.ok(previewCalls(state).length > count);
  state.editor = false; await assert.rejects(preview(service), /sesión/);
});

test('recipe, planning and catalog changes invalidate calculated intervals', async () => {
  const { service, state, recipeChanges, mealChanges, ingredientChanges } = setup(); await preview(service);
  for (const changes of [recipeChanges, mealChanges, ingredientChanges]) {
    const count = previewCalls(state).length;
    changes.next(); await preview(service); assert.ok(previewCalls(state).length > count);
  }
});

test('a preview invalidated while loading cannot restore stale cached data', async () => {
  const { service, state, mealChanges } = setup(); const held = gate(); state.holdPreview = held.promise;
  const pending = preview(service); await new Promise(setImmediate);
  mealChanges.next(); held.resolve(); await pending;
  state.preview = [rice]; const count = previewCalls(state).length;
  assert.deepEqual(plain(await preview(service)), planned([rice]));
  assert.ok(previewCalls(state).length > count);
});

test('failed calculations stay retryable and interval cache has a bounded size', async () => {
  const { service, state } = setup(); state.previewErrorAt = 1;
  await assert.rejects(preview(service), /Preview failed/);
  state.previewErrorAt = null;
  assert.deepEqual(plain(await preview(service)), planned([tomato, rice]));
  for (let day = 1; day <= 21; day++) {
    const date = `2026-11-${String(day).padStart(2, '0')}`;
    await preview(service, date, date);
  }
  const count = previewCalls(state).length;
  await preview(service); assert.ok(previewCalls(state).length > count);
});
