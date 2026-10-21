// Runs the real migration in PostgreSQL/WASM; temporary dependency documented in OPTIMIZACION.md.
const assert = require('node:assert/strict');
const { test, before, beforeEach, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.resolve('.angular/sql-validation/node_modules/@electric-sql/pglite'));
const read = file => fs.readFileSync(path.resolve(file), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const recipeA = '33333333-3333-4333-8333-333333333333';
const recipeB = '44444444-4444-4444-8444-444444444444';
const tomato = { id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Tomate', category: 'Verdura', occurrences: 3 };
const lettuce = { id: 'bbbbbbbb-1111-4111-8111-111111111111', name: 'Lechuga', category: 'Verdura', occurrences: 1 };
const sauce = { id: 'cccccccc-1111-4111-8111-111111111111', name: 'Salsa', category: 'Elaboracion', occurrences: 1 };
let db;
const rows = async sql => (await db.query(sql)).rows;
const save = (items, version) => db.query('select public.save_shopping_list($1::jsonb,$2) as version', [JSON.stringify(items), version]);
const preview = async (from = '2026-10-20', to = '2026-10-22') => (await db.query('select * from public.shopping_ingredients_from_plan($1,$2) order by name', [from,to])).rows;

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    create function public.is_recipe_editor() returns boolean language sql stable as $$ select current_setting('test.editor',true) = 'true' $$;
    insert into auth.users values ('${owner}'),('${other}');`);
  await db.exec(read('supabase/migrations/20261015000100_initial_schema.sql').split('create or replace function public.save_recipe')[0].replace('create extension if not exists pgcrypto;', ''));
  const daily = read('supabase/migrations/20261020000100_daily_meals.sql');
  await db.exec(daily.split('-- Preserve real dated meals.')[0]
    + daily.split('alter table public.scheduled_meals enable row level security;')[1].split('-- A single transaction')[0]
      .replace(/^/, 'alter table public.scheduled_meals enable row level security;') + 'commit;');
  await db.exec('grant select on public.ingredients,public.recipe_ingredients to authenticated;');
  await db.exec(read('supabase/migrations/20261020000400_shopping_lists.sql'));
  await db.exec(read('supabase/migrations/20261021000100_ingredient_categories.sql'));
});

beforeEach(async () => {
  await db.exec(`reset role; set test.editor='true'; set request.jwt.claim.sub='${owner}';
    truncate public.shopping_lists,public.scheduled_meals; truncate public.recipes,public.ingredients cascade;`);
  await db.query('insert into public.recipes(id,name,pending) values ($1,\'Hamburguesa\',false),($2,\'Tomate aliñado\',false)', [recipeA,recipeB]);
  for (const item of [tomato,lettuce,sauce]) await db.query('insert into public.ingredients(id,name,category) values($1,$2,$3)', [item.id,item.name,item.category]);
  await db.query('insert into public.recipe_ingredients(recipe_id,ingredient_id,amount_kind) values($1,$3,\'none\'),($1,$4,\'none\'),($1,$5,\'none\'),($2,$3,\'none\')', [recipeA,recipeB,tomato.id,lettuce.id,sauce.id]);
  await db.query('insert into public.ingredient_components(parent_ingredient_id,component_ingredient_id,amount_kind) values($1,$2,\'none\')', [sauce.id,tomato.id]);
  const fixtures = [
    [owner,'2026-10-19','lunch',recipeA], [owner,'2026-10-20','lunch',recipeA],
    [owner,'2026-10-20','dinner',recipeB], [owner,'2026-10-22','lunch',recipeB],
    [owner,'2026-10-23','lunch',recipeA], [other,'2026-10-21','lunch',recipeA],
  ];
  for (const [user,date,slot,recipeId] of fixtures) await db.query('insert into public.scheduled_meals(owner_id,meal_date,slot,servings,recipes) values($1,$2,$3,8,$4::jsonb)', [user,date,slot,JSON.stringify([{recipeId,mode:'leftovers'}])]);
  await db.exec('set role authenticated');
});
after(async () => { await db?.close(); });

test('planning counts occurrences inclusively without portions, other owners or elaboration expansion', async () => {
  assert.deepEqual(await preview(), [lettuce,sauce,tomato]);
  const today = await preview('2026-10-20','2026-10-20');
  assert.equal(today.find(item => item.id === tomato.id).occurrences, 2);
  assert.deepEqual(await preview('2027-01-01','2027-01-02'), []);
});

test('new ingredient categories can be stored, counted from planning and saved in shopping snapshots', async () => {
  const items = [
    { id: 'dddddddd-1111-4111-8111-111111111111', name: 'Agua', category: 'Liquidos', occurrences: 1 },
    { id: 'eeeeeeee-1111-4111-8111-111111111111', name: 'Almendras', category: 'FrutosSecos', occurrences: 1 },
  ];
  await db.exec('reset role');
  for (const item of items) {
    await db.query('insert into public.ingredients(id,name,category) values($1,$2,$3)', [item.id,item.name,item.category]);
    await db.query('insert into public.recipe_ingredients(recipe_id,ingredient_id,amount_kind) values($1,$2,\'none\')', [recipeA,item.id]);
  }
  await db.exec('set role authenticated');
  const calculated = await preview();
  for (const item of items) assert.deepEqual(calculated.find(row => row.id === item.id), item);
  await save(items,0);
  assert.deepEqual((await rows('select items from public.shopping_lists'))[0].items, items);
  assert.equal(calculated.find(row => row.id === tomato.id).occurrences, 3);
});

test('category migration can be reapplied, preserves existing data and keeps validation and grants restricted', async () => {
  await save([tomato],0);
  await db.exec('reset role');
  await db.exec(read('supabase/migrations/20261021000100_ingredient_categories.sql'));
  await assert.rejects(db.query('insert into public.ingredients(name,category) values(\'Invalid\',\'Unknown\')'), error => error.code === '23514');
  await db.exec('set role authenticated');
  assert.deepEqual((await rows('select items from public.shopping_lists'))[0].items, [tomato]);
  assert.deepEqual(await preview(), [lettuce,sauce,tomato]);
  await assert.rejects(save([{...tomato,category:'Unknown'}],1), error => error.code === '22023');
  await db.exec('set role anon');
  await assert.rejects(db.query('select public.valid_shopping_items(\'[]\'::jsonb)'), error => error.code === '42501');
});

test('saving creates a personal snapshot, versions updates and permits an empty list', async () => {
  assert.equal((await save([tomato],0)).rows[0].version, 1);
  assert.equal((await save([tomato,lettuce],1)).rows[0].version, 2);
  await db.exec("reset role; update public.ingredients set name='Tomate renombrado' where name='Tomate'; set role authenticated;");
  assert.equal((await rows('select items from public.shopping_lists'))[0].items[0].name, 'Tomate');
  assert.equal((await save([],2)).rows[0].version, 3);
  assert.deepEqual((await rows('select items from public.shopping_lists'))[0].items, []);
});

test('a stale create or update cannot overwrite the saved list', async () => {
  await save([tomato],0);
  await assert.rejects(save([lettuce],0), error => error.code === '40001');
  await save([tomato,sauce],1);
  await assert.rejects(save([lettuce],1), error => error.code === '40001');
  assert.deepEqual((await rows('select items from public.shopping_lists'))[0].items, [tomato,sauce]);
});

test('RLS isolates lists even between authorized editors and blocks foreign writes', async () => {
  await save([tomato],0);
  await db.exec(`set request.jwt.claim.sub='${other}'`);
  assert.deepEqual(await rows('select * from public.shopping_lists'), []);
  assert.equal((await preview())[0].occurrences, 1);
  assert.equal((await preview()).find(item => item.id === tomato.id).occurrences, 1);
  await assert.rejects(db.query('insert into public.shopping_lists(owner_id,items) values($1,$2::jsonb)', [owner,JSON.stringify([lettuce])]), error => error.code === '42501');
  assert.equal((await db.query('update public.shopping_lists set items=$1::jsonb where owner_id=$2 returning owner_id', [JSON.stringify([lettuce]),owner])).rows.length, 0);
  await save([lettuce],0);
  assert.equal((await rows('select * from public.shopping_lists')).length, 1);
  await db.exec(`set request.jwt.claim.sub='${owner}'`);
  assert.deepEqual((await rows('select items from public.shopping_lists'))[0].items, [tomato]);
});

test('anonymous and non-editor sessions cannot read lists or call shopping RPCs', async () => {
  await save([tomato],0); await db.exec('set role anon');
  await assert.rejects(rows('select * from public.shopping_lists'), error => error.code === '42501');
  await assert.rejects(save([],0), error => error.code === '42501');
  await assert.rejects(preview(), error => error.code === '42501');
  await db.exec("reset role; set test.editor='false'; set role authenticated;");
  assert.deepEqual(await rows('select * from public.shopping_lists'), []);
  await assert.rejects(save([],0), error => error.code === '42501');
  await assert.rejects(preview(), error => error.code === '42501');
});

test('SQL validation rejects malformed snapshots and duplicate UUIDs regardless of casing', async () => {
  for (const value of [null, {}, [null], [{...tomato,name:' '}], [{...tomato,id:'invalid'}], [{...tomato,category:'bad'}],
    [{...tomato,occurrences:0}], [{...tomato,occurrences:1.5}], [{...tomato,occurrences:'3'}],
    [{...tomato,occurrences:2147483648}], [tomato,{...tomato,id:tomato.id.toUpperCase()}]]) {
    await assert.rejects(save(value,0), error => error.code === '22023');
  }
  assert.deepEqual(await rows('select * from public.shopping_lists'), []);
});

test('reversed or missing dates and invalid expected versions are rejected', async () => {
  await assert.rejects(preview('2026-10-22','2026-10-20'), error => error.code === '22023');
  await assert.rejects(preview(null,'2026-10-20'), error => error.code === '22023');
  await assert.rejects(save([],null), error => error.code === '22023');
  await assert.rejects(save([],-1), error => error.code === '22023');
});

test('deleted planned recipes are ignored while a saved shopping snapshot remains usable', async () => {
  await save([tomato,lettuce,sauce],0);
  await db.exec(`reset role; delete from public.recipes where id='${recipeA}'; set role authenticated;`);
  assert.deepEqual(await preview(), [{...tomato,occurrences:2}]);
  assert.deepEqual((await rows('select items from public.shopping_lists'))[0].items, [tomato,lettuce,sauce]);
});
