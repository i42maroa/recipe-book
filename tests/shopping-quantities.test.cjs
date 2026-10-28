const assert=require('node:assert/strict');
const {test}=require('node:test');
const {loadService}=require('./helpers/load-service.cjs');
const measures=loadService('src/app/utils/ingredient-measures.utils.ts',{});
const q=loadService('src/app/utils/shopping-quantities.utils.ts',{}, {},{'./ingredient-measures.utils':measures});
const id='aaaaaaaa-1111-4111-8111-111111111111';
const ingredient={id,name:'Tomate',category:'Verdura',baseUnit:'g',unitQuantity:150};
const amount=(value,unit='g')=>({kind:'specific',unit,value});
const row=(value=200,factor=1,extra={})=>({source:'one',id,name:'Tomate',category:'Verdura',base_unit:'g',unit_quantity:150,amount:amount(value),factor,missing_servings:false,...extra});
const plain=value=>JSON.parse(JSON.stringify(value));
const stock=amounts=>[{id:'place',name:'Casa',items:amounts.map((value,index)=>({id:String(index),ingredientId:id,recipeId:null,amount:value,space:index%2?'pantry':'freezer'}))}];

test('requirements sum scaled quantities instead of treating recipe appearances as units',()=>{
  const items=q.shoppingRequirements([row(200,0.5),row(300,2,{source:'two'})]);
  assert.equal(items[0].occurrences,2);assert.deepEqual(plain(items[0].amounts),[amount(700)]);assert.equal(q.shoppingQuantityLabel(items[0]),'700 g');
});
test('units retain saved equivalents and spoons become five grams only for spices',()=>{
  const unit=row(0,0.5,{amount:{...amount(2,'pieza'),baseUnit:'g',unitQuantity:100}});
  const result=q.shoppingRequirements([unit,row(0,2,{id:'spice',category:'Especia',amount:{kind:'spoon',value:1.5}})]);
  assert.deepEqual(plain(result[0].amounts),[{...amount(1,'pieza'),baseUnit:'g',unitQuantity:100}]);
  assert.deepEqual(plain(result[1].amounts),[amount(15)]);
});
test('historical unit amounts use configured equivalents and an unquantified requirement defaults to one additional unit',()=>{
  const item=q.shoppingRequirements([row(0,1,{amount:amount(2,'pieza')}),row(0,1,{amount:null}),row(0,1,{amount:{kind:'glass'},missing_servings:true})])[0];
  assert.equal(item.amounts[0].unitQuantity,150);assert.equal(item.amounts[0].value,3);assert.equal(item.unquantified,1);assert.ok(item.notes.length);assert.equal(q.shoppingPurchaseReady([item]),true);
  assert.equal(q.shoppingQuantityLabel(item),'3 unidades (450 g) + 1 unidad');
});

test('missing quantities default to one unit per planned appearance without scaling the fallback',()=>{
  const items=q.shoppingRequirements([row(0,0.5,{amount:null}),row(0,3,{source:'two',amount:null})]);
  assert.deepEqual(plain(items[0].amounts),[{...amount(2,'pieza'),baseUnit:'g',unitQuantity:150}]);
  assert.equal(items[0].unquantified,0);assert.equal(q.shoppingQuantityLabel(items[0]),'2 unidades (300 g)');assert.equal(q.shoppingPurchaseReady(items),true);
});

test('missing quantities work without a unit equivalent and an incomplete specific amount also defaults to one unit',()=>{
  for(const missing of [null,amount(null)]){
    const items=q.shoppingRequirements([row(0,2,{amount:missing,unit_quantity:null})]);
    assert.deepEqual(plain(items[0].amounts),[amount(1,'pieza')]);assert.equal(q.shoppingQuantityLabel(items[0]),'1 unidad');assert.equal(q.shoppingPurchaseReady(items),true);
  }
});

test('default units are added to explicit quantities and inventory covers only the compatible missing amount',()=>{
  const items=q.shoppingRequirements([row(200),row(0,2,{source:'two',amount:null})]);
  assert.deepEqual(plain(items[0].amounts),[amount(200),{...amount(1,'pieza'),baseUnit:'g',unitQuantity:150}]);
  const remaining=q.subtractShoppingStock(items,stock([amount(300)]),[ingredient]);assert.deepEqual(plain(remaining[0].amounts),[amount(50)]);
  assert.equal(q.subtractShoppingStock(items,stock([amount(350)]),[ingredient]).length,0);
  const withoutEquivalent=q.shoppingRequirements([row(0,1,{amount:null,unit_quantity:null})]);
  assert.equal(q.subtractShoppingStock(withoutEquivalent,stock([amount(1,'pieza')]),[]).length,0);
});
test('only the missing grams are requested after subtracting all owned pantry and freezer lots',()=>{
  const items=q.shoppingRequirements([row(700)]),places=stock([amount(100),amount(200)]);const before=structuredClone(places);
  const result=q.subtractShoppingStock(items,places,[ingredient]);assert.deepEqual(plain(result[0].amounts),[amount(400)]);
  assert.deepEqual(places,before);assert.equal(items[0].amounts[0].value,700);
});
test('stock units convert using their equivalents and can cover a requirement expressed in grams',()=>{
  const result=q.subtractShoppingStock(q.shoppingRequirements([row(500)]),stock([{...amount(2,'pieza'),baseUnit:'g',unitQuantity:150}]),[ingredient]);
  assert.deepEqual(plain(result[0].amounts),[amount(200)]);
  const remaining=q.subtractShoppingStock(q.shoppingRequirements([row(0,1,{amount:{...amount(2,'pieza'),baseUnit:'g',unitQuantity:150}})]),stock([amount(250)]),[ingredient]);
  assert.deepEqual(plain(remaining[0].amounts),[amount(50)]);
});
test('inventory cannot be subtracted twice from multiple measures of the same ingredient',()=>{
  const item={id,name:'Tomate',category:'Verdura',occurrences:1,amounts:[amount(100),{...amount(1,'pieza'),baseUnit:'g',unitQuantity:150}],unquantified:0};
  const result=q.subtractShoppingStock([item],stock([amount(200)]),[ingredient]);assert.deepEqual(plain(result[0].amounts),[amount(50)]);
});
test('prepared dishes, unmeasured lots and incompatible measures do not remove needed ingredients',()=>{
  const places=stock([null,amount(999,'ml')]);places[0].items.push({ingredientId:null,recipeId:'prepared',amount:null,servings:10});
  const result=q.subtractShoppingStock(q.shoppingRequirements([row(200)]),places,[ingredient]);assert.equal(result[0].amounts[0].value,200);
});
test('fully covered ingredients disappear but unknown requirements stay for manual review',()=>{
  assert.equal(q.subtractShoppingStock(q.shoppingRequirements([row(200)]),stock([amount(300)]),[ingredient]).length,0);
  const result=q.subtractShoppingStock(q.shoppingRequirements([row(200),row(0,1,{amount:{kind:'glass'}})]),stock([amount(300)]),[ingredient]);
  assert.equal(result.length,1);assert.equal(result[0].amounts.length,0);assert.equal(result[0].unquantified,1);
});
test('decimal subtraction does not leave phantom shopping quantities and overflow is rejected',()=>{
  assert.equal(q.subtractShoppingStock(q.shoppingRequirements([row(0.1),row(0.2)]),stock([amount(0.3)]),[ingredient]).length,0);
  assert.throws(()=>q.shoppingRequirements([row(Number.MAX_VALUE,10)]),/cantidades|rango/);
});
test('purchase readiness defaults missing quantities to one unit without interpreting legacy counters as quantities',()=>{
  assert.equal(q.shoppingPurchaseReady([{id,name:'Tomate',category:'Verdura',occurrences:3}]),true);
  assert.equal(q.shoppingPurchaseReady(q.shoppingRequirements([row(200)])),true);assert.equal(q.shoppingPurchaseReady([]),false);
});

test('default quantities are idempotent and preserve known amounts and source data when displayed or shared',()=>{
  const original={id,name:'Tomate',category:'Verdura',occurrences:9,amounts:[amount(250)],unquantified:2};const before=structuredClone(original);
  const result=q.shoppingDefaultQuantity(original);assert.deepEqual(plain(result.amounts),[amount(250),amount(1,'pieza')]);assert.equal(result.unquantified,0);
  assert.deepEqual(plain(q.shoppingDefaultQuantity(result)),plain(result));assert.deepEqual(original,before);assert.equal(q.shoppingQuantityLabel(original),'250 g + 1 unidad');
  assert.equal(q.shoppingPurchaseReady([{...original,amounts:[{kind:'glass'}],unquantified:0}]),false);
});
