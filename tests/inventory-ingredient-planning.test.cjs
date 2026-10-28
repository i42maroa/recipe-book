const assert=require('node:assert/strict');const {test}=require('node:test');const {Subject,BehaviorSubject}=require('rxjs');
const {loadService}=require('./helpers/load-service.cjs');
const calendar=loadService('src/app/utils/scheduled-meal.utils.ts',{}),uuid=loadService('src/app/utils/uuid.utils.ts',{});
const recipe='aaaaaaaa-1111-4111-8111-111111111111',second='bbbbbbbb-1111-4111-8111-111111111111',ingredient='cccccccc-1111-4111-8111-111111111111';
const plain=value=>JSON.parse(JSON.stringify(value)),settle=()=>new Promise(setImmediate);
function setup(){
  const mealChanges=new Subject(),recipeChanges=new BehaviorSubject(0),effects=[];
  const state={owner:'owner',allowed:true,now:0,date:'2026-10-28',calls:[],cap:1,errorTable:'',hold:null,
    meals:[{meal_date:'2026-10-29',slot:'lunch',recipes:[{recipeId:recipe,mode:'scale'}]}],
    ingredients:[{recipe_id:recipe,ingredient_id:ingredient,recipes:{name:'Arroz'}}]};
  class Clock extends Date{static now(){return state.now;}}
  const client={from(table){const call={table,offset:0,filters:[],signal:null,ids:null};return {
    select(){return this;},eq(...args){call.filters.push(['eq',...args]);return this;},gte(...args){call.filters.push(['gte',...args]);return this;},
    in(field,ids){call.ids=ids;call.filters.push(['in',field,ids]);return this;},order(){return this;},range(offset){call.offset=offset;return this;},abortSignal(signal){call.signal=signal;return this;},returns(){return this;},
    async then(resolve,reject){try{state.calls.push(call);let rows=table==='scheduled_meals'?state.meals:state.ingredients.filter(row=>call.ids.includes(row.recipe_id));
      if(table==='scheduled_meals'){const date=call.filters.find(filter=>filter[0]==='gte')[2];rows=rows.filter(row=>row.meal_date>=date);}
      const snapshot=structuredClone(rows.slice(call.offset,call.offset+state.cap)),count=rows.length,hold=state.hold;if(hold)await hold;
      resolve({data:snapshot,count,error:state.errorTable===table?Error('Offline'):null});}catch(error){reject(error);}}
  };}};
  const injections={AuthService:{user:()=>state.owner?{id:state.owner}:null,canEdit:()=>state.allowed,requireEditor:async()=>{if(!state.owner||!state.allowed)throw Error('Denied');}},
    SupabaseService:{requireClient:()=>client},ScheduledMealService:{changes$:mealChanges},RecipeService:{changes$:recipeChanges},DestroyRef:{onDestroy:fn=>{state.destroy=fn;}}};
  const signal=initial=>{let value=initial;const read=()=>value;read.set=next=>{value=next;};return read;};
  const core={...Object.fromEntries(Object.keys(injections).map(key=>[key,key])),Injectable:()=>value=>value,inject:token=>injections[token],signal,computed:read=>read,effect:fn=>{effects.push(fn);fn();}};
  const {InventoryIngredientPlanningService}=loadService('src/app/services/inventory-ingredient-planning.service.ts',injections,{Date:Clock},
    {'@angular/core':core,'@angular/core/rxjs-interop':{takeUntilDestroyed:()=>source=>source},'../utils/scheduled-meal.utils':{...calendar,localDate:()=>state.date},'../utils/uuid.utils':uuid});
  return {service:new InventoryIngredientPlanningService(),state,mealChanges,recipeChanges,sync:()=>effects.forEach(fn=>fn())};
}
test('ingredients are marked by recipe, date and meal through paginated owned future plans without stock writes',async()=>{
  const {service,state}=setup();state.meals.push({meal_date:'2026-10-28',slot:'dinner',recipes:[{recipeId:second}]});state.ingredients.push({recipe_id:second,ingredient_id:ingredient,recipes:{name:'Sopa'}});
  await service.load();assert.equal(service.links().length,2);assert.equal(service.isPlanned(ingredient.toUpperCase()),true);
  assert.deepEqual(plain(service.forIngredient(ingredient).map(link=>link.date)),['2026-10-28','2026-10-29']);
  assert.equal(service.label(service.links()[1]),'29/10/2026 · Comida · Arroz');
  assert.deepEqual(plain(state.calls[0].filters),[['eq','owner_id','owner'],['gte','meal_date','2026-10-28']]);
  assert.ok(state.calls.every(call=>['scheduled_meals','recipe_ingredients'].includes(call.table)));
});
test('past plans and prepared inventory dishes do not commit raw ingredients',async()=>{
  const {service,state}=setup();state.meals=[{meal_date:'2026-10-27',slot:'lunch',recipes:[{recipeId:recipe}]},{meal_date:'2026-10-29',slot:'dinner',recipes:[{recipeId:recipe,inventory:{itemId:'prepared'}}]}];
  await service.load();assert.equal(service.links().length,0);assert.equal(state.calls.filter(call=>call.table==='recipe_ingredients').length,0);
});
test('removing the last planned use releases an ingredient; another plan keeps it marked',async()=>{
  const {service,state,mealChanges}=setup();await service.load();state.meals.push({meal_date:'2026-10-30',slot:'dinner',recipes:[{recipeId:recipe}]});
  mealChanges.next();await service.load();assert.equal(service.forIngredient(ingredient).length,2);state.meals.shift();mealChanges.next();await service.load();assert.equal(service.isPlanned(ingredient),true);
  state.meals=[];mealChanges.next();await service.load();assert.equal(service.isPlanned(ingredient),false);
});
test('simultaneous readers share the request and cached marks expire or reset on a new local date',async()=>{
  const {service,state}=setup();let release;state.hold=new Promise(resolve=>{release=resolve;});const first=service.load(),secondRead=service.load();
  assert.equal(first,secondRead);release();await first;state.hold=null;const calls=state.calls.length;await service.load();assert.equal(state.calls.length,calls);
  state.now+=300000;await service.load();assert.ok(state.calls.length>calls);state.date='2026-10-30';await service.load();assert.equal(service.links().length,0);
});
test('read failures never publish partial marks and retry restores an authoritative result',async()=>{
  const {service,state}=setup();state.errorTable='recipe_ingredients';await service.load();assert.equal(service.ready(),false);assert.match(service.error(),/Offline/);assert.equal(service.links().length,0);
  state.errorTable='';await service.load();assert.equal(service.ready(),true);assert.equal(service.error(),'');assert.equal(service.links().length,1);
});
test('a recipe edit refreshes ingredient references and recipe names',async()=>{
  const {service,state,recipeChanges}=setup();await service.load();state.ingredients=[{recipe_id:recipe,ingredient_id:second,recipes:{name:'Arroz editado'}}];recipeChanges.next(1);await service.load();
  assert.equal(service.isPlanned(ingredient),false);assert.equal(service.isPlanned(second),true);assert.equal(service.links()[0].recipeName,'Arroz editado');
});
test('account changes and revoked access clear markers and prevent late responses from restoring another owner',async()=>{
  const {service,state,sync}=setup();let release;state.hold=new Promise(resolve=>{release=resolve;});const pending=service.load();await settle();state.owner='other';sync();assert.equal(state.calls[0].signal.aborted,true);
  release();await pending;assert.equal(service.links().length,0);state.hold=null;state.meals=[];await service.load();assert.equal(service.links().length,0);
  state.allowed=false;sync();const count=state.calls.length;await service.load();assert.equal(state.calls.length,count);assert.equal(service.ready(),false);
});
test('an invalidated in-flight read cannot revive stale planned ingredients',async()=>{
  const {service,state,mealChanges}=setup();let release;state.hold=new Promise(resolve=>{release=resolve;});const old=service.load();await settle();
  state.hold=null;state.meals=[];mealChanges.next();await service.load();release();await old;assert.equal(service.links().length,0);assert.equal(service.ready(),true);
});
