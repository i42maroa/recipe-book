// Isolated PostgreSQL/WASM checks. See OPTIMIZACION.md for the temporary test dependency.
const assert = require('node:assert/strict');
const { test, before, beforeEach, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.resolve('.angular/sql-validation/node_modules/@electric-sql/pglite'));
const id = '11111111-1111-4111-8111-111111111111';
const first = { id: '22222222-2222-4222-8222-222222222222', storage_path: `${id}/first.webp`, position: 1, alt_text: 'Primera' };
const second = { id: '33333333-3333-4333-8333-333333333333', storage_path: `${id}/second.webp`, position: 2, alt_text: 'Segunda' };
let db;
const read = file => fs.readFileSync(path.resolve(file), 'utf8');
const rows = async sql => (await db.query(sql)).rows;
const current = () => rows('select id,storage_path,position,alt_text from public.recipe_photos order by position');
const sync = (expected, photos) => db.query('select public.sync_recipe_photos($1,$2::jsonb,$3::jsonb)', [id, JSON.stringify(expected), JSON.stringify(photos)]);

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    create function public.is_recipe_editor() returns boolean language sql stable as $$ select current_setting('test.editor', true) = 'true' $$;
  `);
  // Use the repository's actual table definitions and the actual new migration.
  const initial = read('supabase/migrations/20261015000100_initial_schema.sql').split('create or replace function public.save_recipe')[0].replace('create extension if not exists pgcrypto;', '');
  const photos = read('supabase/migrations/20261016000100_recipe_photos.sql').split('alter table public.recipe_photos enable row level security')[0];
  await db.exec(initial + photos);
  await db.exec(`
    alter table public.recipes enable row level security;
    alter table public.recipe_photos enable row level security;
    grant select on public.recipes,public.recipe_photos to anon,authenticated;
    grant insert,update,delete on public.recipes,public.recipe_photos to authenticated;
    create policy public_read on public.recipes for select using (true);
    create policy public_read on public.recipe_photos for select using (true);
    create policy editor_write on public.recipes for all to authenticated using (public.is_recipe_editor()) with check (public.is_recipe_editor());
    create policy editor_write on public.recipe_photos for all to authenticated using (public.is_recipe_editor()) with check (public.is_recipe_editor());
  `);
  await db.exec(read('supabase/migrations/20261020000300_atomic_recipe_photos.sql'));
});
beforeEach(async () => {
  await db.exec(`reset role; set test.editor = 'true'; set request.jwt.claim.sub = '${id}'; truncate public.recipes cascade; truncate public.recipe_photo_cleanup;`);
  await db.query('insert into public.recipes(id,name,pending) values ($1,$2,false)', [id, 'Receta de prueba']);
  for (const photo of [first, second]) await db.query('insert into public.recipe_photos(id,recipe_id,storage_path,position,alt_text) values ($1,$2,$3,$4,$5)', [photo.id, id, photo.storage_path, photo.position, photo.alt_text]);
});
after(async () => { await db?.close(); });

test('photo reorder commits all metadata together and preserves IDs', async () => {
  await db.exec('set role authenticated');
  await sync([first, second], [{ ...second, position: 1 }, { ...first, position: 2 }]);
  assert.deepEqual(await current(), [{ ...second, position: 1 }, { ...first, position: 2 }]);
  assert.equal((await rows('select * from public.recipe_photo_cleanup')).length, 0);
});

test('failed replacement rolls back metadata deletion and cleanup jobs', async () => {
  const replacement = [{ storage_path: `${id}/new.webp`, position: 1 }, { storage_path: `${id}/other.webp`, position: 1 }];
  await assert.rejects(sync([first, second], replacement), error => error.code === '23505');
  assert.deepEqual(await current(), [first, second]);
  assert.equal((await rows('select * from public.recipe_photo_cleanup')).length, 0);
});

test('stale photo snapshots cannot overwrite a newer version', async () => {
  await assert.rejects(sync([], [first]), error => error.code === '40001');
  assert.deepEqual(await current(), [first, second]);
});

test('removed photos are queued, retained photos remain referenced', async () => {
  await sync([first, second], [first]);
  assert.deepEqual(await current(), [first]);
  assert.deepEqual(await rows('select storage_path from public.recipe_photo_cleanup'), [{ storage_path: second.storage_path }]);
});

test('recipe deletion atomically removes metadata and records files for later cleanup', async () => {
  await db.exec('set role authenticated');
  assert.equal((await db.query('select public.delete_recipe_with_photos($1) as id', [id])).rows[0].id, id);
  assert.equal((await rows('select * from public.recipes')).length, 0);
  assert.equal((await current()).length, 0);
  assert.deepEqual((await rows('select storage_path from public.recipe_photo_cleanup order by storage_path')).map(row => row.storage_path), [first.storage_path, second.storage_path]);
  // Retry after a possibly lost response without duplicating cleanup jobs.
  assert.equal((await db.query('select public.delete_recipe_with_photos($1) as id', [id])).rows[0].id, id);
  assert.equal((await rows('select * from public.recipe_photo_cleanup')).length, 2);
});

test('failed recipe deletion rolls back cleanup jobs and preserves every photo', async () => {
  await db.exec(`create function public.reject_test_deletion() returns trigger language plpgsql as $$ begin raise exception 'Test deletion rejected'; end $$;
    create trigger reject_test_deletion before delete on public.recipes for each row execute function public.reject_test_deletion();`);
  try {
    await assert.rejects(db.query('select public.delete_recipe_with_photos($1)', [id]), /Test deletion rejected/);
    assert.equal((await rows('select * from public.recipes')).length, 1);
    assert.deepEqual(await current(), [first, second]);
    assert.equal((await rows('select * from public.recipe_photo_cleanup')).length, 0);
  } finally { await db.exec('drop trigger reject_test_deletion on public.recipes; drop function public.reject_test_deletion();'); }
});

test('anonymous and non-editor callers cannot mutate photos or access cleanup jobs', async () => {
  await db.exec('set role anon');
  await assert.rejects(sync([first, second], []), error => error.code === '42501');
  await assert.rejects(rows('select * from public.recipe_photo_cleanup'), error => error.code === '42501');
  await db.exec("reset role; set test.editor = 'false'; set role authenticated;");
  await assert.rejects(sync([first, second], []), error => error.code === '42501');
  await assert.rejects(db.query('select public.delete_recipe_with_photos($1)', [id]), error => error.code === '42501');
  assert.deepEqual(await current(), [first, second]);
});

test('paths outside this recipe and IDs pointing to another file are rejected', async () => {
  await assert.rejects(sync([first, second], [{ ...first, storage_path: 'other/file.webp' }]), error => error.code === '22023');
  await assert.rejects(sync([first, second], [{ ...first, storage_path: `${id}/different.webp` }]), error => error.code === '40001');
  assert.deepEqual(await current(), [first, second]);
});

test('files queued for cleanup cannot be referenced again by a stale edit', async () => {
  await sync([first, second], [first]);
  await assert.rejects(sync([first], [{ storage_path: second.storage_path, position: 1 }]), error => error.code === '40001');
  assert.deepEqual(await current(), [first]);
});
