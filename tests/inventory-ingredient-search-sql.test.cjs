const assert=require('node:assert/strict');
const {test,before,after}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(path.resolve('.angular/sql-validation/node_modules/@electric-sql/pglite'));
const ids=['aaaaaaaa-1111-4111-8111-111111111111','bbbbbbbb-1111-4111-8111-111111111111','cccccccc-1111-4111-8111-111111111111'];
let db;
const search=async(ingredients,sort='name')=>(await db.query('select id from public.search_recipes_with_all_ingredients($1::uuid[],$2)',[ingredients,sort])).rows.map(row=>row.id);
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;
    create table public.recipes(id uuid primary key,name text,rating integer,minutes integer,created_at timestamptz);
    create table public.recipe_ingredients(recipe_id uuid,ingredient_id uuid);
    alter table public.recipes enable row level security;alter table public.recipe_ingredients enable row level security;
    create policy readable_recipes on public.recipes for select to anon,authenticated using(name<>'Private');
    create policy readable_ingredients on public.recipe_ingredients for select to anon,authenticated using(true);
    grant select on public.recipes,public.recipe_ingredients to anon,authenticated;`);
  for(let index=0;index<3;index++){
    await db.query('insert into public.recipes values($1,$2,$3,$4,$5::timestamptz)',[ids[index],['Arroz completo','Arroz solo','Private'][index],index+1,30-index*10,'2026-10-2'+(index+1)]);
    for(const ingredientId of index===1?[ids[0]]:ids.slice(0,2))await db.query('insert into public.recipe_ingredients values($1,$2)',[ids[index],ingredientId]);
  }
  await db.exec(fs.readFileSync('supabase/migrations/20261020000200_recipe_ingredient_search.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261027000500_inventory_ingredient_search.sql','utf8'));
  await db.exec('set role authenticated');
});
after(async()=>{await db?.close();});
test('all selected ingredients must exist in a recipe, while additional recipe ingredients remain allowed',async()=>{
  assert.deepEqual(await search(ids.slice(0,2)),[ids[0]]);assert.deepEqual(await search([ids[0]]),ids.slice(0,2));
  assert.deepEqual(await search([ids[1]]),[ids[0]]);assert.deepEqual(await search(ids),[]);
});
test('empty, null and unknown selections never become an unfiltered catalogue search',async()=>{
  for(const selected of [[],null,[null],[ids[2]]])assert.deepEqual(await search(selected),[]);
});
test('duplicate and differently cased UUIDs retain correct all-match results',async()=>{
  assert.deepEqual(await search([ids[0],ids[0].toUpperCase(),ids[1]]),[ids[0]]);
});
test('filtering occurs before counts and pagination, with stable requested ordering',async()=>{
  const result=(await db.query('select id,count(*) over()::integer as total from public.search_recipes_with_all_ingredients($1::uuid[],$2) limit 1 offset 0',[ids.slice(0,2),'rating'])).rows;
  assert.deepEqual(result,[{id:ids[0],total:1}]);assert.deepEqual(await search([ids[0]],'time'),[ids[1],ids[0]]);
  assert.deepEqual(await search([ids[0]],'recent'),[ids[1],ids[0]]);
});
test('the public any-match search retains its original behavior and row policies protect both RPCs',async()=>{
  const result=(await db.query('select id from public.search_recipes_by_ingredients($1::uuid[],$2)',[ids.slice(0,2),'name'])).rows;
  assert.deepEqual(result.map(row=>row.id),ids.slice(0,2));
  await db.exec('set role anon');assert.deepEqual(await search(ids.slice(0,2)),[ids[0]]);
  assert.equal((await db.query("select has_table_privilege('anon','public.recipes','UPDATE') as allowed")).rows[0].allowed,false);
});
