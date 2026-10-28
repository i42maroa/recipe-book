const assert=require('node:assert/strict');
const {test,before,beforeEach,after}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(path.resolve('.angular/sql-validation/node_modules/@electric-sql/pglite'));
const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const place='aaaaaaaa-1111-4111-8111-111111111111';
const lot='bbbbbbbb-1111-4111-8111-111111111111';
const second='cccccccc-1111-4111-8111-111111111111';
const recipe='dddddddd-1111-4111-8111-111111111111';
const source={placeId:place,itemId:lot,placeName:'Galaroza',space:'freezer'};
const prepared={recipeId:recipe,mode:'scale',inventory:source};
const day='2026-10-27';
let db;
const migration=async name=>db.exec(fs.readFileSync('supabase/migrations/'+name+'.sql','utf8'));
const save=(recipes=[prepared],date=day,slot='lunch')=>db.query('select public.save_scheduled_day($1::date,$2::jsonb)',[date,JSON.stringify([{slot,servings:2,recipes}])]);
const links=async(from=day)=>(await db.query('select public.get_inventory_planning_links($1::date) as links',[from])).rows[0].links;
const stock=async()=>(await db.query('select id,entry,xmin::text from public.inventory_entries order by id')).rows;
const meals=async()=>(await db.query('select meal_date::text,slot,servings,recipes from public.scheduled_meals order by meal_date,slot')).rows;
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    create function public.is_recipe_editor() returns boolean language sql stable as $$select current_setting('test.editor',true)='true'$$;
    insert into auth.users values('${owner}'),('${other}');
    create table public.recipes(id uuid primary key,name text,pending boolean default false);
    grant select,update on public.recipes to authenticated;
    create table public.meal_plans(id uuid,owner_id uuid,start_date date,end_date date,kind text,servings integer,entries jsonb,updated_at timestamptz);`);
  for(const name of ['20261020000100_daily_meals','20261026000100_freezer_inventories','20261026000200_freezer_entries','20261027000100_inventory_places','20261026000300_add_scheduled_recipe','20261027000400_inventory_planning'])await migration(name);
});
beforeEach(async()=>{
  await db.exec(`reset role;truncate public.inventory_places cascade;truncate public.scheduled_meals,public.recipes;
    set test.editor='true';set request.jwt.claim.sub='${owner}';
    insert into public.recipes values('${recipe}','Arroz',false),('${other}','Otra receta',false);`);
  for(const uid of [owner,other]){
    await db.query('insert into public.inventory_places(owner_id,id,name) values($1,$2,$3)',[uid,place,'Galaroza']);
    for(const id of [lot,second]){
      const entry={id,ingredientId:null,recipeId:recipe,servings:4,name:'Arroz preparado',category:null,space:'freezer',enteredOn:'2026-10-20',arrivedOn:'2026-10-20',amount:null};
      await db.query('insert into public.inventory_entries(owner_id,place_id,id,entry) values($1,$2,$3,$4::jsonb)',[uid,place,id,JSON.stringify(entry)]);
    }
  }
  await db.exec('set role authenticated');
});
after(async()=>{await db?.close();});

test('planning stores its exact lot and date without consuming, reserving or rewriting inventory',async()=>{
  const before=await stock();await save();
  assert.deepEqual((await meals())[0].recipes,[prepared]);assert.deepEqual(await stock(),before);
  assert.deepEqual(await links(),[{placeId:place,itemId:lot,recipeId:recipe,date:day,slot:'lunch'}]);
  await save();assert.equal((await links()).length,1);assert.deepEqual(await stock(),before);
});
test('removing a planned recipe removes its marker while keeping all portions',async()=>{
  const before=await stock();await save();await save([]);
  assert.deepEqual(await links(),[]);assert.deepEqual(await meals(),[]);assert.deepEqual(await stock(),before);
});
test('markers include all future meals, exclude past dates and keep another lot unmarked',async()=>{
  await save([prepared],'2026-10-26');await save();await save([prepared],'2026-11-01','dinner');
  const result=await links();assert.deepEqual(result.map(item=>[item.itemId,item.date,item.slot]),[[lot,day,'lunch'],[lot,'2026-11-01','dinner']]);
  assert.equal((await links('2026-11-02')).length,0);assert.equal((await links('2026-10-26')).length,3);
});
test('ordinary planning and quick additions preserve an existing inventory source',async()=>{
  await save();await db.query('select public.add_scheduled_recipe($1::date,$2,$3,$4::uuid,$5)',[day,'lunch',2,other,'scale']);
  assert.deepEqual((await meals())[0].recipes,[prepared,{recipeId:other,mode:'scale'}]);assert.equal((await links()).length,1);
});
test('withdrawing a lot preserves the historical plan and allows saving the other meals',async()=>{
  await save();await db.query('delete from public.inventory_entries where id=$1',[lot]);
  assert.deepEqual(await links(),[]);
  await db.query('select public.save_scheduled_day($1::date,$2::jsonb)',[day,JSON.stringify([
    {slot:'lunch',servings:2,recipes:[prepared]},
    {slot:'dinner',servings:3,recipes:[{recipeId:other,mode:'scale'}]},
  ])]);
  assert.deepEqual((await meals()).find(item=>item.slot==='lunch').recipes,[prepared]);
  await assert.rejects(save([prepared],'2026-10-28'),error=>error.code==='22023');
});
test('a missing, foreign or mismatched lot rejects the whole write without overwriting the day',async()=>{
  await save();const before=await meals();
  for(const entry of [
    {...prepared,recipeId:other},
    {...prepared,inventory:{...source,itemId:other}},
    {...prepared,inventory:{...source,placeId:other}},
  ])await assert.rejects(save([entry]),error=>error.code==='22023');
  await db.query('delete from public.inventory_entries where id=$1',[second]);
  await assert.rejects(save([{...prepared,inventory:{...source,itemId:second}}]),error=>error.code==='22023');
  assert.deepEqual(await meals(),before);
});
test('malformed inventory sources are rejected, including nulls, arrays and invalid measures',async()=>{
  for(const inventory of [null,[],{}, {...source,itemId:'wrong'}, {...source,space:'fridge'}, {...source,placeName:' '},{...source,placeId:[place]}]){
    await assert.rejects(save([{...prepared,inventory}]),error=>error.code==='22023');
  }
  assert.deepEqual(await meals(),[]);await save([{recipeId:recipe,mode:'scale'}]);assert.deepEqual(await links(),[]);
});
test('links are private even when both owners have identical place, lot and recipe IDs',async()=>{
  await save();await db.exec(`set request.jwt.claim.sub='${other}'`);assert.deepEqual(await links(),[]);
  await save([prepared],'2026-11-01','dinner');assert.deepEqual((await links()).map(item=>item.date),['2026-11-01']);
  await db.exec(`set request.jwt.claim.sub='${owner}'`);assert.deepEqual((await links()).map(item=>item.date),[day]);
});
test('anonymous callers, non-editors, missing authentication and missing dates cannot read links',async()=>{
  await assert.rejects(links(null),error=>error.code==='22023');
  await db.exec("set test.editor='false'");await assert.rejects(links(),error=>error.code==='42501');await assert.rejects(save(),error=>error.code==='42501');
  await db.exec("set test.editor='true';set request.jwt.claim.sub=''");await assert.rejects(links(),error=>error.code==='42501');
  await db.exec('set role anon');await assert.rejects(links(),error=>error.code==='42501');
});
