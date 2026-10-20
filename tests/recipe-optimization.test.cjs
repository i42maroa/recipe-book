const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadService, memoryStorage } = require('./helpers/load-service.cjs');

const id = '67c2c188-5725-471f-8bac-74d81adfad96';
const base = { name: 'Arroz', minutes: 20, servings: 2, pending: true, mealTypes: ['Plato'], rating: null, sourceUrl: '', annotations: '', fitness: false, steps: ['Cocinar'], ingredientIds: ['ingredient'], ingredientAmounts: {}, cuisineTypes: [], photos: [] };
const photo = { id: 'photo-1', storagePath: `${id}/one.jpg`, url: 'https://storage/one.jpg', position: 1, altText: 'Foto de arroz' };
const filters = { search: '', pending: 'all', sort: 'recent', mealType: '', difficulty: '' };

test('ingredient search preserves server ranking, pagination, other filters and cancellation', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const builder = {
    select(value) { assert.ok(value.includes('recipe_ingredients(count)')); return this; },
    returns() { return this; },
    ilike(...args) { calls.push(['ilike', ...args]); return this; },
    eq(...args) { calls.push(['eq', ...args]); return this; },
    contains(...args) { calls.push(['contains', ...args]); return this; },
    abortSignal(value) { assert.equal(value, signal); return this; },
    range(...args) { calls.push(['range', ...args]); return this; },
    order() { assert.fail('The client must preserve the ranking returned by SQL'); },
    then(resolve) { resolve({ data: [], count: 25, error: null }); },
  };
  const client = {
    rpc(name, args, options) { calls.push(['rpc', name, args, options]); return builder; },
    from() { assert.fail('Ingredient filtering must happen on the server before pagination'); },
  };
  const { RecipeService } = loadService('src/app/services/recipe.service.ts', {}, {}, {
    '../../environments/environment': { environment: { supabaseUrl: 'test' } },
    '../utils/search.utils': { MIN_SEARCH_LENGTH: 2 },
  });
  const service = new RecipeService({ configured: true, requireClient: () => client }, {}, {});
  const batch = await service.getBatch({ ...filters, ingredientIds: ['tomato', 'lettuce', 'tomato'], sort: 'rating', search: '100%', pending: 'pending', mealType: 'Plato', difficulty: 'Fácil' }, 20, 10, signal);
  assert.equal(batch.total, 25);
  assert.equal(batch.offset, 20);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['rpc', 'search_recipes_by_ingredients', { p_ingredient_ids: ['tomato', 'lettuce'], p_sort: 'rating' }, { count: 'exact' }],
    ['ilike', 'name', '%100\\%%'], ['eq', 'pending', true], ['contains', 'meal_types', ['Plato']], ['eq', 'difficulty', 'Fácil'], ['range', 20, 29],
  ]);
});
const clone = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

const { LoadingService } = loadService('src/app/services/loading.service.ts', {});
const photoUtils = loadService('src/app/utils/photo-upload.utils.ts', {});

function setup() {
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const { CacheService } = loadService('src/app/services/cache.service.ts', { DOCUMENT: { defaultView: { localStorage: memoryStorage() } } }, { Date: Clock });
  const cache = new CacheService();
  const state = { calls: [], lastPattern: null, lastRatingArgs: null, allowEdit: true, failRate: false, rows: new Map([[id, clone(base)]]), photos: new Map([[id, []]]), nextRead: null, nextBatch: null, nextStats: null, failUpload: false, failStats: false, failSave: false };
  Object.assign(state, { cleanup: new Set(), removedPaths: [], failDelete: false, failPhotoSync: false, lostPhotoReply: false, failCleanup: false });
  const notifications = { errors: [], success() {}, error(message) { this.errors.push(message); } };
  const auth = { canEdit: () => true, requireEditor: async () => { state.calls.push('permission'); if (!state.allowEdit) throw Error('Not allowed'); } };
  function row(recipeId) {
    const recipe = state.rows.get(recipeId);
    return recipe ? { id: recipeId, name: recipe.name, minutes: recipe.minutes, servings: recipe.servings, pending: recipe.pending,
      meal_types: recipe.mealTypes, rating: recipe.rating, source_url: recipe.sourceUrl, annotations: recipe.annotations,
      fitness: recipe.fitness, difficulty: null, recipe_ingredients: recipe.ingredientIds.map((ingredient_id) => ({ ingredient_id, amount_kind: 'none', amount_value: null, amount_unit: null })),
      recipe_steps: recipe.steps.map((description, index) => ({ description, position: index + 1 })), recipe_cuisine_types: [], recipe_photos: clone(state.photos.get(recipeId) ?? []),
    } : null;
  }
  const client = {
    rpc: async (name, args) => {
      state.calls.push(name);
      if (name === 'delete_recipe_with_photos') {
        if (state.failDelete) return { error: Error('Delete rejected') };
        for (const photo of state.photos.get(args.p_id) ?? []) state.cleanup.add(photo.storage_path);
        state.rows.delete(args.p_id); state.photos.delete(args.p_id);
        return { data: args.p_id, error: null };
      }
      if (name === 'sync_recipe_photos') {
        if (state.missingPhotoRpc) return { error: { code: 'PGRST202', message: 'Could not find the function public.sync_recipe_photos in the schema cache' } };
        if (state.failPhotoSync) return { error: Error('Photo transaction rejected') };
        const previous = state.photos.get(args.p_recipe_id) ?? [];
        const retained = new Set(args.p_photos.map(photo => photo.storage_path));
        for (const photo of previous) if (!retained.has(photo.storage_path)) state.cleanup.add(photo.storage_path);
        state.photos.set(args.p_recipe_id, clone(args.p_photos).map((photo, index) => ({ ...photo, id: photo.id ?? `added-photo-${index}` })));
        return state.lostPhotoReply ? { error: Error('Response lost after commit') } : { data: null, error: null };
      }
      if (name === 'get_recipe_stats' && state.nextStats) { const next = state.nextStats; state.nextStats = null; return next(); }
      if (name === 'get_recipe_stats') return state.failStats ? { error: Error('Counters unavailable') } : { data: [{ total: state.rows.size, pending: [...state.rows.values()].filter((recipe) => recipe.pending).length }], error: null };
      if (name === 'rate_recipe') {
        state.lastRatingArgs = clone(args);
        if (state.failRate) return { error: Error('Rate rejected') };
        const recipe = state.rows.get(args.p_id);
        if (!recipe) return { error: Error('Recipe not found') };
        const changed = recipe.pending;
        recipe.rating = args.p_rating;
        recipe.pending = false;
        return { data: [{ id: args.p_id, rating: args.p_rating, pending: false, stats_changed: changed }], error: null };
      }
      assert.equal(name, 'save_recipe_optimized');
      if (state.failSave) return { error: Error('Save rejected') };
      const savedId = args.p_id ?? 'new-recipe';
      const old = state.rows.get(savedId);
      const changed = !old || old.pending !== args.p_recipe.pending;
      state.rows.set(savedId, clone(args.p_recipe));
      return { data: [{ id: savedId, stats_changed: changed }], error: null };
    },
    from: (table) => {
      let recordId, deletion = false, inserts, selection, selectedIds, selectedPaths;
      const builder = {
        select(value) { selection = value; return this; }, eq(_field, value) { recordId = value; return this; }, returns() { return this; },
        in(field, values) { if (field === 'storage_path') { selectedPaths = values; return this; } assert.equal(field, 'id'); selectedIds = values; state.lastCardIds = values; return this; },
        order() { return this; }, range() { return this; }, limit() { return this; },
        ilike(field, pattern) { assert.equal(field, 'name'); state.lastPattern = pattern; return this; },
        delete() { deletion = true; return this; }, insert(values) { inserts = values; return this; },
        maybeSingle() { return run(true); }, then(resolve, reject) { return run(false).then(resolve, reject); },
      };
      async function run(single) {
        state.calls.push(`${table}:${deletion ? 'delete' : inserts ? 'insert' : single ? 'detail' : recordId ? 'read' : 'batch'}`);
        if (table === 'recipe_photo_cleanup') {
          if (deletion) for (const path of selectedPaths ?? []) state.cleanup.delete(path);
          return { data: [...state.cleanup].slice(0, 100).map(storage_path => ({ storage_path })), error: null };
        }
        if (table === 'recipes') {
          if (deletion) {
            const existed = state.rows.delete(recordId);
            return { data: existed ? [{ id: recordId }] : [], error: null };
          }
          if (single && state.nextRead) { const next = state.nextRead; state.nextRead = null; return next(); }
          if (!single && state.nextBatch) { const next = state.nextBatch; state.nextBatch = null; return next(); }
          if (!single) {
            assert.ok(selection.includes('recipe_ingredients(count)'));
            for (const field of ['recipe_steps', 'amount_value', 'annotations', 'source_url']) assert.ok(!selection.includes(field));
          }
          return { data: single ? row(recordId) : [...state.rows.keys()].filter(id => !selectedIds || selectedIds.includes(id)).map((id) => ({ ...row(id), recipe_ingredients: [{ count: state.rows.get(id).ingredientIds.length }] })), count: state.rows.size, error: null };
        }
        assert.equal(table, 'recipe_photos');
        if (selectedPaths) return { data: [...state.photos.values()].flat().filter(photo => selectedPaths.includes(photo.storage_path)), error: null };
        if (deletion) state.photos.set(recordId, []);
        else if (inserts) for (const value of inserts) {
          const previous = state.photos.get(value.recipe_id) ?? [];
          state.photos.set(value.recipe_id, [...previous, { ...value, id: value.id ?? `photo-${previous.length + 1}` }]);
        }
        return { data: clone(state.photos.get(recordId) ?? []), error: null };
      }
      return builder;
    },
    storage: { from: () => ({
      getPublicUrl: (key) => ({ data: { publicUrl: `https://storage/${key}` } }),
      upload: async () => { state.calls.push('storage:upload'); return { error: state.failUpload ? Error('Upload failed') : null }; },
      remove: async (paths) => { state.calls.push('storage:remove'); if (state.failCleanup) return { error: Error('Storage unavailable') }; state.removedPaths.push(...paths); return { error: null }; },
    }) },
  };
  const supabase = { configured: true, requireClient: () => client };
  const { RecipePhotoService } = loadService('src/app/services/recipe-photo.service.ts', { AuthService: auth, NotificationService: notifications }, { crypto: require('node:crypto').webcrypto }, { '../utils/photo-upload.utils': photoUtils });
  const photoService = new RecipePhotoService(supabase);
  const { RecipeService, RecipeSaveError } = loadService('src/app/services/recipe.service.ts', { AuthService: auth, CacheService: cache, LoadingService: new LoadingService() }, {}, {
    '../../environments/environment': { environment: { supabaseUrl: 'https://test.supabase.co', recipeDetailCacheTtlMs: 60000, recipeStatsCacheTtlMs: 60000 } },
    '../utils/search.utils': { MIN_SEARCH_LENGTH: 2 },
    '../utils/ingredient-amount.utils': { mapIngredientAmounts: () => ({}) },
  });
  const service = new RecipeService(supabase, notifications, photoService);
  const { FormService } = loadService('src/app/services/form.service.ts', { AuthService: auth }, {}, { './recipe.service': { RecipeService, RecipeSaveError } });
  const forms = new FormService(service, notifications);
  return { service, photoService, forms, cache, state, row, notifications, advance: (ms) => { now += ms; }, clear: () => { state.calls.length = 0; } };
}

test('a form save with unchanged photos makes 3 calls, reads the detail once and notifies once', async () => {
  const { service, forms, state, clear } = setup();
  const recipe = await service.loadRecipe(id);
  forms.openForm('recipe', recipe);
  let changes = 0; service.changes$.subscribe(() => { changes++; });
  clear();
  await forms.saveRecipe({ ...base, name: 'Arroz actualizado', pending: 'yes', photoFiles: [] });
  assert.deepEqual(state.calls, ['permission', 'save_recipe_optimized', 'recipes:detail']);
  assert.equal(service.getById(id).name, 'Arroz actualizado');
  assert.equal(changes, 2); // Initial BehaviorSubject value + one completed save.
});

test('creating without photos makes 4 calls, including a single aggregate stats request', async () => {
  const { forms, state } = setup();
  forms.openForm('recipe');
  await forms.saveRecipe({ ...base, pending: 'yes', photoFiles: [] });
  assert.deepEqual(state.calls, ['permission', 'save_recipe_optimized', 'recipes:detail', 'get_recipe_stats']);
  assert.equal(state.rows.size, 2);
});

test('cached details are reused across service calls and expiry triggers one shared request', async () => {
  const { service, state, clear, advance } = setup();
  await service.loadRecipe(id); clear();
  await service.loadRecipe(id); assert.equal(state.calls.length, 0);
  advance(60000);
  await Promise.all([service.loadRecipe(id), service.loadRecipe(id)]);
  assert.deepEqual(state.calls, ['recipes:detail']);
});

test('cards contain summary data and never seed the full detail cache', async () => {
  const { service, state, clear } = setup();
  const batch = await service.getBatch(filters);
  assert.equal(batch.items[0].ingredientCount, 1);
  for (const field of ['steps', 'annotations', 'sourceUrl', 'ingredientIds', 'ingredientAmounts']) assert.equal(field in batch.items[0], false);
  assert.equal(service.getById(id), undefined);
  clear();
  const recipe = await service.loadRecipe(id);
  assert.deepEqual(state.calls, ['recipes:detail']);
  assert.equal(recipe.steps[0], 'Cocinar');
});

test('selected recipe IDs load complete listing cards with photos and counts without detail requests', async () => {
  const { service, state, clear } = setup();
  state.rows.set('other-recipe', clone(base));
  state.photos.set(id, [{ id: photo.id, storage_path: photo.storagePath, position: 1, alt_text: 'Foto de arroz' }]);
  clear();
  const cards = await service.getCardsByIds([id, id]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, id);
  assert.equal(cards[0].ingredientCount, 1);
  assert.equal(cards[0].minutes, 20);
  assert.equal(cards[0].servings, 2);
  assert.equal(cards[0].pending, true);
  assert.equal(cards[0].photos[0].url, 'https://storage/' + photo.storagePath);
  assert.equal(state.lastCardIds.length, 1);
  assert.deepEqual(state.calls, ['recipes:batch']);
  assert.equal(service.getById(id), undefined);
  await service.loadRecipe(id);
  assert.equal(state.calls.at(-1), 'recipes:detail');
});

test('empty or deleted card selections do not load unrelated recipes, and failed selections can be retried', async () => {
  const { service, state, clear } = setup();
  clear();
  assert.equal((await service.getCardsByIds([])).length, 0);
  assert.equal(state.calls.length, 0);
  assert.equal((await service.getCardsByIds(['deleted-recipe'])).length, 0);
  state.nextBatch = async () => ({ data: null, error: Error('Offline') });
  await assert.rejects(service.getCardsByIds([id]), /Offline/);
  assert.equal((await service.getCardsByIds([id])).length, 1);
});

test('stats use one aggregate call, cache it and deduplicate concurrent refreshes', async () => {
  const { service, state, clear, advance } = setup();
  await Promise.all([service.loadStats(), service.loadStats()]);
  assert.deepEqual(state.calls, ['get_recipe_stats']); clear();
  await service.loadStats(); assert.equal(state.calls.length, 0);
  advance(60000); await service.loadStats();
  assert.deepEqual(state.calls, ['get_recipe_stats']);
});

test('counter refresh follows the server change flag even when the client snapshot is stale', async () => {
  const { service, state, clear } = setup();
  await service.loadRecipe(id); state.rows.get(id).pending = false; clear();
  await service.update(id, base);
  assert.deepEqual(state.calls, ['permission', 'save_recipe_optimized', 'recipes:detail', 'get_recipe_stats']);
});

test('a response started before a save cannot overwrite the updated recipe cache', async () => {
  const { service, state, row } = setup();
  const outdated = row(id), gate = deferred();
  state.nextRead = () => gate.promise;
  const oldRead = service.loadRecipe(id);
  await service.update(id, { ...base, name: 'Nuevo nombre' });
  gate.resolve({ data: outdated, error: null });
  assert.equal((await oldRead).name, 'Nuevo nombre');
  assert.equal((await service.loadRecipe(id)).name, 'Nuevo nombre');
});

test('a late response cannot resurrect a deleted recipe and deletion does not refetch the detail', async () => {
  const { service, state, row, clear } = setup();
  const outdated = row(id), gate = deferred();
  state.nextRead = () => gate.promise;
  const oldRead = service.loadRecipe(id); clear();
  await service.remove(id);
  gate.resolve({ data: outdated, error: null });
  assert.equal(await oldRead, null);
  assert.equal(service.getById(id), undefined);
  assert.equal(state.calls.filter((call) => call === 'recipes:detail').length, 0);
  assert.equal(state.calls.filter((call) => call === 'get_recipe_stats').length, 1);
});

test('a rejected deletion preserves recipe, photo metadata, files and cache', async () => {
  const { service, state, clear } = setup();
  state.photos.set(id, [{ id: photo.id, storage_path: photo.storagePath, position: 1, alt_text: photo.altText }]);
  await service.loadRecipe(id); clear();
  state.failDelete = true;
  await assert.rejects(service.remove(id), /Delete rejected/);
  assert.equal(state.rows.has(id), true);
  assert.equal(state.photos.get(id).length, 1);
  assert.equal(state.cleanup.size, 0);
  assert.equal(state.removedPaths.length, 0);
  assert.equal(service.getById(id).photos.length, 1);
  assert.deepEqual(state.calls, ['permission', 'delete_recipe_with_photos']);
});

test('deletion commits before file cleanup and cleanup failures remain retryable', async () => {
  const { service, photoService, state, notifications } = setup();
  state.photos.set(id, [{ id: photo.id, storage_path: photo.storagePath, position: 1, alt_text: photo.altText }]);
  state.failCleanup = true;
  await service.remove(id);
  assert.equal(state.rows.has(id), false);
  assert.equal(state.cleanup.has(photo.storagePath), true);
  assert.equal(state.removedPaths.length, 0);
  assert.ok(notifications.errors.some(message => message.includes('receta se ha eliminado')));
  assert.ok(state.calls.indexOf('delete_recipe_with_photos') < state.calls.indexOf('storage:remove'));
  state.failCleanup = false;
  assert.equal(await photoService.cleanupPending(), true);
  assert.deepEqual(state.removedPaths, [photo.storagePath]);
  assert.equal(state.cleanup.size, 0);
});

test('rejected photo transactions leave the original metadata and files intact', async () => {
  const { photoService, state } = setup();
  const original = [{ id: photo.id, storage_path: photo.storagePath, position: 1, alt_text: photo.altText }];
  state.photos.set(id, clone(original)); state.failPhotoSync = true;
  await assert.rejects(photoService.sync(id, [], []), /Photo transaction rejected/);
  assert.deepEqual(state.photos.get(id), original);
  assert.equal(state.removedPaths.length, 0);
  assert.equal(state.calls.includes('recipe_photos:delete'), false);
});

test('losing a photo transaction response never deletes potentially committed uploads', async () => {
  const { photoService, state } = setup();
  state.lostPhotoReply = true;
  const file = new File(['image'], 'image.webp', { type: 'image/webp' });
  await assert.rejects(photoService.sync(id, [], [file]), /Response lost/);
  assert.equal(state.photos.get(id).length, 1);
  assert.equal(state.calls.includes('storage:remove'), false);
});

test('a missing photo migration reports the committed recipe, cleans rejected uploads and retries without duplicates', async () => {
  const { forms, state, notifications } = setup();
  let dialog; forms.dialog$.subscribe(value => { dialog = value; });
  const file = new File(['image'], 'image.webp', { type: 'image/webp' });
  const value = { ...base, pending: 'yes', photos: [], photoFiles: [file] };
  forms.openForm('recipe'); state.missingPhotoRpc = true;
  await forms.saveRecipe(value);
  assert.equal(state.rows.size, 2);
  assert.equal(dialog.recipeToEdit.id, 'new-recipe');
  assert.equal(state.removedPaths.length, 1);
  assert.ok(notifications.errors.some(message => message.includes('La receta ya está guardada.') && message.includes('20261020000300_atomic_recipe_photos.sql')), JSON.stringify(notifications.errors));
  state.missingPhotoRpc = false;
  await forms.saveRecipe(value);
  assert.equal(dialog, null);
  assert.equal(state.rows.size, 2);
  assert.equal(state.photos.get('new-recipe').length, 1);
  assert.equal(state.removedPaths.length, 1);
});

test('photo replacement succeeds even if old file cleanup fails, and retries safely', async () => {
  const { photoService, state } = setup();
  state.photos.set(id, [{ id: photo.id, storage_path: photo.storagePath, position: 1, alt_text: photo.altText }]);
  state.failCleanup = true;
  await photoService.sync(id, [], []);
  assert.deepEqual(state.photos.get(id), []);
  assert.equal(state.cleanup.has(photo.storagePath), true);
  state.failCleanup = false;
  assert.equal(await photoService.cleanupPending(), true);
  assert.equal(state.cleanup.size, 0);
});

test('cleanup protects referenced files and shares concurrent cleanup requests', async () => {
  const { photoService, state } = setup();
  state.photos.set(id, [{ storage_path: photo.storagePath }]);
  state.cleanup.add(photo.storagePath);
  const first = photoService.cleanupPending(), second = photoService.cleanupPending();
  assert.equal(first, second);
  assert.equal(await first, false);
  assert.equal(state.removedPaths.length, 0);
  assert.equal(state.cleanup.has(photo.storagePath), true);
});

test('a stale list response cannot overwrite the detail cached by a completed save', async () => {
  const { service, state, row } = setup();
  const outdated = row(id), gate = deferred();
  state.nextBatch = () => gate.promise;
  const listing = service.getBatch(filters);
  await service.update(id, { ...base, name: 'Actualizado' });
  gate.resolve({ data: [outdated], count: 1, error: null });
  await listing;
  assert.equal((await service.loadRecipe(id)).name, 'Actualizado');
});

test('old in-flight counters cannot replace counters refreshed after a creation', async () => {
  const { service, state } = setup();
  const gate = deferred();
  state.nextStats = () => gate.promise;
  let stats; service.stats$.subscribe((value) => { stats = value; });
  const oldStats = service.loadStats();
  await service.create(base);
  assert.equal(stats.total, 2);
  gate.resolve({ data: [{ total: 1, pending: 1 }], error: null });
  await oldStats;
  assert.equal(stats.total, 2);
  assert.equal(state.calls.filter((call) => call === 'get_recipe_stats').length, 2);
});

test('a rejected save leaves the previously loaded detail intact and does not refresh counters', async () => {
  const { service, state, clear } = setup();
  await service.loadRecipe(id); clear();
  state.failSave = true;
  await assert.rejects(service.update(id, { ...base, name: 'Rejected' }));
  assert.equal((await service.loadRecipe(id)).name, base.name);
  assert.deepEqual(state.calls, ['permission', 'save_recipe_optimized']);
});

test('unchanged existing photos skip both permission and photo requests', async () => {
  const { photoService, state } = setup();
  await photoService.sync(id, [photo], [], base.name, [photo]);
  assert.equal(state.calls.length, 0);
});

test('changing photo order still updates metadata and performs just one final detail read', async () => {
  const { service, state, clear } = setup();
  const second = { ...photo, id: 'photo-2', storagePath: `${id}/two.jpg`, position: 2 };
  state.photos.set(id, [photo, second].map((item) => ({ id: item.id, storage_path: item.storagePath, position: item.position, alt_text: item.altText })));
  await service.loadRecipe(id); clear();
  await service.update(id, base, { originalPhotos: [photo, second], retainedPhotos: [second, photo], files: [] });
  assert.equal(state.calls.filter((call) => call === 'recipes:detail').length, 1);
  assert.equal(state.calls.filter((call) => call === 'sync_recipe_photos').length, 1);
  assert.equal(service.getById(id).photos[0].id, 'photo-2');
});

test('failed photo upload preserves a newly saved ID and retries as an edit without duplicating recipes', async () => {
  const { forms, state } = setup();
  let dialog; forms.dialog$.subscribe((value) => { dialog = value; });
  forms.openForm('recipe');
  const value = { ...base, pending: 'yes', photoFiles: [{ name: 'one.jpg', type: 'image/jpeg' }] };
  state.failUpload = true;
  await forms.saveRecipe(value);
  assert.equal(dialog.recipeToEdit.id, 'new-recipe');
  assert.equal(state.rows.size, 2);
  state.failUpload = false;
  await forms.saveRecipe(value);
  assert.equal(dialog, null);
  assert.equal(state.rows.size, 2);
});

test('adding a photo repairs gaps in the positions instead of colliding with an existing position', async () => {
  const { service, state } = setup();
  const second = { ...photo, id: 'photo-2', storagePath: `${id}/two.jpg`, position: 3 };
  state.photos.set(id, [photo, second].map((item) => ({ id: item.id, storage_path: item.storagePath, position: item.position, alt_text: item.altText })));
  await service.update(id, base, { originalPhotos: [photo, second], retainedPhotos: [photo, second], files: [{ name: 'new.jpg', type: 'image/jpeg' }] });
  assert.deepEqual(state.photos.get(id).map((item) => item.position), [1, 2, 3]);
});

test('failed counter refresh does not report the committed recipe as a failed save', async () => {
  const { service, state, notifications } = setup();
  state.failStats = true;
  assert.equal(await service.create(base), 'new-recipe');
  assert.equal(state.rows.size, 2);
  assert.equal(notifications.errors.length, 1);
  state.failStats = false;
  await service.loadStats();
});


test('repeated saves while a request is pending submit just one write and cannot close the form', async () => {
  const { forms, service, state } = setup();
  forms.openForm('recipe', await service.loadRecipe(id));
  let dialog; forms.dialog$.subscribe((value) => { dialog = value; });
  const gate = deferred(); state.nextRead = () => gate.promise;
  const value = { ...base, pending: 'yes', photoFiles: [] };
  const first = forms.saveRecipe(value);
  await forms.saveRecipe(value);
  forms.close();
  assert.equal(forms.saving(), true);
  assert.ok(dialog);
  while (!state.calls.includes('save_recipe_optimized')) await Promise.resolve();
  gate.resolve({ data: null, error: null });
  await first;
  assert.equal(forms.saving(), false);
  assert.equal(dialog, null);
  assert.equal(state.calls.filter((call) => call === 'save_recipe_optimized').length, 1);
});

test('the in-memory full-detail cache is bounded independently of list results', async () => {
  const { service, state } = setup();
  for (let i = 0; i < 45; i++) {
    const key = 'recipe-' + i;
    state.rows.set(key, clone(base));
    await service.loadRecipe(key);
  }
  let recipes; service.recipes$.subscribe((value) => { recipes = value; }).unsubscribe();
  assert.equal(recipes.length, 40);
  assert.equal(service.getById('recipe-0'), undefined);
  assert.ok(service.getById('recipe-44'));
});

test('name search uses one recipe request and escapes LIKE metacharacters', async () => {
  const { service, state } = setup();
  await service.getBatch({ ...filters, search: '  arroz_%\\  ' });
  assert.deepEqual(state.calls, ['recipes:batch']);
  assert.equal(state.lastPattern, '%arroz\\_\\%\\\\%');
});

test('rating patches only rating and pending, without detail reads or photo writes', async () => {
  const { service, state, clear } = setup();
  state.rows.get(id).pending = false;
  await service.loadRecipe(id); clear();
  await service.rate(id, 8);
  assert.deepEqual(state.calls, ['permission', 'rate_recipe']);
  assert.deepEqual(state.lastRatingArgs, { p_id: id, p_rating: 8 });
  assert.equal(state.rows.get(id).name, base.name);
  assert.deepEqual(state.rows.get(id).steps, base.steps);
  assert.deepEqual(state.rows.get(id).ingredientIds, base.ingredientIds);
  assert.equal(service.getById(id).rating, 8);
  assert.equal(service.getById(id).pending, false);
});

test('rating a pending recipe refreshes counters once and does not persist stale detail fields', async () => {
  const { service, state, clear } = setup();
  await service.loadRecipe(id); clear();
  state.rows.get(id).name = 'Changed by another editor';
  await service.rate(id, 9);
  assert.deepEqual(state.calls, ['permission', 'rate_recipe', 'get_recipe_stats']);
  assert.equal(state.rows.get(id).name, 'Changed by another editor');
  clear();
  assert.equal((await service.loadRecipe(id)).name, 'Changed by another editor');
  assert.deepEqual(state.calls, ['recipes:detail']);
});

test('invalid ratings, revoked access, missing recipes and rejected writes cannot update cached data', async () => {
  const { service, state, clear } = setup();
  await service.loadRecipe(id); clear();
  for (const value of [0, 11, 1.5, null, NaN]) await assert.rejects(service.rate(id, value));
  assert.deepEqual(state.calls, []);
  state.allowEdit = false;
  await assert.rejects(service.rate(id, 7));
  assert.deepEqual(state.calls, ['permission']);
  state.allowEdit = true; state.failRate = true;
  await assert.rejects(service.rate(id, 7));
  assert.equal(service.getById(id).rating, null);
  assert.equal(service.getById(id).pending, true);
  state.failRate = false;
  await assert.rejects(service.rate('missing', 7));
});

test('a detail request started before rating cannot overwrite the new rating', async () => {
  const { service, state, row } = setup();
  const old = row(id), gate = deferred();
  state.nextRead = () => gate.promise;
  const pending = service.loadRecipe(id);
  await service.rate(id, 10);
  gate.resolve({ data: old, error: null });
  assert.equal((await pending).rating, 10);
  assert.equal(service.getById(id).rating, 10);
});
