const assert = require('node:assert/strict');
const { test, before, beforeEach, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.resolve('.angular/sql-validation/node_modules/@electric-sql/pglite'));
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const ids = ['aaaaaaaa-1111-4111-8111-111111111111', 'bbbbbbbb-1111-4111-8111-111111111111',
  'cccccccc-1111-4111-8111-111111111111', 'dddddddd-1111-4111-8111-111111111111',
  'eeeeeeee-1111-4111-8111-111111111111', 'ffffffff-1111-4111-8111-111111111111'];
let db;
const append = async (id = ids[0], slot = 'lunch', servings = 2, mode = 'scale', date = '2026-10-26') =>
  (await db.query('select public.add_scheduled_recipe($1::date,$2,$3,$4::uuid,$5) as result', [date, slot, servings, id, mode])).rows[0].result;
const meals = async () => (await db.query('select meal_date::text,slot,servings,recipes from public.scheduled_meals order by meal_date,slot')).rows;
const save = (date, items) => db.query('select public.save_scheduled_day($1::date,$2::jsonb)', [date, JSON.stringify(items)]);

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    create function public.is_recipe_editor() returns boolean language sql stable as $$ select current_setting('test.editor',true)='true' $$;
    insert into auth.users values ('${owner}'),('${other}');
    create table public.recipes(id uuid primary key, name text, pending boolean default true);
    grant select,update on public.recipes to authenticated;
    create table public.meal_plans(id uuid, owner_id uuid, start_date date,end_date date,kind text,servings integer,entries jsonb,updated_at timestamptz);`);
  await db.exec(fs.readFileSync('supabase/migrations/20261020000100_daily_meals.sql', 'utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261026000300_add_scheduled_recipe.sql', 'utf8'));
});
beforeEach(async () => {
  await db.exec(`reset role; truncate public.scheduled_meals,public.recipes; set test.editor='true'; set request.jwt.claim.sub='${owner}';`);
  for (const id of ids) await db.query('insert into public.recipes(id,name) values($1,$2)', [id, id]);
  await db.exec('set role authenticated');
});
after(async () => { await db?.close(); });

test('creates only the chosen meal and persists preparation without marking the recipe as prepared', async () => {
  const result = await append(ids[0], 'dinner', 3, 'leftovers');
  assert.deepEqual(result, { added: true, meal: { date: '2026-10-26', slot: 'dinner', servings: 3, recipes: [{ recipeId: ids[0], mode: 'leftovers' }] } });
  assert.equal((await meals()).length, 1);
  assert.equal((await db.query('select pending from public.recipes where id=$1', [ids[0]])).rows[0].pending, true);
});

test('appends to the latest stored meal, retaining all other recipes, slots, dates and servings', async () => {
  await append(ids[0], 'lunch', 4, 'leftovers'); await append(ids[1], 'breakfast');
  await append(ids[2], 'dinner', 5); await append(ids[3], 'lunch', 2, 'scale', '2026-10-27');
  const before = await meals();
  const result = await append(ids[4], 'lunch', 4);
  assert.deepEqual(result.meal.recipes, [{ recipeId: ids[0], mode: 'leftovers' }, { recipeId: ids[4], mode: 'scale' }]);
  assert.equal(result.meal.servings, 4);
  const after = await meals();
  for (const meal of before.filter(row => row.meal_date !== '2026-10-26' || row.slot !== 'lunch')) assert.deepEqual(after.find(row => row.meal_date === meal.meal_date && row.slot === meal.slot), meal);
});

test('retries and case-insensitive duplicate requests do not add again or change an existing mode', async () => {
  await append(ids[0], 'lunch', 4, 'leftovers');
  const result = await append(ids[0].toUpperCase(), 'lunch', 2, 'scale');
  assert.equal(result.added, false); assert.equal(result.meal.servings, 4);
  assert.deepEqual(result.meal.recipes, [{ recipeId: ids[0], mode: 'leftovers' }]);
  await append(ids[0], 'dinner'); await append(ids[0], 'lunch', 2, 'scale', '2026-10-27'); assert.equal((await meals()).length, 3);
});

test('preserves meals when the fifth-recipe limit is reached and still accepts idempotent retries', async () => {
  for (const id of ids.slice(0, 5)) await append(id);
  const before = await meals();
  await assert.rejects(append(ids[5]), error => error.code === '22023' && /cinco/.test(error.message));
  assert.deepEqual(await meals(), before); assert.equal((await append(ids[0])).added, false);
});

test('changed serving counts cause a conflict without overwriting the meal', async () => {
  await append(ids[0], 'lunch', 4); const before = await meals();
  await assert.rejects(append(ids[1], 'lunch', 2), error => error.code === '40001');
  assert.deepEqual(await meals(), before);
  assert.equal((await append(ids[1], 'lunch', 4)).meal.recipes.length, 2);
});

test('an existing meal created since the preview is preserved when another recipe is appended', async () => {
  await save('2026-10-26', [{ slot: 'lunch', servings: 2, recipes: [{ recipeId: ids[0], mode: 'leftovers' }] }]);
  const result = await append(ids[1]);
  assert.deepEqual(result.meal.recipes, [{ recipeId: ids[0], mode: 'leftovers' }, { recipeId: ids[1], mode: 'scale' }]);
});

test('invalid inputs and missing recipes never create or alter meals', async () => {
  const invalid = [[null, 'lunch', 2, 'scale'], [ids[0], null, 2, 'scale'], [ids[0], 'snack', 2, 'scale'],
    [ids[0], 'lunch', null, 'scale'], [ids[0], 'lunch', 0, 'scale'], [ids[0], 'lunch', 101, 'scale'],
    [ids[0], 'lunch', 2, null], [ids[0], 'lunch', 2, 'wrong'], [other, 'lunch', 2, 'scale']];
  for (const args of invalid) await assert.rejects(append(...args), error => error.code === '22023');
  await assert.rejects(append(ids[0], 'lunch', 2, 'scale', null), error => error.code === '22023');
  assert.deepEqual(await meals(), []);
});

test('each user adds only to their own planning, including identical recipe and date selections', async () => {
  await append(ids[0]); await db.exec(`set request.jwt.claim.sub='${other}'`); assert.deepEqual(await meals(), []);
  await append(ids[1]); assert.equal((await meals())[0].recipes[0].recipeId, ids[1]);
  await db.exec(`set request.jwt.claim.sub='${owner}'`); assert.equal((await meals())[0].recipes[0].recipeId, ids[0]);
});

test('anonymous, non-editor and unauthenticated callers cannot invoke the append RPC', async () => {
  await db.exec("set test.editor='false'"); await assert.rejects(append(), error => error.code === '42501');
  await db.exec("set test.editor='true'; set request.jwt.claim.sub=''"); await assert.rejects(append(), error => error.code === '42501');
  await db.exec('set role anon'); await assert.rejects(append(), error => error.code === '42501');
});
