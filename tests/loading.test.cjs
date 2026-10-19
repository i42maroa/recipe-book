const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadService } = require('./helpers/load-service.cjs');
const { LoadingService } = loadService('src/app/services/loading.service.ts', {});
const gate = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test('independent sections run concurrently and finish independently', async () => {
  const loading = new LoadingService(), a = gate(), b = gate();
  const started = [];
  const first = loading.run(() => { started.push('recipes'); return a.promise; }, 'recipes');
  const second = loading.run(() => { started.push('ingredients'); return b.promise; }, 'ingredients');
  assert.deepEqual(started, ['recipes', 'ingredients']);
  assert.equal(loading.isLoading('recipes'), true);
  assert.equal(loading.isLoading('ingredients'), true);
  b.resolve('ready');
  assert.equal(await second, 'ready');
  assert.equal(loading.isLoading('ingredients'), false);
  assert.equal(loading.isLoading('recipes'), true);
  a.resolve(); await first;
  assert.equal(loading.isLoading(), false);
});

test('a section stays busy until all its operations settle, including failures', async () => {
  const loading = new LoadingService(), a = gate();
  const first = loading.run(() => a.promise, 'save');
  await assert.rejects(loading.run(async () => { throw Error('failure'); }, 'save'));
  assert.equal(loading.isLoading('save'), true);
  a.resolve(); await first;
  assert.equal(loading.isLoading('save'), false);
  await assert.rejects(loading.run(() => { throw Error('synchronous'); }, 'read'));
  assert.equal(loading.isLoading(), false);
});
