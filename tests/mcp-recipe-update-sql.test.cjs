const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const read = name => fs.readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
const rid = '11111111-1111-4111-8111-111111111111';
const tomato = '22222222-2222-4222-8222-222222222222';
const spice = '33333333-3333-4333-8333-333333333333';
const milk = '44444444-4444-4444-8444-444444444444';
const other = '55555555-5555-4555-8555-555555555555';
const base = { name: 'Receta anterior', minutes: 30, servings: 4, pending: true, mealTypes: ['Plato'],
  rating: null, sourceUrl: 'https://example.com/recipe', annotations: 'Conservar', fitness: true, difficulty: 'Media',
  ingredientIds: [tomato, spice, milk], ingredientAmounts: {
    [tomato]: { kind: 'specific', value: 1, unit: 'pieza' }, [spice]: { kind: 'spoon', value: 1 },
  }, steps: ['Preparar', 'Servir'], cuisineTypes: ['Española'] };

test('MCP recipe updates execute the actual SQL with version checks, RLS and measured saves', async t => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated;
      create function public.is_recipe_editor() returns boolean language sql stable as $$
        select coalesce(current_setting('test.editor',true),'false')='true' $$;`);
    await db.exec(read('20261015000100_initial_schema').replace('create extension if not exists pgcrypto;', ''));
    const measures = read('20261027000200_ingredient_measures');
    await db.exec(measures.slice(0, measures.indexOf('create function public.save_ingredient')));
    const start = measures.indexOf('create or replace function public.save_recipe(');
    await db.exec(measures.slice(start, measures.indexOf('$$;', start) + 3));
    await db.exec('commit');
    await db.exec(read('20261019000100_recipe_query_optimization'));
    const statusQuery = fs.readFileSync('supabase/queries/20261124_mcp_recipe_update_status.sql', 'utf8');
    assert.deepEqual((await db.query(statusQuery)).rows[0], { function_signature: null, function_exists: false,
      authenticated_can_execute: false, anonymous_can_execute: false });
    await db.exec(read('20261124000100_mcp_recipe_updates'));
    const status = (await db.query(statusQuery)).rows[0];
    assert.equal(status.function_exists, true);
    assert.equal(status.authenticated_can_execute, true);
    assert.equal(status.anonymous_can_execute, false);
    await db.exec(`create table public.recipe_photos(id uuid primary key,recipe_id uuid references public.recipes(id),storage_path text);
      grant select on public.recipe_photos to authenticated;
      do $$ declare tab text; begin
        foreach tab in array array['recipes','ingredients','recipe_ingredients','ingredient_components','recipe_steps','cuisine_types','recipe_cuisine_types'] loop
          execute format('drop policy anon_all on public.%I',tab);
          execute format('create policy editor_access on public.%I for all to authenticated using (public.is_recipe_editor()) with check (public.is_recipe_editor())',tab);
          execute format('grant select,insert,update,delete on public.%I to authenticated',tab);
        end loop;
      end $$;`);
    const version = async () => (await db.query('select updated_at::text as version from public.recipes where id=$1', [rid])).rows[0].version;
    const patch = async (changes, expected, id = rid) => (await db.query('select public.update_mcp_recipe($1,$2,$3) as result',
      [id, JSON.stringify(changes), expected ?? await version()])).rows[0].result;
    const snapshot = async () => {
      const tables = ['recipes', 'recipe_ingredients', 'recipe_steps', 'recipe_cuisine_types', 'recipe_photos'];
      const result = {};
      for (const table of tables) result[table] = (await db.query(`select to_jsonb(t) as row from public.${table} t order by to_jsonb(t)::text`)).rows;
      return result;
    };
    const seed = async () => {
      await db.exec(`reset role; truncate public.recipes,public.ingredients,public.cuisine_types cascade;
        set test.editor='true'; set request.jwt.claim.sub='${rid}';
        insert into public.ingredients(id,name,category,base_unit,unit_quantity) values
          ('${tomato}','Tomate','Verdura','g',150),('${spice}','Pimienta','Especia','g',null),
          ('${milk}','Leche','Lacteo','ml',1000),('${other}','Lentejas','Legumbre','g',null);
        set role authenticated;`);
      await db.query('select public.save_recipe_optimized($1,$2)', [rid, JSON.stringify(base)]);
      await db.exec(`reset role;
        update public.recipe_ingredients set amount_kind='glass' where recipe_id='${rid}' and ingredient_id='${milk}';
        insert into public.recipe_photos values('${other}','${rid}','photo.jpg');
        set role authenticated;`);
    };
    const scenario = (name, fn) => t.test(name, async () => { await seed(); await fn(); });

    await scenario('scalar changes preserve children, legacy amounts, photos and conversion snapshots', async () => {
      const before = await snapshot();
      const oldVersion = await version();
      await db.exec(`reset role; update public.ingredients set unit_quantity=300 where id='${tomato}'; set role authenticated;`);
      const result = await patch({ servings: 2 }, oldVersion);
      assert.equal(result.id, rid);
      assert.equal(result.stats_changed, false);
      const after = await snapshot();
      assert.equal(after.recipes[0].row.servings, 2);
      assert.notEqual(after.recipes[0].row.updated_at, before.recipes[0].row.updated_at);
      const { updated_at: ignoredBefore, servings: ignoredServings, ...oldFields } = before.recipes[0].row;
      const { updated_at: ignoredAfter, servings: ignoredAfterServings, ...newFields } = after.recipes[0].row;
      assert.deepEqual(newFields, oldFields);
      for (const table of ['recipe_ingredients', 'recipe_steps', 'recipe_cuisine_types', 'recipe_photos']) assert.deepEqual(after[table], before[table]);
    });
    await scenario('partial amounts preserve other amounts and null clears only the specified amount', async () => {
      await patch({ ingredientAmounts: { [spice]: { kind: 'spoon', value: 0.5 } } });
      let amounts = (await snapshot()).recipe_ingredients.map(item => item.row);
      assert.equal(Number(amounts.find(item => item.ingredient_id === spice).amount_value), 0.5);
      assert.equal(Number(amounts.find(item => item.ingredient_id === tomato).amount_unit_quantity), 150);
      await patch({ ingredientAmounts: { [tomato]: null } });
      amounts = (await snapshot()).recipe_ingredients.map(item => item.row);
      assert.equal(amounts.find(item => item.ingredient_id === tomato).amount_kind, 'none');
      assert.equal(amounts.find(item => item.ingredient_id === milk).amount_kind, 'glass');
    });
    await scenario('explicit ingredient and step replacements do not change the recipe identity or photos', async () => {
      await patch({ ingredientIds: [tomato, other], ingredientAmounts: { [other]: { kind: 'specific', value: 200, unit: 'g' } },
        steps: ['Cocer lentejas', 'Servir'], pending: false, rating: 8 });
      const after = await snapshot();
      assert.equal(after.recipes.length, 1);
      assert.equal(after.recipes[0].row.id, rid);
      assert.equal(after.recipe_ingredients.length, 2);
      assert.equal(after.recipe_photos[0].row.storage_path, 'photo.jpg');
      assert.deepEqual(after.recipe_steps.map(item => item.row.description), ['Cocer lentejas', 'Servir']);
      await patch({ steps: [] });
      assert.equal((await snapshot()).recipe_steps.length, 0);
    });
    await scenario('a stale version cannot overwrite a web edit or recreate a missing recipe', async () => {
      const oldVersion = await version();
      await db.query('select public.save_recipe_optimized($1,$2)', [rid, JSON.stringify({ ...base, name: 'Editada en la web' })]);
      const before = await snapshot();
      await assert.rejects(patch({ servings: 2 }, oldVersion), error => error.code === 'PT409');
      assert.deepEqual(await snapshot(), before);
      await assert.rejects(patch({ name: 'No crear' }, oldVersion, other), error => error.code === 'P0002');
      assert.deepEqual(await snapshot(), before);
    });
    await scenario('invalid edits roll back all fields even when the measured save fails after updating the parent', async () => {
      const before = await snapshot();
      for (const changes of [{}, { owner_id: rid }, { servings: 0 }, { ingredientIds: [] }, { steps: null },
        { ingredientIds: [tomato, tomato.toUpperCase()] }, { mealTypes: ['Otro'] }, { rating: 8 },
        { ingredientAmounts: { [other]: null } }, { name: 'No guardar', ingredientAmounts: { [tomato]: { kind: 'spoon', value: 1 } } }]) {
        await assert.rejects(patch(changes), error => error.code === '22023');
        assert.deepEqual(await snapshot(), before);
      }
    });
    await scenario('anonymous callers and non-editors cannot update recipes', async () => {
      const oldVersion = await version();
      await db.exec('set role anon');
      await assert.rejects(patch({ servings: 2 }, oldVersion), error => error.code === '42501');
      await db.exec("reset role; set test.editor='false'; set role authenticated;");
      await assert.rejects(patch({ servings: 2 }, oldVersion), error => error.code === '42501');
      await db.exec("reset role; set test.editor='true'; set role authenticated;");
      assert.equal((await snapshot()).recipes[0].row.servings, 4);
    });
  } finally { await db.close(); }
});
