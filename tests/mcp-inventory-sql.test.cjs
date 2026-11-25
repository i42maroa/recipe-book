const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { LaurelService } = require('../out-tsc/mcp/server/mcp/service.js');
const { manageInventoryIngredientSchema } = require('../out-tsc/mcp/server/mcp/schemas.js');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const placeId = '33333333-3333-4333-8333-333333333333';
const itemId = '44444444-4444-4444-8444-444444444444';
const ingredientId = '55555555-5555-4555-8555-555555555555';
const freeId = '66666666-6666-4666-8666-666666666666';
const preparedId = '77777777-7777-4777-8777-777777777777';
const addedId = '88888888-8888-4888-8888-888888888888';
const config = { siteUrl: 'https://laurel.example.com' };
const entry = { id: itemId, ingredientId, name: 'Tomate guardado', category: 'Verdura',
  amount: { kind: 'specific', value: 2, unit: 'pieza', baseUnit: 'g', unitQuantity: 150 },
  space: 'pantry', enteredOn: '2026-11-20', arrivedOn: '2026-11-20', recipeId: null, servings: null };
const free = { ...entry, id: freeId, ingredientId: null, category: null, name: 'Producto libre', amount: null };
const prepared = { ...free, id: preparedId, name: 'Receta preparada', recipeId: preparedId, servings: 2 };
const migration = name => fs.readFileSync(`supabase/migrations/${name}.sql`, 'utf8');

test('MCP inventory tools use the production SQL for row changes, conflicts, retries and private access', async t => {
  const db = new PGlite();
  const state = { beforeApply: null, loseNextResponse: false, applies: 0 };
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      insert into auth.users values('${owner}'),('${other}');
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated;
      create function public.is_recipe_editor() returns boolean language sql stable as $$
        select coalesce(current_setting('test.editor',true),'false')='true' $$;`);
    await db.exec(migration('20261015000100_initial_schema').replace('create extension if not exists pgcrypto;', ''));
    for (const name of ['20261026000100_freezer_inventories', '20261026000200_freezer_entries',
      '20261027000100_inventory_places', '20261027000200_ingredient_measures', '20261027000300_inventory_empty_amounts']) {
      await db.exec(migration(name));
    }
    await db.exec(`drop policy anon_all on public.ingredients;
      create policy catalog_read on public.ingredients for select to authenticated using (true);
      grant select on public.ingredients to authenticated;`);
    const client = {
      async rpc(name, args) {
        try {
          let data;
          if (name === 'is_recipe_editor') data = (await db.query('select public.is_recipe_editor() as value')).rows[0].value;
          else if (name === 'get_inventory') data = (await db.query('select public.get_inventory() as value')).rows[0].value;
          else if (name === 'apply_inventory_changes') {
            state.applies++;
            if (state.beforeApply) { const effect = state.beforeApply; state.beforeApply = null; await effect(); }
            data = (await db.query('select public.apply_inventory_changes($1::jsonb) as value', [JSON.stringify(args.p_changes)])).rows[0].value;
            if (state.loseNextResponse) { state.loseNextResponse = false; return { data: null, error: { code: 'NETWORK', message: 'private transport error' } }; }
          } else throw Error('Unexpected RPC');
          return { data, error: null };
        } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
      },
      from(table) {
        assert.equal(table, 'ingredients');
        let id;
        const builder = {
          select() { return builder; },
          eq(column, value) { assert.equal(column, 'id'); id = value; return builder; },
          async maybeSingle() {
            return { data: (await db.query('select id,name,category,base_unit,unit_quantity from public.ingredients where id=$1', [id])).rows[0] ?? null, error: null };
          },
        };
        return builder;
      },
    };
    const service = new LaurelService(client, config, owner);
    const raw = async () => (await db.query('select public.get_inventory() as value')).rows[0].value;
    const version = async () => (await service.getInventory()).places[0].items.find(item => item.id === itemId).version;
    const manage = input => service.manageInventoryIngredient(manageInventoryIngredientSchema.parse(input));
    const apply = changes => db.query('select public.apply_inventory_changes($1::jsonb)', [JSON.stringify(changes)]);
    const change = (before, after) => ({ placeId, itemId: (before ?? after).id, before, after });
    const addition = { action: 'add', placeId, itemId: addedId, ingredientId, space: 'freezer', enteredOn: '2026-11-25',
      amount: { kind: 'specific', value: 300, unit: 'g' } };
    const seed = async () => {
      state.beforeApply = null; state.loseNextResponse = false; state.applies = 0;
      await db.exec(`reset role; truncate public.inventory_places cascade; truncate public.ingredients cascade;
        insert into public.ingredients(id,name,category,base_unit,unit_quantity) values('${ingredientId}','Tomate','Verdura','g',150);
        set test.editor='true'; set request.jwt.claim.sub='${owner}'; set role authenticated;`);
      await apply([{ placeId, itemId: null, before: null, after: { name: 'Casa' } },
        change(null, entry), change(null, free), change(null, prepared)]);
    };
    const scenario = (name, run) => t.test(name, async () => { await seed(); await run(); });

    await scenario('reading includes row versions and distinguishes supported ingredients from other stock', async () => {
      const inventory = await service.getInventory();
      assert.equal(inventory.places[0].name, 'Casa');
      assert.deepEqual(inventory.places[0].items.map(item => item.editableIngredient), [true, false, false]);
      assert.ok(inventory.places[0].items.every(item => /^[0-9a-f]{64}$/.test(item.version)));
      assert.equal(state.applies, 0);
    });
    await scenario('adding uses real catalogue snapshots and a stable item ID without touching existing rows', async () => {
      const before = (await db.query('select id,xmin::text,position from public.inventory_entries order by id')).rows;
      const added = await manage(addition);
      assert.equal(added.saved, true);
      const after = await raw();
      const stored = after[0].items.find(item => item.id === addedId);
      assert.deepEqual(stored, { id: addedId, ingredientId, name: 'Tomate', category: 'Verdura', recipeId: null,
        servings: null, space: 'freezer', enteredOn: '2026-11-25', arrivedOn: '2026-11-25', amount: addition.amount });
      assert.deepEqual((await db.query('select id,xmin::text,position from public.inventory_entries where id<>$1 order by id', [addedId])).rows, before);
      assert.equal((await manage(addition)).alreadyPresent, true);
      assert.equal(state.applies, 1);
      await assert.rejects(manage({ ...addition, amount: { kind: 'specific', value: 500, unit: 'g' } }), error => error.code === 'CONFLICT');
      assert.equal((await raw())[0].items.length, 4);
    });
    await scenario('updates preserve names, dates, other rows and stored unit equivalents after catalogue changes', async () => {
      const expectedVersion = await version();
      await db.exec(`reset role; update public.ingredients set unit_quantity=300,name='Tomate nuevo' where id='${ingredientId}'; set role authenticated;`);
      await manage({ action: 'update', placeId, itemId, expectedVersion, amount: { kind: 'specific', value: 1, unit: 'pieza' } });
      let stored = (await raw())[0].items.find(item => item.id === itemId);
      assert.deepEqual(stored, { ...entry, amount: { ...entry.amount, value: 1 } });
      await manage({ action: 'update', placeId, itemId, expectedVersion: await version(), space: 'freezer', arrivedOn: '2026-11-25' });
      stored = (await raw())[0].items.find(item => item.id === itemId);
      assert.equal(stored.space, 'freezer');
      assert.equal(stored.arrivedOn, '2026-11-25');
      assert.equal(stored.enteredOn, '2026-11-20');
      await manage({ action: 'update', placeId, itemId, expectedVersion: await version(), amount: null });
      assert.equal((await raw())[0].items.find(item => item.id === itemId).amount, null);
      assert.deepEqual((await raw())[0].items.filter(item => item.id !== itemId), [free, prepared]);
    });
    await scenario('new pieces capture catalogue equivalents and new spices/liquids use their allowed units', async () => {
      await manage({ ...addition, amount: { kind: 'specific', value: 3, unit: 'pieza' } });
      assert.deepEqual((await raw())[0].items.find(item => item.id === addedId).amount,
        { kind: 'specific', value: 3, unit: 'pieza', baseUnit: 'g', unitQuantity: 150 });
      await db.exec(`reset role; insert into public.ingredients(id,name,category,base_unit,unit_quantity) values
        ('${other}','Pimienta','Especia','g',null),('${preparedId}','Leche','Lacteo','ml',1000); set role authenticated;`);
      await manage({ ...addition, itemId: other, ingredientId: other, amount: { kind: 'spoon', value: 0.5 } });
      await manage({ ...addition, itemId: owner, ingredientId: preparedId, amount: { kind: 'specific', value: 250, unit: 'ml' } });
      assert.deepEqual((await raw())[0].items.find(item => item.id === other).amount, { kind: 'spoon', value: 0.5 });
      assert.deepEqual((await raw())[0].items.find(item => item.id === owner).amount, { kind: 'specific', value: 250, unit: 'ml' });
    });
    await scenario('removing a lot preserves the catalogue and supports a repeated removal without touching other stock', async () => {
      const input = { action: 'remove', placeId, itemId, expectedVersion: await version() };
      await manage(input);
      assert.equal((await manage(input)).alreadyAbsent, true);
      assert.equal(state.applies, 1);
      assert.deepEqual((await raw())[0].items, [free, prepared]);
      assert.equal((await db.query('select count(*)::int as n from public.ingredients')).rows[0].n, 1);
    });
    await scenario('stale client versions and changes racing after the read cannot overwrite newer stock', async () => {
      const expectedVersion = await version();
      const newer = { ...entry, amount: { ...entry.amount, value: 1 } };
      await apply([change(entry, newer)]);
      await assert.rejects(manage({ action: 'remove', placeId, itemId, expectedVersion }), error => error.code === 'CONFLICT');
      const latestVersion = await version();
      const raced = { ...newer, amount: { ...newer.amount, value: 0.5 } };
      state.beforeApply = () => apply([change(newer, raced)]);
      await assert.rejects(manage({ action: 'update', placeId, itemId, expectedVersion: latestVersion, amount: null }), error => error.code === 'CONFLICT');
      assert.deepEqual((await raw())[0].items, [raced, free, prepared]);
    });
    await scenario('a committed add with a lost response is not duplicated when retried with the same ID', async () => {
      state.loseNextResponse = true;
      await assert.rejects(manage(addition), error => error.code === 'DATABASE_ERROR');
      assert.equal((await manage(addition)).alreadyPresent, true);
      assert.equal((await raw())[0].items.filter(item => item.id === addedId).length, 1);
      assert.equal(state.applies, 1);
    });
    await scenario('invalid measures, dates, missing catalogue IDs and unsupported entries never write', async () => {
      const before = await raw();
      for (const amount of [{ kind: 'spoon', value: 1 }, { kind: 'specific', value: 1, unit: 'ml' }]) {
        await assert.rejects(manage({ ...addition, amount }), error => error.code === 'VALIDATION');
      }
      await assert.rejects(manage({ ...addition, ingredientId: other }), error => error.code === 'NOT_FOUND');
      await assert.rejects(manage({ ...addition, placeId: other }), error => error.code === 'NOT_FOUND');
      await assert.rejects(manage({ action: 'update', placeId, itemId, expectedVersion: await version(), enteredOn: '2026-11-25' }), error => error.code === 'VALIDATION');
      for (const id of [freeId, preparedId]) {
        const item = (await service.getInventory()).places[0].items.find(value => value.id === id);
        await assert.rejects(manage({ action: 'remove', placeId, itemId: id, expectedVersion: item.version }), error => error.code === 'VALIDATION');
      }
      assert.equal(state.applies, 0);
      assert.deepEqual(await raw(), before);
    });
    await scenario('RLS isolates accounts and non-editors cannot read or mutate inventory', async () => {
      const expectedVersion = await version();
      await db.exec(`set request.jwt.claim.sub='${other}'`);
      const otherService = new LaurelService(client, config, other);
      assert.deepEqual(await otherService.getInventory(), { places: [] });
      await assert.rejects(otherService.manageInventoryIngredient({ action: 'remove', placeId, itemId, expectedVersion }), error => error.code === 'NOT_FOUND');
      await db.exec(`set request.jwt.claim.sub='${owner}'; set test.editor='false';`);
      await assert.rejects(service.getInventory(), error => error.code === 'FORBIDDEN');
      await assert.rejects(manage(addition), error => error.code === 'FORBIDDEN');
      await assert.rejects(new LaurelService(client, config).getInventory(), error => error.code === 'UNAUTHENTICATED');
      await db.exec("set test.editor='true'");
      assert.deepEqual((await raw())[0].items, [entry, free, prepared]);
      assert.equal(state.applies, 0);
    });
    await scenario('unrelated edits and deletion still work when the catalogue ingredient has disappeared', async () => {
      await db.exec('reset role');
      await db.query('delete from public.ingredients where id=$1', [ingredientId]);
      await db.exec('set role authenticated');
      await manage({ action: 'update', placeId, itemId, expectedVersion: await version(), arrivedOn: '2026-11-25' });
      await manage({ action: 'remove', placeId, itemId, expectedVersion: await version() });
      assert.deepEqual((await raw())[0].items, [free, prepared]);
    });
  } finally { await db.close(); }
});
