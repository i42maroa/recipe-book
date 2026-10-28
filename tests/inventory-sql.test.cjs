const assert = require('node:assert/strict');
const { test, before, beforeEach, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.resolve('.angular/sql-validation/node_modules/@electric-sql/pglite'));
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const placeId = 'bbbbbbbb-1111-4111-8111-111111111111';
const item = { id: 'aaaaaaaa-1111-4111-8111-111111111111', ingredientId: null, name: 'Arroz con verduras',
  category: null, recipeId: null, servings: null, space: 'freezer', arrivedOn: '2026-10-26', enteredOn: '2026-10-26', amount: { kind: 'specific', value: 2, unit: 'pieza' } };
const second = { ...item, id: 'cccccccc-1111-4111-8111-111111111111', name: 'Pollo' };
const metadata = (id, before, after) => ({ placeId: id, itemId: null, before, after });
const lot = (before, after, id = placeId) => ({ placeId: id, itemId: (after ?? before).id, before, after });
const create = (id = placeId, name = 'Casa') => metadata(id, null, { name });
let db, migrated, legacy;
const apply = changes => db.query('select public.apply_inventory_changes($1::jsonb) as saved', [JSON.stringify(changes)]);
const saved = async () => (await db.query('select public.get_inventory() as inventory')).rows[0].inventory;

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    create function public.is_recipe_editor() returns boolean language sql stable as $$ select current_setting('test.editor',true) = 'true' $$;
    insert into auth.users values ('${owner}'),('${other}');`);
  await db.exec(fs.readFileSync('supabase/migrations/20261026000100_freezer_inventories.sql', 'utf8'));
  legacy = [{ id: placeId, name: 'Casa', items: [item, { ...second, amount: { kind: 'specific', value: 1e-9, unit: 'g' } }] },
    { id: other, name: 'Alquiler', items: [] }];
  const oldFormat = legacy.map(place => ({ ...place, items: place.items.map(({ recipeId, servings, space, arrivedOn, ...oldItem }) => oldItem) }));
  await db.query('insert into public.freezer_inventories(owner_id, freezers) values ($1,$2::jsonb)', [owner, JSON.stringify(oldFormat)]);
  await db.exec(fs.readFileSync('supabase/migrations/20261026000200_freezer_entries.sql', 'utf8'));
  await db.exec('create table public.recipes (id uuid primary key, name text); grant select on public.recipes to authenticated;');
  await db.exec(fs.readFileSync('supabase/migrations/20261027000100_inventory_places.sql', 'utf8'));
  await db.exec(`set test.editor='true'; set request.jwt.claim.sub='${owner}'; set role authenticated;`);
  migrated = await saved();
});
beforeEach(async () => {
  await db.exec(`reset role; truncate public.inventory_places cascade; set test.editor='true'; set request.jwt.claim.sub='${owner}'; set role authenticated;`);
});
after(async () => { await db?.close(); });

test('migration preserves all freezer names, order, dates and even tiny legacy quantities', () => {
  assert.deepEqual(migrated, legacy);
});

test('incremental writes create, rename, add, edit, withdraw and remove without replacing other rows', async () => {
  await apply([create(), create(other, 'Alquiler'), lot(null, item), lot(null, second)]);
  const withdrawn = { ...item, amount: { ...item.amount, value: 1 } };
  await apply([lot(item, withdrawn)]);
  await apply([metadata(placeId, { name: 'Casa' }, { name: 'Mi casa' })]);
  const stock = await saved();
  assert.equal(stock[0].name, 'Mi casa'); assert.deepEqual(stock[0].items, [withdrawn, second]);
  assert.deepEqual(stock[1], { id: other, name: 'Alquiler', items: [] });
  await apply([lot(withdrawn, null), lot(second, null), metadata(placeId, { name: 'Mi casa' }, null)]);
  assert.deepEqual(await saved(), [stock[1]]);
});

test('unchanged rows are not rewritten when a single lot changes', async () => {
  await apply([create(), lot(null, item), lot(null, second)]);
  const before = (await db.query('select id, xmin::text, position from public.inventory_entries order by position')).rows;
  await apply([lot(item, { ...item, name: 'Arroz nuevo' })]);
  const after = (await db.query('select id, xmin::text, position from public.inventory_entries order by position')).rows;
  assert.notEqual(after[0].xmin, before[0].xmin);
  assert.deepEqual(after[1], before[1]);
});

test('independent lots and freezers do not conflict, but stale changes to the same lot do', async () => {
  await apply([create(), create(other, 'Alquiler'), lot(null, item), lot(null, second)]);
  await apply([lot(item, { ...item, name: 'Nuevo arroz' })]);
  await apply([lot(second, { ...second, name: 'Nuevo pollo' })]);
  await apply([metadata(other, { name: 'Alquiler' }, { name: 'Piso' })]);
  await assert.rejects(apply([lot(item, { ...item, name: 'Cambio antiguo' })]), error => error.code === '40001');
  assert.equal((await saved())[0].items[0].name, 'Nuevo arroz');
});

test('repeating successful creates, edits and deletes is idempotent after a lost response', async () => {
  const addition = [create(), lot(null, item)]; await apply(addition); await apply(addition);
  assert.equal((await saved())[0].items.length, 1);
  const change = [lot(item, { ...item, amount: { ...item.amount, value: 1 } })];
  await apply(change); await apply(change); assert.equal((await saved())[0].items[0].amount.value, 1);
  const removal = [lot(change[0].after, null), metadata(placeId, { name: 'Casa' }, null)];
  await apply(removal); await apply(removal); assert.deepEqual(await saved(), []);
});

test('a batch rolls back earlier changes if a later operation conflicts or is invalid', async () => {
  await apply([create(), lot(null, item)]);
  await assert.rejects(apply([lot(null, second), lot({ ...item, name: 'Old' }, null)]), error => error.code === '40001');
  assert.deepEqual((await saved())[0].items, [item]);
  await assert.rejects(apply([lot(null, second), lot(item, { ...item, amount: { kind: 'specific', value: 0, unit: 'g' } })]), error => error.code === '22023');
  assert.deepEqual((await saved())[0].items, [item]);
});

test('nonempty freezers cannot be deleted and item identifiers cannot move between freezers', async () => {
  await apply([create(), create(other, 'Alquiler'), lot(null, item)]);
  await assert.rejects(apply([metadata(placeId, { name: 'Casa' }, null)]), error => error.code === '22023');
  await assert.rejects(apply([lot(null, item, other)]), error => error.code === '23505');
  assert.equal((await saved())[0].items.length, 1); assert.equal((await saved())[1].items.length, 0);
});

test('RLS protects both tables and operations cannot choose a different owner', async () => {
  await apply([create(), lot(null, item)]); await db.exec(`set request.jwt.claim.sub='${other}'`);
  assert.deepEqual(await saved(), []);
  assert.equal((await db.query('update public.inventory_entries set entry=entry returning id')).rows.length, 0);
  assert.equal((await db.query('delete from public.inventory_places returning id')).rows.length, 0);
  await assert.rejects(db.query('insert into public.inventory_places(owner_id,id,name) values ($1,$2,\'Ajeno\')', [owner, other]), error => error.code === '42501');
  await apply([create(), lot(null, item)]); assert.equal((await saved())[0].items.length, 1);
  await db.exec(`set request.jwt.claim.sub='${owner}'`); assert.equal((await saved())[0].items.length, 1);
});

test('anonymous, unauthenticated and non-editor users cannot write or read private rows', async () => {
  await apply([create(), lot(null, item)]);
  await db.exec("set test.editor='false'"); assert.deepEqual(await saved(), []);
  await assert.rejects(apply([create(other)]), error => error.code === '42501');
  await db.exec("set test.editor='true'; set request.jwt.claim.sub=''"); assert.deepEqual(await saved(), []);
  await assert.rejects(apply([create(other)]), error => error.code === '42501');
  await db.exec('set role anon'); await assert.rejects(saved(), error => error.code === '42501');
  await assert.rejects(apply([create(other)]), error => error.code === '42501');
});

test('the archived document and old save RPC are inaccessible to clients', async () => {
  await assert.rejects(db.query('select * from public.freezer_inventories'), error => error.code === '42501');
  await assert.rejects(db.query('select public.save_freezer_inventory(\'[]\',0)'), error => error.code === '42501');
});

test('malformed batches, dates, categories and nonpositive quantities are rejected', async () => {
  for (const value of [null, {}, [], [{ placeId, itemId: null, after: { name: 'Casa' } }]]) {
    await assert.rejects(apply(value), error => error.code === '22023');
  }
  await apply([create()]);
  for (const patch of [{ name: ' ' }, { enteredOn: '2026-02-30' }, { category: 'Carne' },
    { amount: { kind: 'specific', value: 0, unit: 'g' } }, { amount: { kind: 'specific', value: -1, unit: 'g' } }]) {
    await assert.rejects(apply([lot(null, { ...item, ...patch })]), error => error.code === '22023');
  }
  await apply([lot(null, { ...item, amount: { kind: 'specific', value: 1e-9, unit: 'g' } })]);
  assert.equal((await saved())[0].items[0].amount.value, 1e-9);
});

const recipeId = 'eeeeeeee-1111-4111-8111-111111111111';
const recipeLot = { ...item, recipeId, servings: 4, amount: null, name: 'Lentejas preparadas',
  enteredOn: '2026-10-20', arrivedOn: '2026-10-20', space: 'pantry' };

test('recipe lots accept only whole positive portions and valid arrival dates in the two fixed spaces', async () => {
  await apply([create()]);
  for (const patch of [{ servings: 0 }, { servings: -1 }, { servings: 1.5 }, { servings: '2' }, { servings: null },
    { servings: 2147483648 }, { recipeId: 'bad' }, { amount: item.amount }, { category: 'Carne' },
    { space: 'fridge' }, { arrivedOn: '2026-10-19' }, { arrivedOn: '2026-02-30' }, { arrivedOn: null }]) {
    await assert.rejects(apply([lot(null, { ...recipeLot, ...patch })]), error => error.code === '22023');
  }
  await apply([lot(null, recipeLot)]); assert.deepEqual((await saved())[0].items, [recipeLot]);
});

test('partial transfers across places are atomic, conserve portions and can safely retry a lost response', async () => {
  await apply([create(), create(other, 'Galaroza'), lot(null, recipeLot)]);
  const source = { ...recipeLot, servings: 2 };
  const destination = { ...recipeLot, id: second.id, servings: 2, space: 'freezer', arrivedOn: '2026-10-27' };
  const transfer = [lot(recipeLot, source), lot(null, destination, other)];
  await apply(transfer); await apply(transfer);
  const places = await saved(); assert.deepEqual(places[0].items, [source]); assert.deepEqual(places[1].items, [destination]);
  await assert.rejects(apply([lot(source, { ...source, servings: 1 }),
    lot(null, { ...destination, id: owner }, '99999999-1111-4111-8111-111111111111')]), error => error.code === '40001');
  assert.deepEqual(await saved(), places);
});

test('complete transfers retain identifiers and never duplicate or lose lots on retry', async () => {
  await apply([create(), create(other, 'Galaroza'), lot(null, item)]);
  const destination = { ...item, space: 'pantry', arrivedOn: '2026-10-27' };
  const transfer = [lot(item, null), lot(null, destination, other)];
  await apply(transfer); await apply(transfer);
  const places = await saved(); assert.equal(places[0].items.length, 0); assert.deepEqual(places[1].items, [destination]);
  const movedAgain = { ...destination, space: 'freezer', arrivedOn: '2026-10-28' };
  await apply([lot(destination, movedAgain, other)]);
  assert.deepEqual((await saved())[1].items, [movedAgain]);
});

test('a stale source quantity rolls back the destination of a transfer', async () => {
  await apply([create(), create(other, 'Galaroza'), lot(null, recipeLot)]);
  await apply([lot(recipeLot, { ...recipeLot, servings: 3 })]);
  await assert.rejects(apply([lot(null, { ...recipeLot, id: second.id, servings: 2 }, other),
    lot(recipeLot, { ...recipeLot, servings: 2 })]), error => error.code === '40001');
  const places = await saved(); assert.equal(places[0].items[0].servings, 3); assert.equal(places[1].items.length, 0);
});

test('renaming or deleting a recipe keeps owned portions and their original name, but updates link availability', async () => {
  await db.exec('reset role'); await db.query('insert into public.recipes(id,name) values($1,$2)', [recipeId, 'Lentejas']);
  await db.exec('set role authenticated');
  await apply([create(), lot(null, recipeLot)]);
  const links = () => db.query('select public.inventory_recipe_ids($1::uuid[]) as ids', [[recipeId]]);
  assert.deepEqual((await links()).rows[0].ids, [recipeId]);
  await db.exec('reset role'); await db.query('update public.recipes set name=$1 where id=$2', ['Otro nombre', recipeId]);
  await db.exec('set role authenticated'); assert.equal((await saved())[0].items[0].name, recipeLot.name);
  await db.exec('reset role'); await db.query('delete from public.recipes where id=$1', [recipeId]);
  await db.exec('set role authenticated'); assert.deepEqual((await links()).rows[0].ids, []);
  assert.deepEqual((await saved())[0].items, [recipeLot]);
  await apply([lot(recipeLot, { ...recipeLot, servings: 3 })]); assert.equal((await saved())[0].items[0].servings, 3);
});

test('legacy clients cannot read or write an inventory parallel to the migrated places', async () => {
  for (const sql of ['select * from public.freezers', 'select * from public.freezer_entries',
    'select public.get_freezer_inventory()', "select public.apply_freezer_changes('[]'::jsonb)"]) {
    await assert.rejects(db.query(sql), error => error.code === '42501');
  }
});
