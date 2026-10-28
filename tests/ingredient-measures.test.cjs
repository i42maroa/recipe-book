const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadService } = require('./helpers/load-service.cjs');
const measures = loadService('src/app/utils/ingredient-measures.utils.ts', {});
const groups = loadService('src/app/utils/inventory-groups.utils.ts', {}, {}, {
  '../models/recipe.model': { INGREDIENT_CATEGORIES: [] },
  './ingredient-measures.utils': measures,
});
const tomato = { id: 'tomato', category: 'Verdura', baseUnit: 'g', unitQuantity: 150 };
const milk = { category: 'Liquidos', baseUnit: 'ml', unitQuantity: 1000 };
const spice = { category: 'Especia', baseUnit: 'g', unitQuantity: null };

test('ingredient configuration requires a base and a positive finite optional unit equivalence', () => {
  for (const value of [{baseUnit:'g',unitQuantity:null},{baseUnit:'ml',unitQuantity:1000}]) assert.equal(measures.validIngredientMeasures(value), true);
  for (const value of [null,{}, {baseUnit:'',unitQuantity:null},{baseUnit:'g'}, ...[0,-1,NaN,Infinity].map(unitQuantity=>({baseUnit:'g',unitQuantity}))]) assert.equal(measures.validIngredientMeasures(value), false);
  assert.equal(measures.ingredientBaseUnit({category:'Liquidos'}), 'ml');
  assert.equal(measures.ingredientBaseUnit({category:'Verdura'}), 'g');
});

test('units capture their equivalence and recipe labels use the stored value after catalogue edits', () => {
  const amount = measures.measuredAmount('pieza',2,tomato);
  assert.deepEqual(JSON.parse(JSON.stringify(amount)), {kind:'specific',unit:'pieza',value:2,baseUnit:'g',unitQuantity:150});
  assert.equal(measures.ingredientAmountLabel(amount,true,{...tomato,unitQuantity:200}), '2 unidades (300 g)');
  const changed = measures.measuredAmount('pieza',1,{...tomato,unitQuantity:200},amount);
  assert.equal(measures.ingredientAmountLabel(changed,true,tomato), '1 unidad (150 g)');
  assert.equal(measures.ingredientAmountLabel(measures.measuredAmount('pieza',2,milk),true,milk), '2 unidades (2000 ml)');
});

test('only spices accept new tablespoons and all tablespoons use five grams including fractions', () => {
  const amount = measures.measuredAmount('spoon',0.5,spice);
  assert.equal(measures.allowedIngredientAmount(amount,spice),true);
  assert.equal(measures.allowedIngredientAmount(amount,tomato),false);
  assert.equal(measures.ingredientAmountLabel(amount,true,spice),'0,5 cucharadas (2,5 g)');
  assert.equal(measures.ingredientAmountLabel({kind:'spoon'},true,spice),'1 cucharada (5 g)');
});

test('new values respect the configured measure and reject unconfigured units and historical glasses', () => {
  assert.equal(measures.allowedIngredientAmount({kind:'specific',value:50,unit:'ml'},tomato),false);
  assert.equal(measures.allowedIngredientAmount({kind:'specific',value:50,unit:'g'},tomato),true);
  assert.equal(measures.allowedIngredientAmount({kind:'specific',value:1,unit:'pieza'},spice),false);
  assert.equal(measures.allowedIngredientAmount({kind:'glass'},milk),false);
  for(const value of [null,0,-1,NaN,Infinity]) assert.equal(measures.validIngredientAmount({kind:'spoon',value}),false);
  assert.equal(measures.validIngredientAmount({kind:'specific',value:1,unit:'pieza',baseUnit:'g'}),false);
});

test('historical quantities can remain unchanged or decrease without configuring an invented equivalence', () => {
  const old = {kind:'specific',value:3,unit:'pieza'};
  const unconfigured = {...tomato,unitQuantity:null};
  assert.equal(measures.allowedIngredientAmount(old,unconfigured,old),true);
  assert.equal(measures.allowedIngredientAmount({...old,value:1},unconfigured,old),true);
  assert.equal(measures.allowedIngredientAmount({...old,value:4},unconfigured,old),false);
  assert.equal(measures.allowedIngredientAmount({kind:'glass'},milk,{kind:'glass'}),true);
});

test('inventory totals sum by measure while all dated lots remain independent', () => {
  const items = [
    {id:'a',amount:{kind:'specific',value:1,unit:'pieza',baseUnit:'g',unitQuantity:150}},
    {id:'b',amount:{kind:'specific',value:2,unit:'pieza',baseUnit:'g',unitQuantity:200}},
    {id:'c',amount:{kind:'specific',value:200,unit:'g'}},
    {id:'d',amount:{kind:'specific',value:300,unit:'g'}},
  ];
  const original = JSON.stringify(items);
  assert.equal(groups.inventoryGroupTotal(items),'3 unidades + 500 g');
  assert.equal(JSON.stringify(items),original);
  assert.equal(groups.inventoryGroupTotal([{recipeId:'r',servings:2},{recipeId:'r',servings:3}]),'5 raciones');
});

test('measure form requires a base and a positive content only when units are enabled', async () => {
  await import('@angular/compiler');
  const forms=await import('@angular/forms');
  const helpers=loadService('src/app/utils/ingredient-measures-form.utils.ts',{}, {},{'@angular/forms':forms,'./ingredient-measures.utils':measures});
  const form=helpers.ingredientMeasuresForm();
  assert.equal(form.valid,false);
  form.controls.baseUnit.setValue('g'); assert.equal(form.valid,true);
  form.controls.unitsEnabled.setValue(true); assert.equal(form.valid,false);
  form.controls.unitQuantity.setValue(150); assert.equal(form.valid,true);
  form.controls.unitQuantity.setValue(0); assert.equal(form.valid,false);
  form.controls.unitsEnabled.setValue(false); assert.equal(form.valid,true);
  assert.equal(helpers.measuresFormValue(form).unitQuantity,null);
});
