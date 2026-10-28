const assert=require('node:assert/strict');
const {test,before}=require('node:test');
const {BehaviorSubject}=require('rxjs');
const {loadService}=require('./helpers/load-service.cjs');
const search=loadService('src/app/utils/search.utils.ts',{});
const filters=loadService('src/app/utils/recipe-filters.utils.ts',{}, {},{'./search.utils':search});
const plain=value=>JSON.parse(JSON.stringify(value));
const settle=()=>new Promise(setImmediate);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const card={id:'aaaaaaaa-1111-4111-8111-111111111111',name:'Arroz',pending:false};
let angular,forms;
before(async()=>{await import('@angular/compiler');angular=await import('@angular/core');forms=await import('@angular/forms');});
function setup(){
  const state={calls:[],outputs:[],fail:false,hold:null,rows:[card],cache:new Map()};
  const recipeState={pickerFilters:{search:'',pending:'all',sort:'recent',mealType:'',difficulty:''},
    pickerPage:query=>state.cache.get(JSON.stringify(query)),rememberPicker:(query,page)=>state.cache.set(JSON.stringify(query),plain(page))};
  const destroy={destroyed:false,onDestroy:fn=>{state.destroy=()=>{destroy.destroyed=true;fn();};}};
  const recipes={changes$:new BehaviorSubject(0),getBatch:async(query,offset,limit,signal)=>{
    state.calls.push({query:plain(query),offset,signal});const rows=structuredClone(state.rows),fail=state.fail,hold=state.hold;
    if(hold)await hold;if(fail)throw Error('Offline');return {items:rows,offset,total:rows.length};
  }};
  const injections={RecipeService:recipes,PlannerStateService:recipeState,DestroyRef:destroy,DOCUMENT:{activeElement:null}};
  const input=value=>{const read=()=>value;read.set=next=>{value=next;};return read;};input.required=()=>input('');
  const core={...angular,Component:()=>value=>value,input,output:()=>({emit:value=>state.outputs.push(value)}),
    viewChild:()=>()=>undefined,afterNextRender(){},inject:token=>injections[token],DestroyRef:'DestroyRef'};
  const modules={'@angular/core':core,'@angular/common':{DOCUMENT:'DOCUMENT'},'@angular/forms':forms,
    '@angular/core/rxjs-interop':{takeUntilDestroyed:()=>source=>source},'../../utils/search.utils':search,'../../utils/recipe-filters.utils':filters};
  const component=new (loadService('src/app/components/recipe-picker/recipe-picker.component.ts',injections,{},modules).RecipePickerComponent)();
  return {component,state,recipeState};
}

test('inventory starts selected while the existing inventory entry selector still starts in the recipe catalogue',async()=>{
  const {component}=setup();component.ngOnInit();assert.equal(component.source(),'inventory');
  component.purpose.set('inventory');component.ngOnInit();assert.equal(component.source(),'recipes');await settle();
});
test('opening stock recipes retains an independent panel without changing catalogue filters',async()=>{
  const {component,state}=setup();component.ngOnInit();await settle();state.calls=[];
  assert.equal(component.stockOpened(),false);component.chooseSource('stock');assert.equal(component.stockOpened(),true);
  assert.equal(component.source(),'stock');assert.equal(component.status.value,'all');assert.equal(state.calls.length,0);
});
test('switching stock and catalogue sources preserves the general catalogue search',async()=>{
  const {component}=setup();component.ngOnInit();component.chooseSource('recipes');component.search.setValue('Arroz');component.status.setValue('pending');
  await wait(350);component.chooseSource('stock');component.chooseSource('recipes');
  assert.equal(component.search.value,'Arroz');assert.equal(component.status.value,'pending');assert.equal(component.stockOpened(),true);
});
test('keyboard tabs traverse inventory, stock recipes and catalogue, wrap and support Home and End',async()=>{
  const {component}=setup();const focused=[];
  const event=key=>({key,preventDefault(){},currentTarget:{parentElement:{querySelector:selector=>({focus:()=>focused.push(selector)})}}});
  assert.deepEqual(plain(component.sources.map(tab=>tab.id)),['inventory','stock','recipes']);
  component.sourceKey(event('ArrowRight'));assert.equal(component.source(),'stock');
  component.sourceKey(event('ArrowRight'));assert.equal(component.source(),'recipes');
  component.sourceKey(event('End'));assert.equal(component.source(),'recipes');
  component.sourceKey(event('ArrowRight'));assert.equal(component.source(),'inventory');
  component.sourceKey(event('ArrowLeft'));assert.equal(component.source(),'recipes');
  component.sourceKey(event('Home'));assert.equal(component.source(),'inventory');assert.equal(focused.length,6);await settle();
});
test('prepared inventory selection preserves the exact source and prevents duplicate planning',async()=>{
  const {component,state}=setup();await settle();const selection={recipe:card,inventory:{placeId:'place',itemId:'lot',placeName:'Casa',space:'freezer'}};
  component.excludedRecipeIds.set([card.id.toUpperCase()]);component.selectInventory(selection);assert.equal(state.outputs.length,0);
  component.excludedRecipeIds.set([]);component.selectInventory(selection);component.selectInventory(selection);assert.deepEqual(state.outputs,[selection]);
});
test('all-match recipe pages never reuse an any-match cache entry for the same ingredients',()=>{
  const common={search:'',pending:'all',sort:'recent',mealType:'',difficulty:'',ingredientIds:['a','b']};
  assert.notEqual(filters.recipeFilterKey(common),filters.recipeFilterKey({...common,ingredientMatch:'all'}));
});
