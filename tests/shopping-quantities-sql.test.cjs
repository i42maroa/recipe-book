const assert=require('node:assert/strict');
const {test,before,beforeEach,after}=require('node:test');
const fs=require('node:fs');const path=require('node:path');
const {PGlite}=require(path.resolve('.angular/sql-validation/node_modules/@electric-sql/pglite'));
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const ingredient='aaaaaaaa-1111-4111-8111-111111111111',recipe='bbbbbbbb-1111-4111-8111-111111111111',place='cccccccc-1111-4111-8111-111111111111',operation='dddddddd-1111-4111-8111-111111111111';
const item={id:ingredient,name:'Tomate',category:'Verdura',occurrences:2,amounts:[{kind:'specific',unit:'g',value:350}],unquantified:0};
let db;
const execMigration=async name=>db.exec(fs.readFileSync('supabase/migrations/'+name+'.sql','utf8').replace('create extension if not exists pgcrypto;',''));
const buy=(items=[item],version=0,op=operation,destination=place)=>db.query('select public.complete_shopping_purchase($1::uuid,$2::bigint,$3::jsonb,$4::uuid,$5::date) as version',[op,version,JSON.stringify(items),destination,'2026-10-27']);
const quantities=async()=> (await db.query('select source,id,name,amount,factor,missing_servings from public.shopping_plan_amounts($1::date,$2::date) order by source',['2026-10-27','2026-10-29'])).rows;
const stock=async()=> (await db.query('select entry from public.inventory_entries order by position')).rows.map(row=>row.entry);
before(async()=>{
  db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    create function public.is_recipe_editor() returns boolean language sql stable as $$select current_setting('test.editor',true)='true'$$;
    insert into auth.users values('${owner}'),('${other}');
    create table public.meal_plans(id uuid,owner_id uuid,start_date date,end_date date,kind text,servings integer,entries jsonb,updated_at timestamptz);`);
  for(const migration of ['20261015000100_initial_schema','20261020000100_daily_meals','20261020000400_shopping_lists','20261021000100_ingredient_categories','20261026000100_freezer_inventories','20261026000200_freezer_entries','20261027000100_inventory_places','20261027000200_ingredient_measures','20261027000300_inventory_empty_amounts','20261027000600_shopping_quantities_purchase'])await execMigration(migration);
  await db.exec(`grant select,insert,update,delete on public.recipes,public.ingredients,public.recipe_ingredients to authenticated;
    create policy editor_access on public.recipes for all to authenticated using(true) with check(true);
    create policy editor_access on public.ingredients for all to authenticated using(true) with check(true);
    create policy editor_access on public.recipe_ingredients for all to authenticated using(true) with check(true);`);
});
beforeEach(async()=>{
  await db.exec(`reset role;truncate public.shopping_purchases,public.shopping_lists,public.scheduled_meals;truncate public.inventory_places cascade;truncate public.recipes cascade;truncate public.ingredients cascade;
    set test.editor='true';set request.jwt.claim.sub='${owner}';
    insert into public.inventory_places(owner_id,id,name) values('${owner}','${place}','Galaroza'),('${other}','${other}','Ajeno');
    insert into public.ingredients(id,name,category,base_unit,unit_quantity) values('${ingredient}','Tomate','Verdura','g',150);
    insert into public.recipes(id,name,pending,servings) values('${recipe}','Arroz',false,4);
    insert into public.recipe_ingredients(recipe_id,ingredient_id,amount_kind,amount_value,amount_unit) values('${recipe}','${ingredient}','specific',200,'g');set role authenticated;`);
});
after(async()=>{await db?.close();});
const meal=async(date,slot,servings,mode='scale',inventory=false)=>db.query('insert into public.scheduled_meals(owner_id,meal_date,slot,servings,recipes) values(auth.uid(),$1::date,$2,$3,$4::jsonb)',[date,slot,servings,JSON.stringify([{recipeId:recipe,mode,...(inventory?{inventory:{placeId:place,itemId:operation,placeName:'Galaroza',space:'freezer'}}:{})}])]);

test('planning returns real quantities with scaling and complete-batch leftovers, within the owned date interval',async()=>{
  await meal('2026-10-27','lunch',2);await meal('2026-10-28','dinner',5,'leftovers');await meal('2026-10-26','lunch',2);
  const rows=await quantities();assert.deepEqual(rows.map(row=>Number(row.factor)),[0.5,2]);assert.equal(rows[0].amount.value,200);
});
test('prepared inventory dishes and another owner meals generate no ingredient requirements',async()=>{
  await meal('2026-10-27','lunch',2,'scale',true);await db.exec(`set request.jwt.claim.sub='${other}'`);await meal('2026-10-27','lunch',2);
  await db.exec(`set request.jwt.claim.sub='${owner}'`);assert.deepEqual(await quantities(),[]);
});
test('missing recipe servings are flagged, without inventing a multiplier or losing ingredient quantities',async()=>{
  await db.query('update public.recipes set servings=null where id=$1',[recipe]);await meal('2026-10-27','lunch',6);
  const row=(await quantities())[0];assert.equal(Number(row.factor),1);assert.equal(row.missing_servings,true);
});
test('purchase atomically creates pantry lots and clears the list, including an initially unsaved draft',async()=>{
  const result=await buy();assert.equal(Number(result.rows[0].version),1);const lots=await stock();assert.equal(lots.length,1);
  assert.deepEqual(lots[0].amount,item.amounts[0]);assert.equal(lots[0].space,'pantry');assert.equal(lots[0].enteredOn,'2026-10-27');
  assert.deepEqual((await db.query('select items from public.shopping_lists')).rows[0].items,[]);
});
test('repeating a purchase after a lost response never adds duplicate stock or clears a later list',async()=>{
  await buy();await db.query('select public.save_shopping_list($1::jsonb,1)',[JSON.stringify([item])]);await buy();
  assert.equal((await stock()).length,1);assert.deepEqual((await db.query('select items from public.shopping_lists')).rows[0].items,[item]);
});
test('stale versions and missing or foreign places fail without altering inventory or shopping',async()=>{
  await db.query('select public.save_shopping_list($1::jsonb,0)',[JSON.stringify([item])]);
  await assert.rejects(buy(),error=>error.code==='40001');await assert.rejects(buy([item],1,operation,other),error=>error.code==='22023');
  assert.deepEqual(await stock(),[]);assert.deepEqual((await db.query('select items from public.shopping_lists')).rows[0].items,[item]);
});
test('invalid or unknown quantities roll back all lots, including valid earlier entries',async()=>{
  const invalid={...item,id:recipe,amounts:[],unquantified:1};await assert.rejects(buy([item,invalid]),error=>error.code==='22023');assert.deepEqual(await stock(),[]);
  await assert.rejects(buy([{...item,amounts:[{kind:'specific',unit:'g',value:0}]}]),error=>error.code==='22023');
  await assert.rejects(buy([{id:item.id,name:item.name,category:item.category,occurrences:3}]),error=>error.code==='22023');assert.deepEqual(await stock(),[]);
});
test('each measure is recorded in its own dated lot and existing stock is preserved',async()=>{
  const mixed={...item,amounts:[...item.amounts,{kind:'specific',unit:'pieza',value:2,baseUnit:'g',unitQuantity:150}]};await buy([mixed]);assert.equal((await stock()).length,2);
  await buy([item],1,other);assert.equal((await stock()).length,3);
});
test('operation IDs cannot be reused with different quantities and purchase receipts are private',async()=>{
  await buy();await assert.rejects(buy([{...item,amounts:[{kind:'specific',unit:'g',value:1}]}]),error=>error.code==='22023');
  await db.exec(`set request.jwt.claim.sub='${other}'`);assert.deepEqual((await db.query('select * from public.shopping_purchases')).rows,[]);assert.deepEqual(await stock(),[]);
});
test('anonymous, signed out and non-editor callers cannot calculate requirements or register purchases',async()=>{
  await db.exec("set test.editor='false'");await assert.rejects(quantities(),error=>error.code==='42501');await assert.rejects(buy(),error=>error.code==='42501');
  await db.exec("set test.editor='true';set request.jwt.claim.sub=''");await assert.rejects(buy(),error=>error.code==='42501');await db.exec('set role anon');await assert.rejects(quantities(),error=>error.code==='42501');
});
