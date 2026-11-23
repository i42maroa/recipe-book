const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');

const migration = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8');
const owner = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const outsider = '00000000-0000-0000-0000-000000000003';
const recipeId = '00000000-0000-0000-0000-000000000004';
const date = '2026-11-23';
const meal = { slot: 'lunch', servings: 2, recipes: [{ recipeId, mode: 'scale' }] };

test('MCP SQL executes in PostgreSQL: permissions, day replacement, conflicts, rollback, inventory and OAuth hook', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role supabase_auth_admin;
      create schema auth;
      create schema private;
      revoke all on schema private from public,anon,authenticated;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
      $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      create table private.recipe_editors(user_id uuid primary key);
      insert into private.recipe_editors values ('${owner}'),('${other}');
      create function public.is_recipe_editor() returns boolean language sql stable security definer set search_path='' as $$
        select exists(select 1 from private.recipe_editors where user_id=auth.uid());
      $$;
      create table public.recipes(id uuid primary key);
      insert into public.recipes values('${recipeId}');
      grant select on public.recipes to authenticated;
      create table public.inventory_entries(id uuid,owner_id uuid,place_id uuid,entry jsonb);
      grant select on public.inventory_entries to authenticated;
    `);
    const inventorySql = migration('20261027000400_inventory_planning.sql');
    for (const signature of ['create function public.valid_scheduled_inventory_source',
      'create or replace function public.valid_scheduled_recipes', 'create or replace function public.save_scheduled_day']) {
      const start = inventorySql.indexOf(signature);
      assert.ok(start >= 0);
      await db.exec(inventorySql.slice(start, inventorySql.indexOf('$$;', start) + 3));
    }
    await db.exec(`
      create table public.scheduled_meals(owner_id uuid,meal_date date,slot text,servings integer,recipes jsonb,
        primary key(owner_id,meal_date,slot));
      alter table public.scheduled_meals enable row level security;
      grant select,insert,update,delete on public.scheduled_meals to authenticated;
      create policy owner_only on public.scheduled_meals for all to authenticated
        using(owner_id=auth.uid() and public.is_recipe_editor())
        with check(owner_id=auth.uid() and public.is_recipe_editor());
    `);
    await db.exec(migration('20261123000100_mcp_daily_planning.sql'));
    await db.exec(migration('20261123000200_mcp_oauth.sql'));
    const asUser = async id => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
      await db.exec('set role authenticated');
    };
    const read = async () => (await db.query('select public.get_mcp_scheduled_day($1::date) as day', [date])).rows[0].day;
    const save = (meals, version) => db.query('select public.save_mcp_scheduled_day($1::date,$2::jsonb,$3)', [date, JSON.stringify(meals), version]);

    await t.test('unauthenticated and non-editor accounts cannot read or write plans', async () => {
      await db.exec('set role anon');
      await assert.rejects(read(), /permission denied/);
      await asUser(outsider);
      await assert.rejects(read(), /sesión autorizada/);
      await assert.rejects(save([], 'a'.repeat(32)), /sesión autorizada/);
    });
    await t.test('a day saves atomically and rejects an obsolete version', async () => {
      await asUser(owner);
      const empty = await read();
      assert.deepEqual(empty.meals, []);
      assert.match(empty.version, /^[0-9a-f]{32}$/);
      await save([meal], empty.version);
      const saved = await read();
      assert.deepEqual(saved.meals, [meal]);
      assert.notEqual(saved.version, empty.version);
      await assert.rejects(save([], empty.version), /día ha cambiado/);
      assert.deepEqual((await read()).meals, [meal]);
    });
    await t.test('another user cannot read or overwrite the first user plan', async () => {
      await asUser(other);
      const empty = await read();
      assert.deepEqual(empty.meals, []);
      await save([{ ...meal, slot: 'dinner' }], empty.version);
      await asUser(owner);
      assert.deepEqual((await read()).meals, [meal]);
    });
    await t.test('validation failures roll back and missing recipe IDs are rejected', async () => {
      const before = await read();
      await assert.rejects(save([{ ...meal, servings: 0 }], before.version), /no válidos/);
      await assert.rejects(save([{ ...meal, recipes: [{ recipeId: outsider, mode: 'scale' }] }], before.version), /ya no existe/);
      assert.deepEqual(await read(), before);
      await save([], before.version);
      assert.deepEqual((await read()).meals, []);
    });
    await t.test('the MCP cannot remove an existing inventory association', async () => {
      await db.exec('reset role');
      await db.query('insert into public.scheduled_meals values($1,$2,$3,$4,$5)', [owner, date, 'lunch', 2,
        JSON.stringify([{ recipeId, mode: 'scale', inventory: { placeId: owner, itemId: other, placeName: 'Casa', space: 'freezer' } }])]);
      await asUser(owner);
      const before = await read();
      await assert.rejects(save([], before.version), /inventario/);
      assert.deepEqual(await read(), before);
    });
    await t.test('OAuth clients receive a resource audience; direct sessions keep their claims', async () => {
      await db.exec('reset role');
      await db.query('insert into private.mcp_oauth_clients values($1,$2)', ['chatgpt-client', 'https://laurel.example.com/mcp']);
      await db.exec('set role supabase_auth_admin');
      const hook = async event => (await db.query('select public.laurel_mcp_access_token_hook($1) as event', [JSON.stringify(event)])).rows[0].event;
      const base = { claims: { aud: 'authenticated', sub: owner, role: 'authenticated' } };
      assert.deepEqual(await hook(base), base);
      assert.deepEqual(await hook({ ...base, client_id: 'unregistered' }), { ...base, client_id: 'unregistered' });
      const oauth = await hook({ ...base, client_id: 'chatgpt-client' });
      assert.deepEqual(oauth.claims.aud, ['authenticated', 'https://laurel.example.com/mcp']);
      assert.equal(oauth.claims.client_id, 'chatgpt-client');
      assert.equal(oauth.claims.scope, 'openid');
      await asUser(owner);
      await assert.rejects(hook(base), /permission denied/);
      await assert.rejects(db.query('select * from private.mcp_oauth_clients'), /permission denied/);
    });
  } finally { await db.close(); }
});
