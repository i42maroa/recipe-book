const assert=require('node:assert/strict');
const {test}=require('node:test');
const {Subject}=require('rxjs');
const {loadService}=require('./helpers/load-service.cjs');
const calendar=loadService('src/app/utils/scheduled-meal.utils.ts',{});
const search=loadService('src/app/utils/search.utils.ts',{});
const uuid=loadService('src/app/utils/uuid.utils.ts',{});
const {plannerInventoryGroups,plannerInventoryIngredients}=loadService('src/app/utils/planner-inventory.utils.ts',{}, {},{'./search.utils':search});
const placeId='aaaaaaaa-1111-4111-8111-111111111111';
const itemId='bbbbbbbb-1111-4111-8111-111111111111';
const recipeId='cccccccc-1111-4111-8111-111111111111';
const link={placeId,itemId,recipeId,date:'2026-10-27',slot:'lunch'};
const plain=value=>JSON.parse(JSON.stringify(value));
const settle=()=>new Promise(setImmediate);
const lot={id:itemId,recipeId,name:'Puré antiguo',space:'freezer',enteredOn:'2026-10-20',servings:4};
const places=[{id:placeId,name:'Galaroza',items:[lot,{...lot,id:recipeId,enteredOn:'2026-10-16'},
  {...lot,id:'pantry',space:'pantry'}, {...lot,id:'ingredient',recipeId:null,ingredientId:recipeId}, {...lot,id:'product',recipeId:null}]},
  {id:itemId,name:'Casa',items:[{...lot,id:'deleted',recipeId:itemId}]}, {id:'empty',name:'Vacío',items:[]}];
const cards={[recipeId]:{id:recipeId,name:'Puré nuevo'}};

test('prepared inventory groups preserve distinct lots, portions and places without changing stock',()=>{
  const before=structuredClone(places);const groups=plannerInventoryGroups(places,cards);
  assert.deepEqual(plain(groups.map(p=>[p.name,p.spaces.map(s=>[s.label,s.lots.map(l=>l.item.id)])])),[
    ['Galaroza',[['Alacena',['pantry']],['Congelador',[recipeId,itemId]]]],['Casa',[['Congelador',['deleted']]]],
  ]);
  assert.equal(groups[0].spaces[1].lots[1].item.servings,4);assert.equal(groups[1].spaces[0].lots[0].recipe,undefined);
  assert.deepEqual(places,before);
});
test('inventory search matches snapshot and current recipe names with accents and independent filters',()=>{
  assert.equal(plannerInventoryGroups(places,cards,'pure antiguo',placeId,'freezer')[0].spaces[0].lots.length,2);
  assert.equal(plannerInventoryGroups(places,cards,'NUEVO',placeId,'pantry')[0].spaces[0].lots.length,1);
  assert.equal(plannerInventoryGroups(places,cards,'tomate').length,0);
  assert.equal(plannerInventoryGroups(places,cards,'',itemId)[0].name,'Casa');
});

test('ingredient choices come only from owned stock references, grouping repeated lots across places and spaces',()=>{
  const ingredient={id:'first',ingredientId:recipeId,recipeId:null,name:'Tomate',space:'pantry',amount:{kind:'specific',value:2,unit:'pieza'}};
  const held=[{id:placeId,name:'Galaroza',items:[ingredient,{...ingredient,id:'second'},lot,{...ingredient,id:'free',ingredientId:null}]},
    {id:itemId,name:'Casa',items:[{...ingredient,id:'third',space:'freezer',name:'Tomate natural'}]}];
  const before=structuredClone(held);const choices=plannerInventoryIngredients(held);
  assert.equal(choices.length,1);assert.equal(choices[0].items.length,3);assert.equal(choices[0].locations.length,2);
  assert.equal(choices[0].id,recipeId);assert.equal(plannerInventoryIngredients(held,'NATURAL').length,1);assert.equal(plannerInventoryIngredients(held,'arroz').length,0);
  assert.deepEqual(held,before);
});

function setup(){
  const changes=new Subject();const state={owner:'owner',allowed:true,calls:[],data:[link],error:null,hold:null};
  const effects=[];
  const auth={user:()=>state.owner?{id:state.owner}:null,canEdit:()=>state.allowed,requireEditor:async()=>{if(!state.owner||!state.allowed)throw Error('Denied');}};
  const injections={AuthService:auth,DestroyRef:{onDestroy:fn=>{state.destroy=fn;}},ScheduledMealService:{changes$:changes},
    SupabaseService:{requireClient:()=>({rpc:(name,args)=>({abortSignal:async signal=>{
      const data=structuredClone(state.data),error=state.error,hold=state.hold;state.calls.push({name,args,signal});
      if(hold)await hold;return {data,error};
    }})})}};
  const signal=initial=>{let value=initial;const read=()=>value;read.set=next=>{value=next;};return read;};
  const core={...Object.fromEntries(Object.keys(injections).map(key=>[key,key])),Injectable:()=>value=>value,inject:token=>injections[token],signal,effect:fn=>{effects.push(fn);fn();}};
  const {InventoryPlanningService}=loadService('src/app/services/inventory-planning.service.ts',injections,{},
    {'@angular/core':core,'@angular/core/rxjs-interop':{takeUntilDestroyed:()=>source=>source},'../utils/scheduled-meal.utils':{...calendar,localDate:()=>link.date},'../utils/uuid.utils':uuid});
  return {service:new InventoryPlanningService(),state,changes,sync:()=>effects.forEach(fn=>fn())};
}
test('planning reads only future markers and matches the exact lot rather than every copy of its recipe',async()=>{
  const {service,state}=setup();await service.load();
  assert.deepEqual(plain(state.calls.map(call=>[call.name,call.args])),[['get_inventory_planning_links',{p_from:link.date}]]);
  assert.equal(service.forItem(placeId.toUpperCase(),itemId).length,1);
  assert.equal(service.isPlanned(placeId,[recipeId]),false);assert.equal(service.isPlanned(placeId,[itemId]),true);
  assert.equal(service.label(link),'27/10/2026 · Comida');await service.load();assert.equal(state.calls.length,1);
});
test('successful planning changes refresh markers without any inventory write',async()=>{
  const {service,state,changes}=setup();await service.load();state.data=[];changes.next();await settle();
  assert.equal(service.links().length,0);assert.equal(state.calls.length,2);assert.ok(state.calls.every(call=>call.name==='get_inventory_planning_links'));
});
test('owner changes and late responses cannot expose another account or revive stale markers',async()=>{
  const {service,state,sync}=setup();let release;state.hold=new Promise(resolve=>{release=resolve;});const pending=service.load();await settle();
  state.owner='other';sync();assert.equal(state.calls[0].signal.aborted,true);release();await pending;assert.equal(service.links().length,0);
  state.hold=null;state.data=[];await service.load();assert.equal(service.links().length,0);
  state.owner=null;sync();assert.equal(service.loading(),false);assert.equal(service.error(),'');await service.load();assert.equal(state.calls.length,2);
});
test('missing migrations and malformed responses have a retry path without claiming valid markers',async()=>{
  const {service,state}=setup();state.error={code:'PGRST202'};await service.load();assert.match(service.error(),/20261027000400/);
  state.error=null;
  for(const invalid of [[{...link,placeId:[placeId]}],[{...link,date:'2026-02-30'}],[{...link,slot:'snack'}],{}]){
    state.data=invalid;await service.load(true);assert.match(service.error(),/no es válida/);assert.equal(service.links().length,0);
  }
  state.data=[link];await service.load(true);assert.equal(service.error(),'');assert.equal(service.links().length,1);
});
test('revoking editor access clears loaded markers and prevents further requests',async()=>{
  const {service,state,sync}=setup();await service.load();state.allowed=false;sync();assert.equal(service.links().length,0);
  await service.load(true);assert.equal(state.calls.length,1);
});
