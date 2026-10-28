const assert = require('node:assert/strict');
const { test, before, beforeEach, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.resolve('.angular/sql-validation/node_modules/@electric-sql/pglite'));
const owner='11111111-1111-4111-8111-111111111111';
const tomato='aaaaaaaa-1111-4111-8111-111111111111';
const milk='bbbbbbbb-1111-4111-8111-111111111111';
const spice='cccccccc-1111-4111-8111-111111111111';
const rid='dddddddd-1111-4111-8111-111111111111';
const place='eeeeeeee-1111-4111-8111-111111111111';
const itemId='ffffffff-1111-4111-8111-111111111111';
const secondId='ffffffff-2222-4222-8222-222222222222';
const read=name=>fs.readFileSync(`supabase/migrations/${name}.sql`,'utf8');
let db, migrated;
const ingredient=(id,name,category,base='g',unit=null,components=[])=>db.query('select public.save_ingredient($1::uuid,$2,$3,$4::jsonb,$5,$6::numeric) as id',[id,name,category,JSON.stringify(components),base,unit]);
const recipe=(amounts,id=rid)=>db.query('select public.save_recipe($1::uuid,$2::jsonb)',[id,JSON.stringify({name:'Receta',pending:false,ingredientIds:Object.keys(amounts),ingredientAmounts:amounts,steps:['Preparar'],cuisineTypes:['Casa']})]);
const apply=changes=>db.query('select public.apply_inventory_changes($1::jsonb)',[JSON.stringify(changes)]);
const stock=async()=> (await db.query('select public.get_inventory() as inventory')).rows[0].inventory;
const lot=(before,after)=>({placeId:place,itemId:(after??before).id,before,after});
const entry=amount=>({id:itemId,ingredientId:tomato,category:'Verdura',name:'Tomate',recipeId:null,servings:null,space:'pantry',amount,enteredOn:'2026-10-12',arrivedOn:'2026-10-12'});

before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    create function public.is_recipe_editor() returns boolean language sql stable as $$ select current_setting('test.editor',true)='true' $$;
    insert into auth.users values('${owner}');`);
  await db.exec(read('20261015000100_initial_schema').replace('create extension if not exists pgcrypto;',''));
  await db.exec(read('20261021000100_ingredient_categories'));
  for(const migration of ['20261026000100_freezer_inventories','20261026000200_freezer_entries','20261027000100_inventory_places']) await db.exec(read(migration));
  await db.exec(`do $$ declare tab text; begin foreach tab in array array['ingredients','recipes','recipe_ingredients','ingredient_components','recipe_steps','cuisine_types','recipe_cuisine_types'] loop
    execute format('drop policy anon_all on public.%I',tab);
    execute format('create policy editor_access on public.%I for all to authenticated using (public.is_recipe_editor()) with check (public.is_recipe_editor())',tab);
    execute format('grant select,insert,update,delete on public.%I to authenticated',tab);
  end loop; end $$;
  insert into public.ingredients(id,name,category) values('${tomato}','Tomate','Verdura'),('${milk}','Leche','Liquidos'),('${spice}','Pimienta','Especia');
  insert into public.recipes(id,name,pending) values('${rid}','Anterior',false);
  insert into public.recipe_ingredients(recipe_id,ingredient_id,amount_kind,amount_value,amount_unit) values
    ('${rid}','${tomato}','specific',2,'pieza'),('${rid}','${milk}','glass',null,null),('${rid}','${spice}','spoon',null,null);`);
  await db.exec(read('20261027000200_ingredient_measures'));
  await db.exec(read('20261027000300_inventory_empty_amounts'));
  migrated={ ingredients:(await db.query('select category,base_unit,unit_quantity from public.ingredients order by category')).rows,
    amounts:(await db.query('select amount_kind,amount_value,amount_unit,amount_unit_quantity from public.recipe_ingredients order by amount_kind')).rows };
});
beforeEach(async()=>{
  await db.exec(`reset role; truncate public.inventory_places cascade; truncate public.ingredients,public.recipes cascade;
    set test.editor='true'; set request.jwt.claim.sub='${owner}'; set role authenticated;`);
  await ingredient(tomato,'Tomate','Verdura','g',150);
  await ingredient(milk,'Leche','Liquidos','ml',1000);
  await ingredient(spice,'Pimienta','Especia','g');
});
after(async()=>{await db?.close();});

test('migration assigns base measures but does not invent equivalences or alter historical amounts',()=>{
  assert.deepEqual(migrated.ingredients,[{category:'Especia',base_unit:'g',unit_quantity:null},{category:'Liquidos',base_unit:'ml',unit_quantity:null},{category:'Verdura',base_unit:'g',unit_quantity:null}]);
  assert.deepEqual(migrated.amounts.map(row=>[row.amount_kind,row.amount_value,row.amount_unit,row.amount_unit_quantity]),[['glass',null,null,null],['specific','2','pieza',null],['spoon',null,null,null]]);
});

test('ingredient saves validate required base, positive equivalents and grams for spices',async()=>{
  for(const [base,unit,category] of [[null,null,'Verdura'],['pieza',null,'Verdura'],['g',0,'Verdura'],['g',-5,'Verdura'],['g','NaN','Verdura'],['ml',null,'Especia']]) {
    await assert.rejects(ingredient(tomato,'Tomate',category,base,unit),e=>e.code==='22023');
  }
  assert.equal((await db.query('select unit_quantity from public.ingredients where id=$1',[tomato])).rows[0].unit_quantity,'150');
});

test('recipes capture unit equivalents, persist fractional tablespoons and reject incompatible new measurements',async()=>{
  await recipe({[tomato]:{kind:'specific',value:2,unit:'pieza'},[spice]:{kind:'spoon',value:0.5}});
  const rows=(await db.query('select ingredient_id,amount_value,amount_base_unit,amount_unit_quantity from public.recipe_ingredients order by ingredient_id')).rows;
  assert.deepEqual(rows,[{ingredient_id:tomato,amount_value:'2',amount_base_unit:'g',amount_unit_quantity:'150'},{ingredient_id:spice,amount_value:'0.5',amount_base_unit:null,amount_unit_quantity:null}]);
  for(const amounts of [{[tomato]:{kind:'specific',value:2,unit:'ml'}},{[tomato]:{kind:'spoon'}},{[milk]:{kind:'glass'}},{[spice]:{kind:'specific',value:1,unit:'pieza'}}]) await assert.rejects(recipe(amounts),e=>e.code==='22023');
  assert.equal((await db.query('select count(*)::int as n from public.recipe_ingredients')).rows[0].n,2);
});

test('stored recipe conversions survive catalogue edits and prevent forged equivalents',async()=>{
  await recipe({[tomato]:{kind:'specific',value:1,unit:'pieza'}});
  await ingredient(tomato,'Tomate nuevo','Verdura','g',200);
  await recipe({[tomato]:{kind:'specific',value:2,unit:'pieza',baseUnit:'g',unitQuantity:150}});
  assert.equal((await db.query('select amount_unit_quantity from public.recipe_ingredients')).rows[0].amount_unit_quantity,'150');
  await assert.rejects(recipe({[tomato]:{kind:'specific',value:3,unit:'pieza',baseUnit:'ml',unitQuantity:99}}),e=>e.code==='22023');
});

test('elaboration components use the same configuration and preserve their conversion snapshots',async()=>{
  const id='99999999-1111-4111-8111-111111111111';
  await ingredient(id,'Salsa','Elaboracion','g',null,[{ingredient_id:tomato,kind:'specific',value:2,unit:'pieza'},{ingredient_id:spice,kind:'spoon',value:0.5}]);
  assert.equal((await db.query('select amount_unit_quantity from public.ingredient_components where component_ingredient_id=$1',[tomato])).rows[0].amount_unit_quantity,'150');
  await assert.rejects(ingredient(id,'Salsa','Elaboracion','g',null,[{ingredient_id:tomato,kind:'spoon',value:1}]),e=>e.code==='22023');
  assert.equal((await db.query('select count(*)::int as n from public.ingredient_components')).rows[0].n,2);
});

test('historical glasses and units without equivalences remain editable and transferable in partial quantities',async()=>{
  await ingredient(tomato,'Tomate','Verdura','g',null);
  await db.exec('reset role');
  await db.query('insert into public.recipes(id,name,pending) values($1,$2,false)',[rid,'Anterior']);
  await db.query("insert into public.recipe_ingredients(recipe_id,ingredient_id,amount_kind,amount_value,amount_unit) values($1,$2,'specific',3,'pieza'),($1,$3,'glass',null,null)",[rid,tomato,milk]);
  await db.query('insert into public.inventory_places(owner_id,id,name) values($1,$2,$3)',[owner,place,'Casa']);
  const original=entry({kind:'specific',value:3,unit:'pieza'});
  await db.query('insert into public.inventory_entries(owner_id,place_id,id,entry) values($1,$2,$3,$4::jsonb)',[owner,place,itemId,JSON.stringify(original)]);
  await db.exec('set role authenticated');
  await recipe({[tomato]:{kind:'specific',value:3,unit:'pieza'},[milk]:{kind:'glass'}});
  const reduced={...original,amount:{...original.amount,value:2}};
  const moved={...original,id:secondId,space:'freezer',arrivedOn:'2026-10-27',amount:{...original.amount,value:1}};
  const changes=[lot(original,reduced),lot(null,moved)];
  await apply(changes); await apply(changes);
  assert.equal((await stock())[0].items.length,2);
  assert.deepEqual((await stock())[0].items.map(row=>row.amount.value),[2,1]);
  await assert.rejects(apply([lot(reduced,{...reduced,amount:{...reduced.amount,value:4}})]),e=>e.code==='22023');
});

test('inventory permits configured unit snapshots and mixed measures but atomically rejects wrong bases',async()=>{
  await apply([{placeId:place,itemId:null,before:null,after:{name:'Casa'}}]);
  const units=entry({kind:'specific',value:3,unit:'pieza',baseUnit:'g',unitQuantity:150});
  const grams={...entry({kind:'specific',value:500,unit:'g'}),id:secondId,enteredOn:'2026-10-16',arrivedOn:'2026-10-16'};
  await apply([lot(null,units),lot(null,grams)]);
  assert.deepEqual((await stock())[0].items.map(row=>row.amount.value),[3,500]);
  await assert.rejects(apply([lot(units,{...units,name:'Otro'}),lot(grams,{...grams,amount:{kind:'specific',value:500,unit:'ml'}})]),e=>e.code==='22023');
  assert.equal((await stock())[0].items[0].name,'Tomate');
});

test('only authenticated editors can call the new saves and the old ingredient signature is retired',async()=>{
  await db.exec("set test.editor='false'");
  await assert.rejects(ingredient(tomato,'Tomate','Verdura','g',150),e=>e.code==='42501');
  await assert.rejects(recipe({[tomato]:{kind:'specific',value:1,unit:'g'}}),e=>e.code==='42501');
  await db.exec("set test.editor='true'");
  await assert.rejects(db.query("select public.save_ingredient(null,'Viejo','Otro','[]'::jsonb)"),e=>e.code==='42501');
  await db.exec('set role anon');
  await assert.rejects(ingredient(tomato,'Tomate','Verdura','g',150),e=>e.code==='42501');
  await assert.rejects(recipe({[tomato]:{kind:'specific',value:1,unit:'g'}}),e=>e.code==='42501');
});

test('inventory stores fractional spice tablespoons and moves only the requested amount',async()=>{
  await apply([{placeId:place,itemId:null,before:null,after:{name:'Casa'}}]);
  const original={...entry({kind:'spoon',value:2}),ingredientId:spice,category:'Especia',name:'Pimienta'};
  await apply([lot(null,original)]);
  const reduced={...original,amount:{kind:'spoon',value:1.5}};
  const moved={...original,id:secondId,space:'freezer',arrivedOn:'2026-10-27',amount:{kind:'spoon',value:0.5}};
  await apply([lot(original,reduced),lot(null,moved)]);
  assert.deepEqual((await stock())[0].items.map(row=>row.amount.value),[1.5,0.5]);
  await assert.rejects(apply([lot(reduced,{...reduced,amount:{kind:'spoon',value:0}})]),e=>e.code==='22023');
});

test('legacy free-product tablespoons can decrease without permitting new tablespoon products',async()=>{
  await db.exec('reset role');
  await db.query('insert into public.inventory_places(owner_id,id,name) values($1,$2,$3)',[owner,place,'Casa']);
  const original={...entry({kind:'spoon'}),ingredientId:null,category:null,name:'Producto anterior'};
  await db.query('insert into public.inventory_entries(owner_id,place_id,id,entry) values($1,$2,$3,$4::jsonb)',[owner,place,itemId,JSON.stringify(original)]);
  await db.exec('set role authenticated');
  const reduced={...original,amount:{kind:'spoon',value:0.5}};
  await apply([lot(original,reduced)]);
  assert.equal((await stock())[0].items[0].amount.value,0.5);
  await assert.rejects(apply([lot(null,{...original,id:secondId})]),e=>e.code==='22023');
});

test('mixed batches accept unquantified products and ingredients and can remove complete lots',async()=>{
  await recipe({[tomato]:{kind:'specific',value:150,unit:'g'}});
  await apply([{placeId:place,itemId:null,before:null,after:{name:'Casa'}}]);
  const ingredientLot=entry(null);
  const productLot={...entry(null),id:secondId,ingredientId:null,category:null,name:'Producto libre'};
  const recipeLot={...productLot,id:'99999999-2222-4222-8222-222222222222',recipeId:rid,servings:4,name:'Receta preparada'};
  await apply([lot(null,ingredientLot),lot(null,productLot),lot(null,recipeLot)]);
  assert.equal((await stock())[0].items.length,3);
  const renamed={...productLot,name:'Producto renombrado'};
  await apply([lot(productLot,renamed)]);
  await apply([lot(ingredientLot,null),lot(renamed,null),lot(recipeLot,null)]);
  assert.deepEqual((await stock())[0].items,[]);
});
