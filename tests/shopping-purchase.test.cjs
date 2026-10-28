const assert=require('node:assert/strict');const {test}=require('node:test');const crypto=require('node:crypto');const {Subject}=require('rxjs');
const {loadService}=require('./helpers/load-service.cjs');
const measures=loadService('src/app/utils/ingredient-measures.utils.ts',{}),calendar=loadService('src/app/utils/scheduled-meal.utils.ts',{}),uuid=loadService('src/app/utils/uuid.utils.ts',{});
const q=loadService('src/app/utils/shopping-quantities.utils.ts',{}, {},{'./ingredient-measures.utils':measures});
const utils=loadService('src/app/utils/shopping-list.utils.ts',{}, {},{'./ingredient-measures.utils':measures,'./shopping-quantities.utils':q,'./scheduled-meal.utils':calendar,'./uuid.utils':uuid,'../models/recipe.model':loadService('src/app/models/recipe.model.ts',{})});
const place='bbbbbbbb-1111-4111-8111-111111111111';const item={id:'aaaaaaaa-1111-4111-8111-111111111111',name:'Tomate',category:'Verdura',occurrences:1,amounts:[{kind:'specific',unit:'g',value:350}],unquantified:0};
const plain=value=>JSON.parse(JSON.stringify(value));
function setup(){
  const state={owner:'owner',allowed:true,calls:[],receipts:new Map(),stock:[],lost:false,error:null,hold:null};const changes=new Subject();
  const client={from:()=>({select(){return this;},eq(){return this;},abortSignal(){return this;},maybeSingle:async()=>({data:null,error:null})}),
    rpc:async(name,args)=>{assert.equal(name,'complete_shopping_purchase');state.calls.push(structuredClone(args));if(state.hold)await state.hold;if(state.error)return {data:null,error:state.error};
      if(!state.receipts.has(args.p_operation_id)){state.receipts.set(args.p_operation_id,1);state.stock.push(...args.p_items);}
      return state.lost?{data:null,error:{message:'Response lost'}}:{data:state.receipts.get(args.p_operation_id),error:null};}};
  const {ShoppingListService}=loadService('src/app/services/shopping-list.service.ts',{
    AuthService:{user:()=>state.owner?{id:state.owner}:null,canEdit:()=>state.allowed,requireEditor:async()=>{if(!state.owner||!state.allowed)throw Error('Denied');}},
    SupabaseService:{requireClient:()=>client},RecipeService:{changes$:changes},ScheduledMealService:{changes$:changes},IngredientService:{ingredientIndex$:changes},
  },{crypto},{'../utils/shopping-list.utils':utils,'../utils/shopping-quantities.utils':q,'../utils/scheduled-meal.utils':calendar,'../utils/uuid.utils':uuid,'@angular/core/rxjs-interop':{takeUntilDestroyed:()=>source=>source}});
  return {state,list:new ShoppingListService()};
}
test('purchase sends one atomic operation with quantities and clears the draft only on success',async()=>{
  const {list,state}=setup();await list.load();list.replace([item]);assert.equal(await list.purchase(place),true);
  assert.equal(state.calls.length,1);assert.deepEqual(state.calls[0].p_items,[item]);assert.equal(state.calls[0].p_expected_version,0);assert.equal(state.calls[0].p_place_id,place);
  assert.equal(list.items().length,0);assert.equal(list.dirty(),false);assert.equal(list.purchasePending(),false);
});
test('lost acknowledgements preserve the list and retry the same operation without buying twice',async()=>{
  const {list,state}=setup();await list.load();list.replace([item]);state.lost=true;assert.equal(await list.purchase(place),false);
  assert.equal(list.purchasePending(),true);assert.deepEqual(plain(list.items()),[item]);list.clear();assert.equal(list.items().length,1);
  state.lost=false;assert.equal(await list.purchase(place),true);assert.deepEqual(state.calls[0],state.calls[1]);assert.equal(state.stock.length,1);assert.equal(list.items().length,0);
});
test('definitive version conflicts preserve quantities and unlock reloading instead of keeping an uncertain purchase',async()=>{
  const {list,state}=setup();await list.load();list.replace([item]);state.error={code:'40001',message:'Changed elsewhere'};
  assert.equal(await list.purchase(place),false);assert.equal(list.purchasePending(),false);assert.deepEqual(plain(list.items()),[item]);assert.match(list.saveError(),/Changed/);
});
test('invalid destinations cannot reach the purchase RPC even with a default quantity',async()=>{
  const {list,state}=setup();await list.load();list.replace([{id:item.id,name:item.name,category:item.category,occurrences:3}]);
  list.setAmounts(item.id,item.amounts);assert.equal(list.items()[0].amounts[0].value,350);
  assert.equal(await list.purchase('invalid'),false);assert.equal(state.calls.length,0);
});

test('a purchase records one real unit for a missing quantity and retries the same payload after a lost response',async()=>{
  const {list,state}=setup();await list.load();const legacy={id:item.id,name:item.name,category:item.category,occurrences:9};list.replace([legacy]);state.lost=true;
  assert.equal(await list.purchase(place),false);assert.deepEqual(plain(state.calls[0].p_items),[{...legacy,amounts:[{kind:'specific',unit:'pieza',value:1}],unquantified:0}]);
  state.lost=false;assert.equal(await list.purchase(place),true);assert.deepEqual(state.calls[0],state.calls[1]);assert.equal(state.stock.length,1);
});
test('a pending purchase cannot issue duplicate concurrent writes or publish into another account',async()=>{
  const {list,state}=setup();await list.load();list.replace([item]);let release;state.hold=new Promise(resolve=>{release=resolve;});
  const pending=list.purchase(place);await new Promise(setImmediate);assert.equal(await list.purchase(place),false);assert.equal(state.calls.length,1);
  state.owner='other';await list.load();release();assert.equal(await pending,false);assert.equal(list.items().length,0);assert.equal(list.purchasePending(),false);
});
