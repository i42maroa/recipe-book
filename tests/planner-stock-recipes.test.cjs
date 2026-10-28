const assert=require('node:assert/strict');const {test,before}=require('node:test');const {BehaviorSubject}=require('rxjs');
const {loadService}=require('./helpers/load-service.cjs');
const search=loadService('src/app/utils/search.utils.ts',{}),filters=loadService('src/app/utils/recipe-filters.utils.ts',{}, {},{'./search.utils':search});
const utils=loadService('src/app/utils/planner-inventory.utils.ts',{}, {},{'./search.utils':search});
const first='aaaaaaaa-1111-4111-8111-111111111111',second='bbbbbbbb-1111-4111-8111-111111111111';
const plain=value=>JSON.parse(JSON.stringify(value)),settle=()=>new Promise(setImmediate),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let forms,angular;
before(async()=>{await import('@angular/compiler');forms=await import('@angular/forms');angular=await import('@angular/core');});
function setup(){
  const changes=new BehaviorSubject(0),effects=[];
  const state={owner:'owner',allowed:true,fail:false,hold:null,reads:[],outputs:[],inventoryReads:[],rows:[{id:'recipe',name:'Plato'}],total:1,planningError:'',planningReady:true};
  const planned=angular.signal([]);
  const stock=angular.signal([{id:'place',name:'Galaroza',items:[
    {id:'one',ingredientId:first,recipeId:null,name:'Tomate',space:'pantry',amount:null},
    {id:'two',ingredientId:second,recipeId:null,name:'Arroz',space:'freezer',amount:{kind:'specific',unit:'g',value:0.1}},
    {id:'duplicate',ingredientId:first,recipeId:null,name:'Tomate',space:'freezer'},
    {id:'dish',ingredientId:null,recipeId:first,name:'Preparado',space:'freezer'},
    {id:'free',ingredientId:null,recipeId:null,name:'Producto',space:'pantry'},
  ]}]);
  const destroy={destroyed:false,onDestroy:fn=>{state.destroy=()=>{destroy.destroyed=true;fn();};}};
  const injections={DestroyRef:destroy,AuthService:{user:()=>({id:state.owner}),canEdit:()=>state.allowed},
    InventoryIngredientPlanningService:{isPlanned:id=>planned().includes(id),ready:()=>state.planningReady,error:()=>state.planningError,loading:()=>false,load:async()=>{}},
    InventoryService:{places:stock,ready:()=>true,error:()=>'',dirty:()=>false,saving:()=>false,load:async force=>{state.inventoryReads.push(force);}},
    RecipeService:{changes$:changes,getBatch:async(query,offset,limit,signal)=>{state.reads.push({query:plain(query),offset,signal});const rows=structuredClone(state.rows),hold=state.hold,fail=state.fail;if(hold)await hold;if(fail)throw Error('Offline');return {items:rows,offset,total:state.total};}}};
  const input=value=>{const read=()=>value;read.set=next=>{value=next;};return read;};
  const core={...angular,Component:()=>value=>value,input,output:()=>({emit:value=>state.outputs.push(value)}),effect:fn=>{effects.push(fn);fn();},untracked:fn=>fn(),inject:token=>injections[token],DestroyRef:'DestroyRef'};
  const {PlannerStockRecipesComponent}=loadService('src/app/components/planner-stock-recipes/planner-stock-recipes.component.ts',injections,{},
    {'@angular/core':core,'@angular/forms':forms,'@angular/core/rxjs-interop':{takeUntilDestroyed:()=>source=>source},'../../utils/search.utils':search,'../../utils/recipe-filters.utils':filters,'../../utils/planner-inventory.utils':utils});
  return {picker:new PlannerStockRecipesComponent(),state,stock,planned,changes,sync:()=>effects.forEach(fn=>fn())};
}
test('stock recipes automatically use every owned ingredient with OR semantics, ignoring quantities and excluding dishes/products',async()=>{
  const {picker,state}=setup();picker.ngOnInit();await settle();
  assert.deepEqual(state.reads[0].query,{search:'',pending:'all',sort:'recent',mealType:'',difficulty:'',ingredientIds:[first,second]});
  assert.equal(state.inventoryReads[0],true);assert.equal(picker.ingredientIds().length,2);
});
test('empty stock never issues an unfiltered recipe query',async()=>{
  const {picker,state,stock}=setup();stock.set([]);picker.ngOnInit();await settle();assert.equal(state.reads.length,0);assert.equal(picker.results().length,0);assert.equal(picker.loading(),false);
});
test('recipe selection emits once, respects duplicates and never alters stock or marks an inventory lot',async()=>{
  const {picker,state,stock}=setup();const before=structuredClone(stock());picker.ngOnInit();await settle();
  picker.excludedRecipeIds.set(['RECIPE']);picker.select(state.rows[0]);assert.equal(state.outputs.length,0);
  picker.excludedRecipeIds.set([]);picker.select(state.rows[0]);picker.select(state.rows[0]);assert.equal(state.outputs.length,1);assert.equal(state.outputs[0].inventory,undefined);assert.deepEqual(stock(),before);
});
test('filter changes retain all stock ingredient IDs and cancel stale name results',async()=>{
  const {picker,state}=setup();picker.ngOnInit();await settle();
  picker.search.setValue('Tomate');await pause(350);assert.equal(state.reads.at(-1).query.search,'Tomate');assert.deepEqual(state.reads.at(-1).query.ingredientIds,[first,second]);
  let release;state.hold=new Promise(resolve=>{release=resolve;});const pending=picker.load();await settle();picker.search.setValue('X');release();await pending;
  assert.equal(picker.results().length,0);assert.equal(picker.loading(),false);await pause(350);
});
test('stock changes and failures refresh the automatic query without publishing data after an account change',async()=>{
  const {picker,state,stock,sync}=setup();picker.ngOnInit();await settle();state.fail=true;await picker.load();assert.match(picker.error(),/Offline/);
  state.fail=false;await picker.load();assert.equal(picker.error(),'');stock.set([]);sync();await settle();assert.equal(picker.results().length,0);
  stock.set([{id:'other',name:'Casa',items:[{id:'item',ingredientId:first,recipeId:null,name:'Tomate',space:'pantry'}]}]);
  let release;state.hold=new Promise(resolve=>{release=resolve;});const pending=picker.load();await settle();state.owner='different';release();await pending;assert.equal(picker.results().length,0);
});
test('stock recipe pagination appends the next page and retains previous cards on a retryable page error',async()=>{
  const {picker,state}=setup();state.total=2;picker.ngOnInit();await settle();state.rows=[{id:'second-recipe',name:'Otra receta'}];
  await picker.load(true);assert.equal(state.reads.at(-1).offset,1);assert.deepEqual(plain(picker.results().map(card=>card.id)),['recipe','second-recipe']);
  state.fail=true;await picker.load(true);assert.equal(picker.results().length,2);assert.match(picker.error(),/Offline/);
});
test('planned ingredients are excluded from OR matching while recipes with other free matches remain eligible',async()=>{
  const {picker,state,planned}=setup();planned.set([first]);picker.ngOnInit();await settle();
  assert.deepEqual(state.reads[0].query.ingredientIds,[second]);assert.deepEqual(plain(picker.plannedIngredients().map(item=>item.id)),[first]);
  picker.select(state.rows[0]);assert.equal(state.outputs.length,1);
});
test('all planned ingredients never produce an unfiltered query and become searchable again when released',async()=>{
  const {picker,state,planned,sync}=setup();planned.set([first,second]);picker.ngOnInit();await settle();assert.equal(state.reads.length,0);
  assert.equal(picker.inventoryIngredients().length,2);planned.set([]);sync();await settle();assert.deepEqual(state.reads[0].query.ingredientIds,[first,second]);
});
test('an unavailable planning check blocks searching instead of treating committed ingredients as free',async()=>{
  const {picker,state}=setup();state.planningReady=false;state.planningError='Cannot read planning';picker.ngOnInit();await settle();
  assert.equal(state.reads.length,0);assert.match(picker.error(),/Cannot read/);picker.select(state.rows[0]);assert.equal(state.outputs.length,0);
});
