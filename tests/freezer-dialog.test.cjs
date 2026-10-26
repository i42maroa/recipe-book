const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const crypto = require('node:crypto');
const { loadService } = require('./helpers/load-service.cjs');
let setup;

before(async () => {
  // Use real Angular reactive forms; only DOM lifecycle and injected services are stubbed.
  await import('@angular/compiler');
  const forms = await import('@angular/forms');
  const angular = await import('@angular/core');
  const calendar = loadService('src/app/utils/scheduled-meal.utils.ts', {});
  const uuid = loadService('src/app/utils/uuid.utils.ts', {});
  const model = loadService('src/app/models/recipe.model.ts', {});
  const utils = loadService('src/app/utils/freezer.utils.ts', {}, {}, {
    './scheduled-meal.utils': calendar, './uuid.utils': uuid, '../models/recipe.model': model,
  });
  setup = () => {
    const emissions = [];
    const ingredient = { id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Pollo', category: 'Carne' };
    const injections = { IngredientService: { getById: () => ingredient }, DOCUMENT: { body: { style: {} }, activeElement: null }, DestroyRef: { onDestroy() {} } };
    const input = initial => () => initial; input.required = () => () => 'Casa';
    const viewChild = () => () => undefined; viewChild.required = viewChild;
    const core = { ...angular, Component: () => value => value, input, viewChild, afterNextRender() {},
      inject: token => injections[token], DestroyRef: 'DestroyRef', output: () => ({ emit: value => emissions.push(value) }) };
    const { FreezerEntryDialogComponent } = loadService('src/app/components/freezer-entry-dialog/freezer-entry-dialog.component.ts',
      { IngredientService: injections.IngredientService }, { crypto }, {
        '@angular/core': core, '@angular/common': { DOCUMENT: 'DOCUMENT' }, '@angular/forms': forms,
        '../../utils/freezer.utils': utils, '../../utils/scheduled-meal.utils': calendar,
        '../../utils/recipe-display.utils': { ingredientCategoryLabel: value => value },
      });
    const dialog = new FreezerEntryDialogComponent();
    return { dialog, emissions, ingredient, submit: () => dialog.submit({ preventDefault() {} }) };
  };
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
  const form = dialog.rows()[0].form; form.controls.kind.setValue('specific');
  for (const value of [null, 0, -1, NaN, Infinity]) {
    form.controls.value.setValue(value); submit();
    assert.equal(form.invalid, true); assert.equal(emissions.length, 0); assert.equal(form.controls.value.touched, true);
  }
  form.controls.value.setValue(0.001); submit();
  assert.equal(form.valid, true); assert.equal(emissions[0][0].amount.value, 0.001);
});

test('confirmation respects all row validation errors, even if the serialized item is valid', () => {
  const { dialog, emissions, ingredient, submit } = setup(); dialog.addIngredients([ingredient.id]);
  dialog.rows()[0].form.controls.enteredOn.setErrors({ invalidDate: true }); submit();
  assert.equal(emissions.length, 0); assert.match(dialog.error(), /revisa/);
});

test('switching away from a specific quantity makes its unused value optional', () => {
  const { dialog, emissions, ingredient, submit } = setup(); dialog.addIngredients([ingredient.id]);
  const form = dialog.rows()[0].form; form.controls.kind.setValue('specific'); form.controls.value.setValue(-1);
  assert.equal(form.invalid, true); form.controls.kind.setValue('none'); submit();
  assert.equal(form.valid, true); assert.equal(emissions[0][0].amount, null);
});
