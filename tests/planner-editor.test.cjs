const assert=require('node:assert/strict');
const {test,before}=require('node:test');
const {loadService}=require('./helpers/load-service.cjs');
const calendar=loadService('src/app/utils/scheduled-meal.utils.ts',{});
const model=loadService('src/app/models/scheduled-meal.model.ts',{});
const today='2026-10-27';
const first='aaaaaaaa-1111-4111-8111-111111111111';
const second='bbbbbbbb-1111-4111-8111-111111111111';
const third='cccccccc-1111-4111-8111-111111111111';
const card={id:third,name:'Arroz',servings:2,mealTypes:['Plato'],pending:false,ingredientCount:2};
const settle=()=>new Promise(setImmediate);
const plain=value=>JSON.parse(JSON.stringify(value));
let forms;
before(async()=>{await import('@angular/compiler');forms=await import('@angular/forms');});

async function setup({daily=false,rows=[]}={}){
  const state={owner:'editor',allowed:true,rows:structuredClone(rows),writes:[],errors:[],successes:[],navigations:[],hold:null,fail:false,confirmations:0};
  let page;
  const injections={
    AuthService:{user:()=>({id:state.owner}),canEdit:()=>state.allowed},
    ScheduledMealService:{getDay:async()=>structuredClone(state.rows),getWeek:async()=>structuredClone(state.rows),
      saveDay:async(date,meals)=>{state.writes.push({date,meals:structuredClone(meals)});if(state.hold)await state.hold;if(state.fail)throw Error('Offline');state.rows=state.rows.filter(row=>row.date!==date).concat(meals.filter(meal=>meal.recipes.length).map(meal=>({...structuredClone(meal),date})));}},
    PlannerStateService:{recipeData:async()=>({summaries:{}}),rememberCard(){}},
    NotificationService:{error:message=>state.errors.push(message),success:message=>state.successes.push(message)},
    Router:{navigate:async commands=>{state.navigations.push({commands,canLeave:page?.canLeave()});return true;}},
    ActivatedRoute:{snapshot:{data:{todayOnly:daily},queryParamMap:{get:()=>null}}},
    Injector:{},DestroyRef:{onDestroy:fn=>{state.destroy=fn;}},
  };
  const signal=initial=>{let value=initial;const read=()=>value;read.set=next=>{value=next;};read.update=fn=>{value=fn(value);};return read;};
  const core={Component:()=>value=>value,HostListener:()=>()=>{},signal,computed:read=>read,effect:fn=>fn(),inject:token=>injections[token],DestroyRef:'DestroyRef',Injector:'Injector',afterNextRender(){}};
  const {PlannerEditorPageComponent}=loadService('src/app/pages/planner/planner-editor-page.component.ts',injections,
    {document:{querySelectorAll:()=>[],getElementById:()=>null},window:{confirm:()=>{state.confirmations++;return true;}}},
    {'@angular/core':core,'@angular/forms':forms,'../../models/scheduled-meal.model':model,'../../utils/scheduled-meal.utils':{...calendar,localDate:()=>today}});
  page=new PlannerEditorPageComponent();await settle();assert.equal(page.loading(),false);
  return {page,state};
}

test('selecting a recipe automatically persists its day and preserves other meals, portions and modes',async()=>{
  const rows=[{date:today,slot:'lunch',servings:5,recipes:[{recipeId:first,mode:'leftovers'}]},{date:today,slot:'dinner',servings:3,recipes:[{recipeId:second,mode:'scale'}]}];
  const {page,state}=await setup({rows});
  page.choose(today,'lunch');page.add(card);
  assert.equal(state.writes.length,1);assert.equal(page.picker(),null);assert.equal(page.busy(),true);
  await settle();
  assert.deepEqual(plain(state.rows),[{...rows[0],recipes:[...rows[0].recipes,{recipeId:third,mode:'scale'}]},rows[1]]);
  assert.equal(page.dirty(),false);assert.equal(page.busy(),false);assert.equal(state.navigations.length,0);
});

test('a failed automatic save keeps the selected recipe and can retry without duplicating it',async()=>{
  const {page,state}=await setup();state.fail=true;page.choose(today,'lunch');page.add(card);await settle();
  assert.equal(page.forSlot(today,'lunch').length,1);assert.equal(page.dirty(),true);assert.equal(page.busy(),false);assert.equal(state.errors.length,1);assert.equal(state.rows.length,0);
  state.fail=false;await page.saveDay(today);
  assert.equal(state.writes.length,2);assert.equal(state.rows[0].recipes.length,1);assert.equal(page.dirty(),false);
});

test('double selection and actions during a pending save cannot queue duplicate writes or abandon the day',async()=>{
  const {page,state}=await setup();let release;state.hold=new Promise(resolve=>{release=resolve;});
  page.choose(today,'lunch');page.add(card);page.add(card);page.choose(today,'dinner');
  assert.equal(state.writes.length,1);assert.equal(page.picker(),null);assert.equal(page.canLeave(),false);
  let prevented=false;page.beforeUnload({preventDefault:()=>{prevented=true;}});assert.equal(prevented,true);
  release();await settle();assert.equal(page.canLeave(),true);assert.equal(state.confirmations,0);
});

test('the daily editor returns to planning only after automatic saving finishes and the guard allows leaving',async()=>{
  const {page,state}=await setup({daily:true});page.choose(today,'lunch');page.add(card);
  assert.equal(state.navigations.length,0);await settle();
  assert.deepEqual(plain(state.navigations),[{commands:['/planner'],canLeave:true}]);assert.equal(state.confirmations,0);
});

test('saving a selected day preserves another day and its unsaved changes',async()=>{
  const other='2026-10-28';const {page,state}=await setup({rows:[{date:other,slot:'lunch',servings:2,recipes:[{recipeId:first,mode:'scale'}]}]});
  page.removeEntry({key:page.forSlot(other,'lunch')[0].key});assert.equal(page.dirtyDates().has(other),true);
  page.choose(today,'dinner');page.add(card);await settle();
  assert.deepEqual(state.writes.map(write=>write.date),[today]);assert.equal(page.dirtyDates().has(other),true);
  assert.equal(state.rows.find(row=>row.date===other).recipes[0].recipeId,first);
});

test('existing recipes, full meals and late saves after account changes cannot add another recipe',async()=>{
  const recipes=Array.from({length:5},(_,n)=>({recipeId:n===0?third:'dddddddd-1111-4111-8111-'+String(n).padStart(12,'0'),mode:'scale'}));
  const {page,state}=await setup({rows:[{date:today,slot:'lunch',servings:2,recipes}]});
  page.choose(today,'lunch');page.add(card);assert.equal(state.writes.length,0);
  let release;state.hold=new Promise(resolve=>{release=resolve;});page.choose(today,'dinner');page.add(card);state.owner='other-editor';release();await settle();
  assert.equal(state.successes.length,0);assert.equal(state.navigations.length,0);
});

test('selecting a prepared lot autosaves its source and retains it when another recipe is added after reloading',async()=>{
  const inventory={placeId:first,itemId:second,placeName:'Galaroza',space:'freezer'};
  const {page,state}=await setup();page.choose(today,'lunch');page.addFromInventory({recipe:card,inventory});await settle();
  assert.deepEqual(plain(state.rows[0].recipes),[{recipeId:third,mode:'scale',inventory}]);
  assert.equal(page.dirty(),false);assert.deepEqual(inventory,{placeId:first,itemId:second,placeName:'Galaroza',space:'freezer'});
  const next=await setup({rows:state.rows});next.page.choose(today,'dinner');next.page.add({...card,id:first});await settle();
  assert.deepEqual(plain(next.state.rows.find(row=>row.slot==='lunch').recipes),[{recipeId:third,mode:'scale',inventory}]);
  const changed=structuredClone(state.rows);changed[0].recipes[0].inventory.itemId=first;
  assert.notEqual(calendar.dayFingerprint(state.rows),calendar.dayFingerprint(changed));
});
