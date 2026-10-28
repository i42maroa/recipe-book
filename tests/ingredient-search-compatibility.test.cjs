const assert=require('node:assert/strict');
const {test}=require('node:test');
const {loadService}=require('./helpers/load-service.cjs');
const filters={search:'',pending:'all',sort:'recent',mealType:'',difficulty:'',ingredientIds:['fish','lemon'],ingredientMatch:'all'};
const row=(id,ids)=>({id,name:id,recipe_ingredients:[{count:ids.length}],matched_ingredients:ids.map(ingredient_id=>({ingredient_id,ingredients:{name:ingredient_id}}))});
function setup(){
  const state={calls:[],rows:[row('full-1',['fish','lemon']),row('full-2',['fish','lemon']),row('fish-only',['fish']),row('lemon-only',['lemon'])],error:{code:'PGRST202'},hold:null,failPage:false};
  const client={rpc(name,args){let offset=0;const call={name,args};state.calls.push(call);return {
    select(){return this;},returns(){return this;},range(from){offset=from;call.offset=from;return this;},abortSignal(signal){call.signal=signal;return this;},
    async then(resolve,reject){try{if(name==='search_recipes_with_all_ingredients')return resolve({error:state.error});if(state.hold)await state.hold;if(state.failPage&&offset>0)return resolve({error:Error('Offline')});return resolve({data:state.rows.slice(offset,offset+2),count:state.rows.length,error:null});}catch(error){reject(error);}}
  };}};
  const {RecipeService}=loadService('src/app/services/recipe.service.ts',{}, {},{'../../environments/environment':{environment:{supabaseUrl:'test'}}});
  return {state,service:new RecipeService({configured:true,requireClient:()=>client},{},{})};
}
test('single-ingredient all-match searches use the existing RPC without depending on a migration',async()=>{
  const {service,state}=setup();const result=await service.getBatch({...filters,ingredientIds:['fish']});
  assert.equal(state.calls[0].name,'search_recipes_by_ingredients');assert.equal(result.items.length,2);
});
test('a missing all-match RPC falls back to complete candidate scans and then returns the correct page and count',async()=>{
  const {service,state}=setup();const result=await service.getBatch(filters,1,1);
  assert.deepEqual(Array.from(result.items,item=>item.id),['full-2']);assert.equal(result.total,2);assert.equal(result.offset,1);
  assert.deepEqual(state.calls.map(call=>[call.name,call.offset]),[['search_recipes_with_all_ingredients',1],['search_recipes_by_ingredients',0],['search_recipes_by_ingredients',2]]);
  state.rows=[row('fish-only',['fish']),row('lemon-only',['lemon'])];assert.equal((await service.getBatch(filters)).total,0);
});
test('fallback failures and cancellation never publish a partial result as a successful empty search',async()=>{
  const {service,state}=setup();state.failPage=true;await assert.rejects(service.getBatch(filters),/Offline/);
  state.failPage=false;let release;state.hold=new Promise(resolve=>{release=resolve;});const controller=new AbortController();
  const pending=service.getBatch(filters,0,20,controller.signal);await new Promise(setImmediate);controller.abort();release();await assert.rejects(pending,error=>error.name==='AbortError');
});
test('ordinary connection or permission errors do not trigger the compatibility fallback',async()=>{
  const {service,state}=setup();state.error=Object.assign(Error('Forbidden'),{code:'42501'});await assert.rejects(service.getBatch(filters),/Forbidden/);assert.equal(state.calls.length,1);
});
