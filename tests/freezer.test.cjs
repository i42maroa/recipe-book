const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const { loadService } = require('./helpers/load-service.cjs');
const measures = loadService('src/app/utils/ingredient-measures.utils.ts', {});
const calendar = loadService('src/app/utils/scheduled-meal.utils.ts', {});
const uuid = loadService('src/app/utils/uuid.utils.ts', {});
const model = loadService('src/app/models/recipe.model.ts', {});
const freezerUtils = loadService('src/app/utils/freezer.utils.ts', {}, {}, {
  './ingredient-measures.utils': measures, './scheduled-meal.utils': calendar, './uuid.utils': uuid, '../models/recipe.model': model,
});
const inventoryUtils = loadService('src/app/utils/inventory.utils.ts', {}, { crypto }, {
  './ingredient-measures.utils': measures, './freezer.utils': freezerUtils, './scheduled-meal.utils': calendar, './uuid.utils': uuid,
});
const utils = { ...freezerUtils, validFreezers: inventoryUtils.validInventory,
  freezerFingerprint: inventoryUtils.inventoryFingerprint, withdrawFreezerItem: inventoryUtils.withdrawInventoryItem };
const item = { recipeId: null, servings: null, space: 'freezer', arrivedOn: '2026-10-26', id: 'aaaaaaaa-1111-4111-8111-111111111111', ingredientId: 'bbbbbbbb-1111-4111-8111-111111111111',
  name: 'Pollo', category: 'Carne', enteredOn: '2026-10-26', amount: { kind: 'specific', value: 500, unit: 'g' } };
const freezer = { id: 'cccccccc-1111-4111-8111-111111111111', name: 'Casa', items: [item] };
const product = { ...item, id: 'dddddddd-1111-4111-8111-111111111111', ingredientId: null, category: null, name: 'Arroz con verduras de Mercadona' };
const plain = value => JSON.parse(JSON.stringify(value));
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = () => new Promise(setImmediate);

function setup() {
  const state = { owner: 'owner-a', editor: true, saved: null, calls: [], readError: null, saveError: null, readGate: null, saveGate: null, authGate: null };
  const selectionCache = new Map();
  const client = {
    rpc(name, args) {
      if (name === 'inventory_recipe_ids') return { async abortSignal() { return { data: args.p_ids.filter(id => !state.deletedRecipes?.includes(id)), error: null }; } };
      if (name === 'get_inventory') return {
        async abortSignal(signal) {
          state.calls.push({ type: 'read', owner: state.owner, signal });
          const snapshot = structuredClone(state.saved?.places ?? []);
          const hold = state.readGate; state.readGate = null; if (hold) await hold;
          return { data: snapshot, error: state.readError };
        },
      };
      assert.equal(name, 'apply_inventory_changes');
      return (async () => {
        state.calls.push({ type: 'save', args: structuredClone(args) });
        const hold = state.saveGate; state.saveGate = null; if (hold) await hold;
        if (state.saveError) return { data: null, error: state.saveError };
        const places = structuredClone(state.saved?.places ?? []);
        for (const change of args.p_changes) {
          const freezer = places.find(value => value.id === change.placeId);
          const current = change.itemId ? freezer?.items.find(value => value.id === change.itemId) ?? null : freezer ? { name: freezer.name } : null;
          if (JSON.stringify(current) === JSON.stringify(change.after)) continue;
          if (JSON.stringify(current) !== JSON.stringify(change.before)) return { data: null, error: { code: '40001', message: 'La entrada ha cambiado' } };
          if (change.itemId) {
            const index = freezer.items.findIndex(value => value.id === change.itemId);
            if (!change.after) freezer.items.splice(index, 1);
            else if (index < 0) freezer.items.push(structuredClone(change.after));
            else freezer.items[index] = structuredClone(change.after);
          } else if (!change.after) places.splice(places.indexOf(freezer), 1);
          else if (freezer) freezer.name = change.after.name;
          else places.push({ id: change.placeId, name: change.after.name, items: [] });
        }
        state.saved = { places };
        if (state.lostResponse) { state.lostResponse = false; return { data: null, error: { message: 'Respuesta perdida' } }; }
        return { data: true, error: null };
      })();
    },
  };
  const auth = { user: () => state.owner ? { id: state.owner } : null, canEdit: () => state.editor,
    async requireEditor() { const hold = state.authGate; state.authGate = null; if (hold) await hold; if (!state.owner || !state.editor) throw Error('Unauthorized'); } };
  const { InventoryService } = loadService('src/app/services/inventory.service.ts', {
    CacheService: { get: key => selectionCache.get(key) ?? null, set: (key, value) => selectionCache.set(key, value) }, AuthService: auth, SupabaseService: { requireClient: () => client },
  }, { crypto }, { '../utils/inventory.utils': inventoryUtils, '../../environments/environment': { environment: { supabaseUrl: 'test-project' } } });
  return { state, service: new InventoryService(), recreate: () => new InventoryService() };
}

test('inventory accepts independent dated lots, elaborations, free products and recipe quantities', () => {
  const lots = [item, product, { ...item, id: crypto.randomUUID(), enteredOn: '2026-10-20', category: 'Elaboracion' }];
  for (const amount of [null, { kind: 'spoon' }, { kind: 'glass' }, { kind: 'specific', value: 2, unit: 'pieza' }, { kind: 'specific', value: 0.1, unit: 'ml' }]) {
    assert.equal(utils.validFreezers([{ ...freezer, items: lots.map(lot => ({ ...lot, amount })) }]), true);
  }
});

test('inventory rejects malformed identifiers, duplicates, dates, names, categories and amounts', () => {
  for (const bad of [null, {}, [{ ...freezer, name: ' \n ' }], [{ ...freezer, id: 'bad' }], [{ ...freezer, id: [freezer.id] }], [freezer, { ...freezer, id: freezer.id.toUpperCase() }]]) {
    assert.equal(utils.validFreezers(bad), false);
  }
  for (const patch of [{ id: 'bad' }, { id: [item.id] }, { name: ' ' }, { ingredientId: 'bad' }, { ingredientId: [item.ingredientId] }, { ingredientId: null }, { category: 'bad' },
    { enteredOn: '2026-02-30' }, { enteredOn: '0000-01-01' }, { enteredOn: null }, { enteredOn: '26/10/2026' }, { amount: undefined },
    { amount: { kind: 'specific', value: 0, unit: 'g' } }, { amount: { kind: 'specific', value: Infinity, unit: 'g' } },
    { amount: { kind: 'specific', value: '3', unit: 'g' } }, { amount: { kind: 'specific', value: 2, unit: 'kg' } }]) {
    assert.equal(utils.validFreezers([{ ...freezer, items: [{ ...item, ...patch }] }]), false, JSON.stringify(patch));
  }
  assert.equal(utils.validFreezers([{ ...freezer, items: [item, { ...item, id: item.id.toUpperCase() }] }]), false);
  assert.equal(utils.validFreezers([freezer, { ...freezer, id: crypto.randomUUID() }]), false);
});

test('partial withdrawals retain dates, reject excessive amounts and remove exhausted lots without floating residue', () => {
  const remaining = utils.withdrawFreezerItem(item, 200);
  assert.equal(remaining.amount.value, 300); assert.equal(remaining.enteredOn, item.enteredOn); assert.equal(item.amount.value, 500);
  assert.equal(utils.withdrawFreezerItem(item, 500), null);
  const decimal = { ...item, amount: { kind: 'specific', value: 0.3, unit: 'g' } };
  assert.equal(utils.withdrawFreezerItem(decimal, 0.1).amount.value, 0.2);
  for (const quantity of [0, -1, 501, NaN, Infinity]) assert.throws(() => utils.withdrawFreezerItem(item, quantity));
  assert.throws(() => utils.withdrawFreezerItem({ ...item, amount: null }, 1));
});

test('fingerprints ignore ordering and key order but include quantities, dates, names and freezer identity', () => {
  const original = [{ ...freezer, items: [item, product] }];
  assert.equal(utils.freezerFingerprint(original), utils.freezerFingerprint([{ ...freezer, items: [product, { ...item, amount: { unit: 'g', value: 500, kind: 'specific' } }] }]));
  for (const patch of [{ enteredOn: '2026-10-25' }, { name: 'Nuevo' }, { amount: null }]) {
    assert.notEqual(utils.freezerFingerprint([freezer]), utils.freezerFingerprint([{ ...freezer, items: [{ ...item, ...patch }] }]));
  }
  assert.match(utils.freezerAmountLabel({ kind: 'specific', value: 2, unit: 'pieza' }), /2 unidades/);
});

test('every mutation saves automatically, including additions, withdrawals and freezer management', async () => {
  const { service, state } = setup(); await service.load();
  const casa = service.create(' Casa '); assert.equal(service.saving(), true);
  await settle(); assert.equal(state.saved.places[0].name, 'Casa'); assert.equal(service.dirty(), false);
  const alquiler = service.create('Casa alquilada'); await settle();
  service.addItems(casa, [item, product]);
  await settle(); assert.equal(service.dirty(), false);
  const reads = state.calls.filter(call => call.type === 'read').length;
  await service.load(); assert.equal(state.calls.filter(call => call.type === 'read').length, reads);
  assert.equal(state.saved.places.length, 2); assert.equal(state.saved.places[0].name, 'Casa');
  assert.deepEqual(plain(state.saved.places[0].items), [item, product]);
  service.withdraw(casa, item.id, 200); await settle(); assert.equal(state.saved.places[0].items[0].amount.value, 300);
  service.updateItem(casa, { ...product, name: 'Nuevo producto' }); await settle(); assert.equal(state.saved.places[0].items[1].name, 'Nuevo producto');
  service.clear(casa); await settle(); service.removePlace(alquiler); await settle();
  assert.deepEqual(plain(state.calls.at(-1).args.p_changes), [{ placeId: alquiler, itemId: null, before: { name: 'Casa alquilada' }, after: null }]);
  assert.equal(state.saved.places[0].items.length, 0);
  service.removePlace(casa); await settle(); assert.deepEqual(plain(state.saved.places), []);
  assert.equal(await service.save(), false);
});

test('invalid changes are rejected and each valid modification is saved before the next one', async () => {
  const { service, state } = setup(); state.saved = { places: [freezer], version: 3 }; await service.load();
  assert.throws(() => service.create(' ')); assert.throws(() => service.removePlace(freezer.id));
  service.rename(freezer.id, 'Otro'); await settle(); service.rename(freezer.id, 'Casa'); await settle(); assert.equal(service.dirty(), false);
  service.addItems(freezer.id, [product]); await settle();
  service.withdraw(freezer.id, item.id, 200); await settle(); assert.equal(state.saved.places[0].items[0].amount.value, 300);
  service.withdraw(freezer.id, item.id, 300); await settle(); assert.equal(state.saved.places[0].items.length, 1);
  service.updateItem(freezer.id, { ...product, name: 'Nuevo nombre' }); await settle(); assert.equal(state.saved.places[0].items[0].name, 'Nuevo nombre');
  service.removeItem(freezer.id, product.id); await settle(); assert.equal(state.saved.places[0].items.length, 0);
});

test('a failed or conflicting save keeps the draft and supports reloading the saved version', async () => {
  const { service, state } = setup(); state.saved = { places: [freezer], version: 2 }; await service.load();
  service.clear(freezer.id); state.saveError = { code: '40001', message: 'El inventario ha cambiado' };
  assert.equal(await service.save(), false); assert.equal(service.dirty(), true); assert.equal(service.places()[0].items.length, 0);
  assert.match(service.saveError(), /ha cambiado/);
  await service.load(true); assert.equal(service.dirty(), false); assert.equal(service.places()[0].items.length, 1);
});

test('loads are shared and failed initial reads cannot overwrite inventory through editing or saving', async () => {
  const { service, state } = setup(); const hold = gate(); state.readGate = hold.promise;
  const first = service.load(); const second = service.load(); await Promise.resolve();
  assert.equal(service.create('Casa'), null); assert.equal(await service.save(), false);
  state.readError = { code: 'PGRST205' }; hold.resolve(); await Promise.all([first, second]);
  assert.equal(state.calls.length, 1); assert.equal(service.ready(), false); assert.match(service.error(), /20261027000100/);
  assert.equal(service.create('Casa'), null);
  state.readError = null; await service.load(); assert.equal(service.ready(), true);
});

test('saving queues further edits without blocking; submitted changes are independent of callers', async () => {
  const { service, state } = setup(); await service.load(); const id = service.create('Casa'); await settle();
  const hold = gate(); state.saveGate = hold.promise;
  const additions = [structuredClone(item)]; service.addItems(id, additions); additions[0].name = 'Alterado';
  const saving = service.save();
  assert.equal(service.places()[0].items[0].name, 'Pollo');
  assert.ok(service.create('Otro')); service.clear(id); assert.equal(service.places()[0].items.length, 0);
  assert.equal(service.save(), saving); hold.resolve(); assert.equal(await saving, true);
  assert.equal(state.calls.filter(call => call.type === 'save').length, 4);
  assert.equal(state.saved.places.length, 2); assert.equal(state.saved.places[0].items.length, 0);
  assert.equal(service.dirty(), false); assert.equal(service.saving(), false);
});

test('switching account aborts reads and ignores late writes from the previous session', async () => {
  const { service, state } = setup(); state.saved = { places: [freezer], version: 1 };
  const readHold = gate(); state.readGate = readHold.promise; const oldRead = service.load(); await new Promise(setImmediate);
  state.owner = 'owner-b'; state.saved = null; const newRead = service.load(); readHold.resolve(); await Promise.all([oldRead, newRead]);
  assert.equal(state.calls[0].signal.aborted, true); assert.deepEqual(plain(service.places()), []);
  service.create('Privado B'); const saveHold = gate(); state.saveGate = saveHold.promise; const oldSave = service.save(); await Promise.resolve();
  state.owner = 'owner-c'; state.saved = null; await service.load(); saveHold.resolve();
  assert.equal(await oldSave, false); assert.deepEqual(plain(service.places()), []); assert.equal(service.dirty(), false);
});

test('an account change while verifying permissions cannot start a read for the previous owner', async () => {
  const { service, state } = setup(); const hold = gate(); state.authGate = hold.promise;
  const read = service.load(); state.owner = 'owner-b'; hold.resolve(); await read;
  assert.equal(state.calls.length, 0); await service.load(); assert.equal(state.calls[0].owner, 'owner-b');
});

test('revoked access and logout clear private drafts before a new load', async () => {
  const { service, state } = setup(); await service.load(); service.create('Casa'); state.editor = false;
  assert.equal(service.create('Otro'), null); assert.deepEqual(plain(service.places()), []); assert.equal(service.ready(), false);
  await assert.rejects(service.load(), /autorizada/);
});

test('freezer selection survives navigation and renaming, falls back after deletion and clears on account changes', async () => {
  const { service, state } = setup();
  const second = { id: crypto.randomUUID(), name: 'Casa alquilada', items: [] };
  state.saved = { places: [freezer, second], version: 1 }; await service.load();
  assert.equal(service.selected().id, freezer.id);
  service.selectedId.set(second.id); assert.equal(service.dirty(), false);
  await service.load(); assert.equal(service.selected().id, second.id); assert.equal(state.calls.length, 1);
  service.rename(second.id, 'Alquiler'); await settle(); assert.equal(service.selected().name, 'Alquiler');
  service.removePlace(second.id); await settle(); assert.equal(service.selected().id, freezer.id);
  state.owner = 'owner-b'; state.saved = null; await service.load();
  assert.equal(service.selected(), null); assert.equal(service.selectedId(), '');
});

test('unchanged edits do not write and failed autosaves can retry without duplicating lots', async () => {
  const { service, state } = setup(); state.saved = { places: [freezer], version: 2 }; await service.load();
  service.updateItem(freezer.id, structuredClone(item)); await settle(); assert.equal(state.calls.length, 1);
  state.saveError = { message: 'Sin conexión' }; service.addItems(freezer.id, [product]); await settle();
  assert.match(service.saveError(), /conexión/); assert.equal(service.dirty(), true); assert.equal(service.saving(), false);
  assert.equal(service.places()[0].items.length, 2); assert.equal(state.saved.places[0].items.length, 1);
  state.saveError = null; assert.equal(await service.save(), true);
  assert.equal(state.saved.places[0].items.length, 2); assert.equal(service.dirty(), false);
});

test('sorting supports both entry date directions and name directions without changing stored lots', () => {
  const lots = [{ ...item, name: 'Zanahoria', enteredOn: '2026-10-20' },
    { ...product, name: 'Arroz', enteredOn: '2026-10-26' },
    { ...item, id: 'eeeeeeee-1111-4111-8111-111111111111', name: 'Pollo', enteredOn: '2026-10-23' }];
  const original = structuredClone(lots);
  for (const [order, names] of [['oldest', ['Zanahoria', 'Pollo', 'Arroz']], ['newest', ['Arroz', 'Pollo', 'Zanahoria']],
    ['name', ['Arroz', 'Pollo', 'Zanahoria']], ['name-desc', ['Zanahoria', 'Pollo', 'Arroz']]]) {
    assert.deepEqual(plain(utils.sortFreezerItems(lots, order)).map(lot => lot.name), names);
  }
  assert.deepEqual(lots, original);
});

test('editing one lot sends only that lot and retains unrelated inventory references', async () => {
  const { service, state } = setup();
  const second = { id: crypto.randomUUID(), name: 'Alquiler', items: Array.from({ length: 1000 }, () => ({ ...product, id: crypto.randomUUID() })) };
  state.saved = { places: [freezer, second] }; await service.load();
  const untouched = service.places()[1];
  service.withdraw(freezer.id, item.id, 100); await settle();
  const args = state.calls.at(-1).args;
  assert.deepEqual(Object.keys(args), ['p_changes']); assert.equal(args.p_changes.length, 1);
  assert.equal(args.p_changes[0].before.amount.value, 500); assert.equal(args.p_changes[0].after.amount.value, 400);
  assert.equal(service.places()[1], untouched);
  assert.ok(JSON.stringify(args).length < 1000);
  assert.equal(state.saved.places[1].items.length, 1000);
});

test('queued withdrawals of the same lot retain their order and final quantity', async () => {
  const { service, state } = setup(); state.saved = { places: [freezer] }; await service.load();
  const hold = gate(); state.saveGate = hold.promise;
  service.withdraw(freezer.id, item.id, 100); await Promise.resolve();
  service.withdraw(freezer.id, item.id, 150);
  service.updateItem(freezer.id, { ...service.places()[0].items[0], enteredOn: '2026-10-20' });
  assert.equal(service.places()[0].items[0].amount.value, 250);
  hold.resolve(); assert.equal(await service.save(), true);
  assert.equal(state.saved.places[0].items[0].amount.value, 250);
  assert.equal(state.saved.places[0].items[0].enteredOn, '2026-10-20'); assert.equal(service.dirty(), false);
});

test('a failed queue retains subsequent changes and retries all of them in order', async () => {
  const { service, state } = setup(); state.saved = { places: [freezer] }; await service.load();
  const hold = gate(); state.saveGate = hold.promise;
  service.withdraw(freezer.id, item.id, 100); await Promise.resolve(); service.addItems(freezer.id, [product]);
  state.saveError = { message: 'Sin conexión' }; hold.resolve(); assert.equal(await service.save(), false);
  assert.equal(state.saved.places[0].items.length, 1); assert.equal(service.dirty(), true);
  state.saveError = null; assert.equal(await service.save(), true);
  assert.equal(state.saved.places[0].items[0].amount.value, 400); assert.equal(state.saved.places[0].items.length, 2);
});

test('retrying after a lost successful response neither duplicates lots nor withdraws twice', async () => {
  const { service, state } = setup(); state.saved = { places: [freezer] }; await service.load();
  state.lostResponse = true; service.addItems(freezer.id, [product]); await settle();
  assert.equal(service.dirty(), true); assert.equal(state.saved.places[0].items.length, 2);
  assert.equal(await service.save(), true); assert.equal(state.saved.places[0].items.length, 2);
  state.lostResponse = true; service.withdraw(freezer.id, item.id, 100); await settle();
  assert.equal(await service.save(), true); assert.equal(state.saved.places[0].items[0].amount.value, 400);
});

test('positive quantities below 0.01 remain valid and never display as zero', () => {
  for (const value of [0.001, 1e-9, Number.MIN_VALUE]) {
    const amount = { kind: 'specific', value, unit: 'g' };
    assert.equal(utils.validFreezerAmount(amount), true);
    assert.notEqual(utils.freezerAmountLabel(amount), '0 g');
  }
});

const prepared = { ...product, recipeId: 'eeeeeeee-1111-4111-8111-111111111111', name: 'Lentejas preparadas',
  amount: null, servings: 4, enteredOn: '2026-10-20', arrivedOn: '2026-10-20', space: 'pantry' };

test('prepared recipes require positive integer portions and keep their snapshots after partial consumption', () => {
  assert.equal(inventoryUtils.validInventory([{ ...freezer, items: [prepared] }]), true);
  for (const patch of [{ servings: 1.5 }, { servings: 0 }, { servings: null }, { servings: 2147483648 },
    { ingredientId: item.ingredientId }, { amount: item.amount }, { arrivedOn: '2026-10-19' }, { recipeId: 'bad' }, { space: 'fridge' }]) {
    assert.equal(inventoryUtils.validInventory([{ ...freezer, items: [{ ...prepared, ...patch }] }]), false, JSON.stringify(patch));
  }
  const remaining = inventoryUtils.withdrawInventoryItem(prepared, 1);
  assert.equal(remaining.servings, 3); assert.equal(remaining.name, prepared.name); assert.equal(remaining.enteredOn, prepared.enteredOn);
  assert.equal(inventoryUtils.withdrawInventoryItem(prepared, 4), null);
  for (const quantity of [0, -1, 0.5, 5, Infinity, NaN]) assert.throws(() => inventoryUtils.withdrawInventoryItem(prepared, quantity));
});

test('selection survives a fresh service instance and stays isolated by user', async () => {
  const { service, state, recreate } = setup(); state.saved = { places: [freezer] }; await service.load();
  service.select(freezer.id, 'freezer'); const restored = recreate(); await restored.load();
  assert.equal(restored.selectedId(), freezer.id); assert.equal(restored.selectedSpace(), 'freezer');
  state.owner = 'owner-b'; state.saved = { places: [] }; await restored.load();
  assert.equal(restored.selectedId(), ''); assert.equal(restored.selectedSpace(), 'pantry');
  state.owner = 'owner-a'; state.saved = { places: [freezer] }; await restored.load();
  assert.equal(restored.selectedId(), freezer.id); assert.equal(restored.selectedSpace(), 'freezer');
});

test('recipe deletion removes only the link and never the owned portions or their original name', async () => {
  const { service, state } = setup(); state.saved = { places: [{ ...freezer, items: [prepared] }] }; await service.load(); await settle();
  assert.ok(service.availableRecipeIds().includes(prepared.recipeId));
  state.deletedRecipes = [prepared.recipeId]; await service.refreshRecipeLinks(true);
  assert.deepEqual(plain(service.availableRecipeIds()), []);
  assert.equal(service.places()[0].items[0].name, prepared.name); assert.equal(service.places()[0].items[0].servings, 4);
});
