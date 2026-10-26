const assert = require('node:assert/strict');
const { test, before, beforeEach, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.resolve('.angular/sql-validation/node_modules/@electric-sql/pglite'));
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const item = { id: 'aaaaaaaa-1111-4111-8111-111111111111', ingredientId: null, name: 'Arroz con verduras de Mercadona',
  category: null, enteredOn: '2026-10-26', amount: { kind: 'specific', value: 2, unit: 'pieza' } };
const freezer = { id: 'bbbbbbbb-1111-4111-8111-111111111111', name: 'Casa', items: [item] };
let db;
const save = (freezers, version) => db.query('select public.save_freezer_inventory($1::jsonb,$2) as version', [JSON.stringify(freezers), version]);
const saved = async () => (await db.query('select freezers from public.freezer_inventories')).rows;

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    create function public.is_recipe_editor() returns boolean language sql stable as $$ select current_setting('test.editor',true) = 'true' $$;
    insert into auth.users values ('${owner}'),('${other}');`);
  await db.exec(fs.readFileSync('supabase/migrations/20261026000100_freezer_inventories.sql', 'utf8'));
});
beforeEach(async () => {
  await db.exec(`reset role; truncate public.freezer_inventories; set test.editor='true'; set request.jwt.claim.sub='${owner}'; set role authenticated;`);
});
after(async () => { await db?.close(); });

test('real migration saves multiple private freezers, versioned updates and an empty inventory', async () => {
  const second = { ...freezer, id: other, name: 'Casa alquilada', items: [] };
  assert.equal((await save([freezer, second], 0)).rows[0].version, 1);
  assert.deepEqual((await saved())[0].freezers, [freezer, second]);
  assert.equal((await save([{ ...freezer, items: [] }], 1)).rows[0].version, 2);
  assert.equal((await save([], 2)).rows[0].version, 3); assert.deepEqual((await saved())[0].freezers, []);
});

test('RLS prevents reading or overwriting another editor inventory, including direct table writes', async () => {
  await save([freezer], 0); await db.exec(`set request.jwt.claim.sub='${other}'`);
  assert.deepEqual(await saved(), []);
  assert.equal((await db.query('update public.freezer_inventories set freezers=\'[]\' where owner_id=$1 returning *', [owner])).rows.length, 0);
  await assert.rejects(db.query('insert into public.freezer_inventories(owner_id) values ($1)', [owner]), error => error.code === '42501');
  await save([], 0); await db.exec(`set request.jwt.claim.sub='${owner}'`); assert.deepEqual((await saved())[0].freezers, [freezer]);
});

test('anonymous, non-editor and unauthenticated callers cannot read or save inventories', async () => {
  await save([freezer], 0); await db.exec('set test.editor=\'false\''); assert.deepEqual(await saved(), []);
  await assert.rejects(save([], 1), error => error.code === '42501');
  await db.exec('set test.editor=\'true\'; set request.jwt.claim.sub=\'\'');
  assert.deepEqual(await saved(), []); await assert.rejects(save([], 1), error => error.code === '42501');
  await db.exec('set role anon'); await assert.rejects(saved(), error => error.code === '42501');
  await assert.rejects(save([], 1), error => error.code === '42501');
  await assert.rejects(db.query('select public.valid_freezer_inventory(\'[]\')'), error => error.code === '42501');
});

test('stale creates and updates are rejected atomically without overwriting inventory', async () => {
  await save([freezer], 0);
  await assert.rejects(save([], 0), error => error.code === '40001');
  await save([{ ...freezer, name: 'Renombrado' }], 1);
  await assert.rejects(save([], 1), error => error.code === '40001');
  assert.equal((await saved())[0].freezers[0].name, 'Renombrado');
});

test('SQL validation rejects malformed shapes, duplicate IDs, impossible dates and invalid quantities', async () => {
  const invalid = [null, {}, [{ ...freezer, name: '\n ' }], [freezer, { ...freezer, id: freezer.id.toUpperCase() }]];
  for (const patch of [{ id: 'bad' }, { ingredientId: 'bad' }, { category: 'Otro' }, { enteredOn: '2026-02-30' },
    { enteredOn: '0000-01-01' }, { enteredOn: '2026-2-3' }, { enteredOn: null }, { name: '\t' }, { amount: {} },
    { amount: { kind: 'specific', value: 0, unit: 'g' } }, { amount: { kind: 'specific', value: -1, unit: 'g' } },
    { amount: { kind: 'specific', value: '1', unit: 'g' } }, { amount: { kind: 'specific', value: 2, unit: 'kg' } }]) {
    invalid.push([{ ...freezer, items: [{ ...item, ...patch }] }]);
  }
  invalid.push([{ ...freezer, items: [item, { ...item, id: item.id.toUpperCase() }] }]);
  invalid.push([freezer, { ...freezer, id: other }]);
  const missing = structuredClone(freezer); delete missing.items[0].amount; invalid.push([missing]);
  for (const value of invalid) await assert.rejects(save(value, 0), error => error.code === '22023', JSON.stringify(value));
  assert.deepEqual(await saved(), []);
  await assert.rejects(db.query('insert into public.freezer_inventories(freezers) values($1::jsonb)', [JSON.stringify(invalid.at(-1))]), error => error.code === '23514');
});

test('ingredients are snapshots and repeated ingredient references retain their separate dates', async () => {
  const ingredient = { ...item, ingredientId: other, category: 'Elaboracion', amount: { kind: 'glass' } };
  const nextLot = { ...ingredient, id: other, enteredOn: '2026-10-20', amount: null };
  const entries = [{ ...freezer, items: [ingredient, nextLot] }];
  await save(entries, 0); assert.deepEqual((await saved())[0].freezers, entries);
  for (const category of ['Liquidos', 'FrutosSecos', 'Carne']) {
    await db.exec('reset role; truncate public.freezer_inventories; set role authenticated');
    await save([{ ...freezer, items: [{ ...ingredient, category, amount: { kind: 'spoon' } }] }], 0);
  }
});
