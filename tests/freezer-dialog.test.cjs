const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const crypto = require('node:crypto');
const { loadService } = require('./helpers/load-service.cjs');
const measures = loadService('src/app/utils/ingredient-measures.utils.ts', {});
let setup;

before(async () => {
  // Use real Angular reactive forms; only DOM lifecycle and injected services are stubbed.
  await import('@angular/compiler');
  const forms = await import('@angular/forms');
  const angular = await import('@angular/core');
  const calendar = loadService('src/app/utils/scheduled-meal.utils.ts', {});
  const uuid = loadService('src/app/utils/uuid.utils.ts', {});
  const model = loadService('src/app/models/recipe.model.ts', {});
  const scroll = loadService('src/app/utils/dialog-scroll.utils.ts', {});
  const utils = loadService('src/app/utils/freezer.utils.ts', {}, {}, {
    './ingredient-measures.utils': measures, './scheduled-meal.utils': calendar, './uuid.utils': uuid, '../models/recipe.model': model,
  });
  const inventoryUtils = loadService('src/app/utils/inventory.utils.ts', {}, { crypto }, {
    './ingredient-measures.utils': measures, './freezer.utils': utils, './scheduled-meal.utils': calendar, './uuid.utils': uuid,
  });
  setup = () => {
    const emissions = [];
    const ingredient = { id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Pollo', category: 'Carne' };
    const injections = { IngredientService: { getById: () => ingredient }, PlannerStateService: { pickerFilters: { search: '', pending: 'all', sort: 'recent', mealType: '', difficulty: '' } }, DOCUMENT: { body: { style: {} }, activeElement: null }, DestroyRef: { onDestroy() {} } };
    const input = initial => () => initial; input.required = () => () => 'Casa';
    const viewChild = () => () => undefined; viewChild.required = viewChild;
    const core = { ...angular, Component: () => value => value, input, viewChild, afterNextRender() {},
      inject: token => injections[token], DestroyRef: 'DestroyRef', output: () => ({ emit: value => emissions.push(value) }) };
    const { InventoryEntryDialogComponent } = loadService('src/app/components/inventory-entry-dialog/inventory-entry-dialog.component.ts',
      { IngredientService: injections.IngredientService, PlannerStateService: injections.PlannerStateService }, { crypto }, {
        '@angular/core': core, '@angular/common': { DOCUMENT: 'DOCUMENT' }, '@angular/forms': forms,
        '../../utils/freezer.utils': utils, '../../utils/inventory.utils': inventoryUtils, '../../utils/scheduled-meal.utils': calendar,
        '../../utils/dialog-scroll.utils': scroll, '../../utils/ingredient-measures.utils': measures,
        '../../utils/recipe-display.utils': { ingredientCategoryLabel: value => value },
      });
    const dialog = new InventoryEntryDialogComponent(); dialog.space = () => 'pantry';
    return { dialog, emissions, ingredient, recipeState: injections.PlannerStateService, submit: () => dialog.submit({ preventDefault() {} }) };
  };
});

test('inventory recipe searches start with prepared recipes and retain multiple distinct selections', () => {
  const { dialog, recipeState } = setup();
  assert.equal(recipeState.pickerFilters.pending, 'done');
  const first={id:'bbbbbbbb-1111-4111-8111-111111111111',name:'Lentejas'};
  const second={id:'cccccccc-1111-4111-8111-111111111111',name:'Arroz'};
  dialog.addRecipe(first); dialog.addRecipe(second); dialog.addRecipe(first);
  assert.equal(dialog.rows().length,2);
  assert.deepEqual(Array.from(dialog.selectedRecipeIds()),[first.id,second.id]);
});

test('a hidden product draft does not block confirming selected ingredients', () => {
  const { dialog, emissions, ingredient, submit } = setup();
  dialog.mode.set('product'); dialog.productName.setValue('Producto pendiente'); dialog.mode.set('ingredient');
  dialog.addIngredients([ingredient.id]); submit();
  assert.equal(emissions.length, 1); assert.equal(emissions[0].length, 1);
  assert.equal(emissions[0][0].name, 'Pollo'); assert.equal(dialog.error(), '');
});

test('the product draft stays available when returning to its tab and must be explicitly added there', () => {
  const { dialog, emissions, ingredient, submit } = setup();
  dialog.productName.setValue('Producto pendiente'); dialog.addIngredients([ingredient.id]); dialog.mode.set('product'); submit();
  assert.equal(emissions.length, 0); assert.match(dialog.error(), /Añadir/);
  dialog.addProduct(); submit(); assert.equal(emissions[0].length, 2); assert.equal(dialog.productName.value, '');
});

test('specific quantities reject missing, nonfinite and nonpositive values before confirmation', () => {
  const { dialog, emissions, ingredient, submit } = setup(); dialog.addIngredients([ingredient.id]);
  const form = dialog.rows()[0].form;
  for (const value of [null, 0, -1, NaN, Infinity]) {
    form.controls.amount.setValue({kind:'specific',value,unit:'g'}); submit();
    assert.equal(form.invalid, true); assert.equal(emissions.length, 0); assert.equal(form.controls.amount.touched, true);
  }
  form.controls.amount.setValue({kind:'specific',value:0.001,unit:'g'}); submit();
  assert.equal(form.valid, true); assert.equal(emissions[0][0].amount.value, 0.001);
});

test('confirmation respects all row validation errors, even if the serialized item is valid', () => {
  const { dialog, emissions, ingredient, submit } = setup(); dialog.addIngredients([ingredient.id]);
  dialog.rows()[0].form.controls.enteredOn.setErrors({ invalidDate: true }); submit();
  assert.equal(emissions.length, 0); assert.match(dialog.error(), /revisa/);
});

test('switching away from a specific quantity makes its unused value optional', () => {
  const { dialog, emissions, ingredient, submit } = setup(); dialog.addIngredients([ingredient.id]);
  const form = dialog.rows()[0].form; form.controls.amount.setValue({kind:'specific',value:-1,unit:'g'});
  assert.equal(form.invalid, true); form.controls.amount.setValue(null); submit();
  assert.equal(form.valid, true); assert.equal(emissions[0][0].amount, null);
});

test('recipe portions reject fractional, missing and excessive values, and preserve the selected name', () => {
  const { dialog, emissions, submit } = setup();
  dialog.addRecipe({ id: 'bbbbbbbb-1111-4111-8111-111111111111', name: 'Lentejas' });
  const row = dialog.rows()[0]; assert.equal(row.item.space, 'pantry');
  for (const servings of [null, 0, -1, 1.5, NaN, Infinity, 2147483648]) {
    row.form.controls.servings.setValue(servings); submit(); assert.equal(emissions.length, 0);
  }
  row.form.controls.servings.setValue(3); submit();
  assert.equal(emissions[0][0].servings, 3); assert.equal(emissions[0][0].amount, null); assert.equal(emissions[0][0].name, 'Lentejas');
});

test('mixed entries keep their quantities and entry dates independently', () => {
  const { dialog, emissions, ingredient, submit } = setup();
  dialog.addIngredients([ingredient.id]); dialog.addRecipe({ id: 'bbbbbbbb-1111-4111-8111-111111111111', name: 'Lentejas' });
  const first = dialog.rows()[0].form; first.controls.enteredOn.setValue('2026-10-20');
  first.controls.amount.setValue({kind:'specific',value:250,unit:'g'});
  const second = dialog.rows()[1].form; second.controls.servings.setValue(2); second.controls.enteredOn.setValue('2026-10-21'); submit();
  assert.equal(emissions[0].length, 2); assert.equal(emissions[0][0].amount.value, 250); assert.equal(emissions[0][1].servings, 2);
  assert.equal(emissions[0][0].arrivedOn, '2026-10-20'); assert.equal(emissions[0][1].arrivedOn, '2026-10-21');
});
