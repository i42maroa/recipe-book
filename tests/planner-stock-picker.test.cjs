const assert=require('node:assert/strict');
const {test,before}=require('node:test');
const {loadService}=require('./helpers/load-service.cjs');
const search=loadService('src/app/utils/search.utils.ts',{});
const utils=loadService('src/app/utils/planner-inventory.utils.ts',{}, {},{'./search.utils':search});
const rid='aaaaaaaa-1111-4111-8111-111111111111',iid='bbbbbbbb-1111-4111-8111-111111111111';
const settle=()=>new Promise(setImmediate);
let forms,angular;
before(async()=>{await import('@angular/compiler');forms=await import('@angular/forms');angular=await import('@angular/core');});
function setup(){
  const state={owner:'owner',allowed:true,failCards:false,outputs:[],places:[{id:'place',name:'Casa',items:[
    {id:'ingredient',ingredientId:iid,recipeId:null,name:'Tomate',space:'pantry'},
    {id:'recipe',ingredientId:null,recipeId:rid,name:'Arroz',space:'freezer'},
    {id:'product',ingredientId:null,recipeId:null,name:'Producto libre',space:'pantry'},
  ]}]};
  const input=value=>{const read=()=>value;read.set=next=>{value=next;};return read;};
  const stock=angular.signal(state.places);
  const injections={AuthService:{user:()=>({id:state.owner}),canEdit:()=>state.allowed},
    InventoryService:{places:stock,load:async()=>{},dirty:()=>false,error:()=>'',ready:()=>true},
    InventoryPlanningService:{load:async()=>{}},
    RecipeService:{getCardsByIds:async()=>{if(state.failCards)throw Error('Recipes offline');return [{id:rid,pending:false}];}},
    DestroyRef:{destroyed:false,onDestroy(){}}};
  const core={...angular,Component:()=>value=>value,inject:token=>injections[token],input,output:()=>({emit:value=>state.outputs.push(value)}),DestroyRef:'DestroyRef'};
  const {PlannerInventoryPickerComponent}=loadService('src/app/components/planner-inventory-picker/planner-inventory-picker.component.ts',injections,{},
    {'@angular/core':core,'@angular/forms':forms,'@angular/core/rxjs-interop':{toSignal:(source,{initialValue})=>{const read=angular.signal(initialValue);source.subscribe(value=>read.set(value));return read;}},
      '../../utils/planner-inventory.utils':utils,'../../utils/inventory-groups.utils':{inventoryGroupTotal:()=>''}});
  return {picker:new PlannerInventoryPickerComponent(),state,stock};
}
test('prepared stock selection preserves the exact lot without changing its quantities or other items',async()=>{
  const {picker,state,stock}=setup();await picker.load();const before=structuredClone(stock());
  assert.equal(picker.lots().length,1);picker.select({id:rid},state.places[0].items[1],state.places[0]);
  assert.equal(state.outputs[0].inventory.itemId,'recipe');assert.equal(state.outputs[0].inventory.space,'freezer');assert.deepEqual(stock(),before);
});
test('unavailable prepared metadata is retryable without altering stock',async()=>{
  const {picker,state}=setup();state.failCards=true;await picker.load();assert.equal(picker.error(),'');assert.match(picker.recipesError(),/offline/);
  picker.select({id:rid},state.places[0].items[1],state.places[0]);assert.equal(state.outputs.length,0);
  state.failCards=false;await picker.load();assert.equal(picker.recipesError(),'');assert.equal(picker.lots()[0].recipe.id,rid);
});
test('account changes prevent prepared-lot selections from an old owner',async()=>{
  const {picker,state}=setup();picker.ngOnInit();await settle();state.owner='other';
  picker.select({id:rid},state.places[0].items[1],state.places[0]);assert.equal(state.outputs.length,0);
});
