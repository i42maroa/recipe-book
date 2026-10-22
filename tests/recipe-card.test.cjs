const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadService } = require('./helpers/load-service.cjs');

function cardComponent() {
  const input = value => {
    const read = () => value;
    read.set = next => { value = next; };
    return read;
  };
  input.required = () => input(undefined);
  const { RecipeCardComponent } = loadService('src/app/components/recipe-card/recipe-card.component.ts', {}, {}, {
    '@angular/core': { Component: () => value => value, input, output: () => ({}), computed: read => read },
  });
  return new RecipeCardComponent();
}

test('cards show only selected matching ingredients, in filter order, without duplicate tags', () => {
  const card = cardComponent();
  card.recipe.set({ matchedIngredients: [
    { id: 'tomato', name: 'Tomate' }, { id: 'lettuce', name: 'Lechuga' },
  ] });
  card.ingredientFilterIds.set(['lettuce', 'TOMATO', 'lettuce', 'rice']);
  assert.deepEqual(JSON.parse(JSON.stringify(card.matchedIngredients())), [
    { id: 'lettuce', name: 'Lechuga' }, { id: 'tomato', name: 'Tomate' },
  ]);
  card.ingredientFilterIds.set(['rice']);
  assert.equal(card.matchedIngredients().length, 0);
});

test('clearing filters or displaying cached cards outside ingredient search hides all match tags', () => {
  const card = cardComponent();
  card.recipe.set({ matchedIngredients: [{ id: 'tomato', name: 'Tomate' }] });
  assert.equal(card.matchedIngredients().length, 0);
  card.ingredientFilterIds.set(['tomato']);
  assert.equal(card.matchedIngredients().length, 1);
  card.ingredientFilterIds.set([]);
  assert.equal(card.matchedIngredients().length, 0);
  card.ingredientFilterIds.set(['tomato']);
  card.recipe.set({});
  assert.equal(card.matchedIngredients().length, 0);
});
