const assert = require('node:assert/strict');
const { test } = require('node:test');
const { generateKeyPairSync, sign } = require('node:crypto');
const { createServer: createNodeServer } = require('node:http');
const { createClient } = require('@supabase/supabase-js');
const { createHttpHandler, validateClaims } = require('../out-tsc/mcp/server/mcp/http.js');
const { loadConfig } = require('../out-tsc/mcp/server/mcp/config.js');
const { createRecipeSchema, saveDailyPlanSchema, updateRecipeSchema } = require('../out-tsc/mcp/server/mcp/schemas.js');
const { LaurelService } = require('../out-tsc/mcp/server/mcp/service.js');

const recipeId = '00000000-0000-0000-0000-000000000001';
const ingredientId = '00000000-0000-0000-0000-000000000002';
const owner = '00000000-0000-0000-0000-000000000003';
const recipeVersion = '2026-11-24T12:00:00.123456+00:00';
const config = { supabaseUrl: 'https://db.example.com', supabaseKey: 'sb_publishable_test', resource: 'https://laurel.example.com/mcp',
  siteUrl: 'https://laurel.example.com', oauthClientIds: ['chatgpt-client'] };
const claims = () => ({ iss: `${config.supabaseUrl}/auth/v1`, aud: ['authenticated', config.resource], sub: owner,
  role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, client_id: 'chatgpt-client', scope: 'openid' });

function fixture(options = {}) {
  const calls = [];
  const logs = [];
  const state = { allowed: true, tokenClaims: claims(), authError: null, rpcError: null, savedId: recipeId,
    ingredients: [{ id: ingredientId, name: 'Tomate', category: 'Verdura', base_unit: 'g', unit_quantity: 150 }],
    recipe: { id: recipeId, name: 'Ensalada', updated_at: recipeVersion, recipe_ingredients: [], recipe_steps: [{ position: 2, description: 'Servir' }, { position: 1, description: 'Cortar' }] } };
  const client = {
    auth: { getClaims: async () => ({ data: { claims: state.tokenClaims }, error: state.authError }) },
    rpc(name, args) {
      calls.push({ name, args });
      if (name === 'search_recipes_by_ingredients') return builder('recipes');
      return Promise.resolve({ data: name === 'is_recipe_editor' ? state.allowed : name === 'save_recipe_optimized' ? [{ id: state.savedId }]
        : name === 'update_mcp_recipe' ? { id: recipeId, version: recipeVersion }
        : name === 'get_mcp_scheduled_day' ? { date: args.p_date, meals: [], version: 'a'.repeat(32) } : null,
      error: name === 'is_recipe_editor' ? null : state.rpcError });
    },
    from: name => builder(name),
  };
  function builder(table) {
    const query = { table, single: false };
    const chain = {};
    for (const method of ['select', 'eq', 'ilike', 'contains', 'order', 'range', 'in']) {
      chain[method] = (...args) => { calls.push({ table, method, args }); return chain; };
    }
    chain.maybeSingle = () => { query.single = true; return chain; };
    chain.then = (resolve, reject) => Promise.resolve({ data: table === 'ingredients' ? state.ingredients : query.single ? state.recipe : [{ id: recipeId, name: 'Ensalada' }], count: 1, error: null }).then(resolve, reject);
    return chain;
  }
  const factory = (...args) => { calls.push({ factory: args[2] }); return client; };
  const handler = createHttpHandler({ config, createSupabase: factory, log: entry => logs.push(entry), ...options });
  const service = new LaurelService(client, config, owner);
  return { calls, state, handler, service, logs };
}

async function rpc(handler, method, params = {}, extraHeaders = {}) {
  const response = await handler(new Request(config.resource, { method: 'POST', headers: {
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...extraHeaders,
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }));
  const text = await response.text();
  const data = response.headers.get('content-type')?.includes('text/event-stream')
    ? text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).at(-1)
    : text ? JSON.parse(text) : undefined;
  return { response, data };
}

test('MCP negotiates a real protocol handshake and lists seven tools without login', async () => {
  const { handler } = fixture();
  const init = await rpc(handler, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.response.status, 200);
  assert.equal(init.data.result.serverInfo.name, 'laurel');
  const { data } = await rpc(handler, 'tools/list');
  assert.deepEqual(data.result.tools.map(tool => tool.name).sort(), ['create_recipe', 'get_daily_plan', 'get_recipe', 'save_daily_plan', 'search_ingredients', 'search_recipes', 'update_recipe']);
  const save = data.result.tools.find(tool => tool.name === 'save_daily_plan');
  assert.equal(save.annotations.destructiveHint, true);
  assert.equal(save._meta.securitySchemes[0].type, 'oauth2');
  const update = data.result.tools.find(tool => tool.name === 'update_recipe');
  assert.equal(update.annotations.destructiveHint, true);
  assert.equal(update._meta.securitySchemes[0].type, 'oauth2');
});

test('public search escapes wildcard input, paginates and returns recipe links', async () => {
  const { handler, calls } = fixture();
  const { data } = await rpc(handler, 'tools/call', { name: 'search_recipes', arguments: { search: '50%_\\', limit: 5, offset: 10 } });
  assert.equal(data.result.isError, undefined);
  assert.equal(data.result.structuredContent.items[0].url, `${config.siteUrl}/recipes/${recipeId}`);
  assert.ok(calls.some(call => call.method === 'ilike' && call.args[1] === '%50\\%\\_\\\\%'));
  assert.ok(calls.some(call => call.method === 'range' && call.args[0] === 10 && call.args[1] === 14));
});

test('ingredient-filtered recipe search delegates ranking to the existing RPC', async () => {
  const { handler, calls } = fixture();
  await rpc(handler, 'tools/call', { name: 'search_recipes', arguments: { ingredientIds: [ingredientId] } });
  assert.deepEqual(calls.find(call => call.name === 'search_recipes_by_ingredients').args.p_ingredient_ids, [ingredientId]);
});

test('recipe detail sorts preparation steps and reports a missing recipe', async () => {
  const { handler, state } = fixture();
  const first = await rpc(handler, 'tools/call', { name: 'get_recipe', arguments: { id: recipeId } });
  assert.deepEqual(first.data.result.structuredContent.steps, ['Cortar', 'Servir']);
  assert.equal(first.data.result.structuredContent.version, recipeVersion);
  state.recipe = null;
  const missing = await rpc(handler, 'tools/call', { name: 'get_recipe', arguments: { id: recipeId } });
  assert.equal(missing.data.result.structuredContent.code, 'NOT_FOUND');
});

test('private tools return an OAuth challenge without making database calls', async () => {
  const { handler, calls } = fixture();
  for (const name of ['create_recipe', 'get_daily_plan', 'save_daily_plan', 'update_recipe']) {
    const args = name === 'create_recipe' ? { name: 'Ensalada', ingredientIds: [ingredientId] }
      : name === 'get_daily_plan' ? { date: '2026-11-23' }
      : name === 'update_recipe' ? { id: recipeId, expectedVersion: recipeVersion, changes: { servings: 2 } }
      : { date: '2026-11-23', meals: [], expectedVersion: 'a'.repeat(32) };
    const { data } = await rpc(handler, 'tools/call', { name, arguments: args });
    assert.equal(data.result.isError, true);
    assert.match(data.result._meta['mcp/www_authenticate'][0], /oauth-protected-resource/);
  }
  assert.equal(calls.filter(call => call.name || call.table).length, 0);
});

test('metadata is public, uncached and advertises the canonical resource and issuer', async () => {
  const { handler } = fixture();
  const response = await handler(new Request(`${config.siteUrl}/.well-known/oauth-protected-resource`));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.equal(data.resource, config.resource);
  assert.deepEqual(data.authorization_servers, [`${config.supabaseUrl}/auth/v1`]);
});

test('bad token signatures and wrong claims fail before tools execute', async () => {
  const { handler, state, calls } = fixture();
  state.authError = Error('bad signature');
  const result = await rpc(handler, 'tools/call', { name: 'get_daily_plan', arguments: { date: '2026-11-23' } }, { Authorization: 'Bearer fake' });
  assert.equal(result.response.status, 401);
  assert.match(result.response.headers.get('www-authenticate'), /resource_metadata/);
  assert.equal(calls.filter(call => call.name || call.table).length, 0);
  for (const change of [{ aud: 'authenticated' }, { iss: 'https://attacker.example.com' }, { exp: 0 },
    { nbf: Date.now() / 1000 + 1000 }, { client_id: 'unknown' }, { role: 'service_role' }, { scope: '' }, { sub: null }]) {
    assert.throws(() => validateClaims({ ...claims(), ...change }, config));
  }
});

test('diagnostics distinguish token rejection causes without logging credentials or claims', async () => {
  const { handler, state, logs, calls } = fixture();
  const cases = [
    [{ iss: 'https://private-issuer.example.com' }, 'issuer_mismatch'],
    [{ aud: 'private-audience' }, 'audience_mismatch'],
    [{ sub: 'private-user' }, 'invalid_identity'],
    [{ exp: 0 }, 'expired_token'],
    [{ nbf: Date.now() / 1000 + 1000 }, 'token_not_active'],
    [{ client_id: 'private-client' }, 'client_not_allowed'],
    [{ scope: 'private-scope' }, 'missing_scope'],
  ];
  for (const [change, reason] of cases) {
    state.tokenClaims = { ...claims(), ...change };
    const result = await rpc(handler, 'tools/list', {}, { Authorization: 'Bearer private-token' });
    assert.equal(result.response.status, 401);
    assert.deepEqual(logs.at(-1), { event: 'laurel_mcp_request', method: 'tools/list', status: 401, authorization: 'rejected', reason });
    assert.doesNotMatch(JSON.stringify(result.data), /issuer_mismatch|audience_mismatch|client_not_allowed/);
  }
  state.authError = Error('private SDK error');
  await rpc(handler, 'tools/list', {}, { Authorization: 'Bearer private-token' });
  assert.equal(logs.at(-1).reason, 'token_verification_failed');
  await rpc(handler, 'private-method', { secret: 'private-argument' }, { Authorization: 'Basic private-credentials' });
  assert.equal(logs.at(-1).method, 'unknown');
  assert.equal(logs.at(-1).reason, 'malformed_authorization');
  assert.doesNotMatch(JSON.stringify(logs), /private-|Bearer|Basic|authenticated|https:/);
  assert.equal(calls.filter(call => call.name || call.table).length, 0);
});

test('discovery diagnostics record anonymous and authenticated lists and cannot break auth decisions', async () => {
  const { handler, logs } = fixture();
  for (const headers of [{}, { Authorization: 'Bearer private-token' }]) {
    const result = await rpc(handler, 'tools/list', {}, headers);
    assert.equal(result.response.status, 200);
    assert.equal(result.data.result.tools.length, 7);
  }
  assert.deepEqual(logs.map(entry => [entry.method, entry.status, entry.authorization]),
    [['tools/list', 200, 'absent'], ['tools/list', 200, 'accepted']]);
  const brokenLog = fixture({ log: () => { throw Error('logging unavailable'); } });
  brokenLog.state.tokenClaims = { ...claims(), client_id: 'wrong-client' };
  assert.equal((await rpc(brokenLog.handler, 'tools/list', {}, { Authorization: 'Bearer private-token' })).response.status, 401);
});

test('real Supabase SDK verifies a signed JWT through JWKS and rejects a tampered signature', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = { ...claims(), iat: Math.floor(Date.now() / 1000) };
  const signingInput = `${encoded({ alg: 'RS256', typ: 'JWT', kid: jwk.kid })}.${encoded(payload)}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  const verifiedUrl = 'https://signature-test.example.com';
  const handler = createHttpHandler({ config: { ...config, supabaseUrl: verifiedUrl },
    createSupabase: (url, key, options) => createClient(url, key, { ...options, global: { fetch: async input => {
      assert.match(String(input), /\.well-known\/jwks\.json/);
      return Response.json({ keys: [jwk] });
    } } }),
  });
  // Correct signature with wrong issuer is rejected by Laurel after SDK verification.
  const wrongIssuer = await rpc(handler, 'ping', {}, { Authorization: `Bearer ${signingInput}.${signature}` });
  assert.equal(wrongIssuer.response.status, 401);
  const goodInput = `${encoded({ alg: 'RS256', typ: 'JWT', kid: jwk.kid })}.${encoded({ ...payload, iss: `${verifiedUrl}/auth/v1` })}`;
  const goodSignature = sign('RSA-SHA256', Buffer.from(goodInput), privateKey).toString('base64url');
  const good = await rpc(handler, 'ping', {}, { Authorization: `Bearer ${goodInput}.${goodSignature}` });
  assert.equal(good.response.status, 200);
  const bad = await rpc(handler, 'ping', {}, { Authorization: `Bearer ${goodInput}.${signature}` });
  assert.equal(bad.response.status, 401);
});

test('authenticated requests use separate clients and forward the caller token to RLS', async () => {
  const { handler, calls, state } = fixture();
  for (const token of ['first-user-token', 'second-user-token']) {
    state.tokenClaims = { ...claims(), sub: token === 'first-user-token' ? owner : ingredientId };
    const result = await rpc(handler, 'tools/call', { name: 'get_daily_plan', arguments: { date: '2026-11-23' } }, { Authorization: `Bearer ${token}` });
    assert.equal(result.data.result.isError, undefined);
  }
  const scoped = calls.filter(call => call.factory?.accessToken);
  assert.equal(scoped.length, 2);
  assert.equal(await scoped[0].factory.accessToken(), 'first-user-token');
  assert.equal(await scoped[1].factory.accessToken(), 'second-user-token');
  assert.equal(scoped[0].factory.auth.persistSession, false);
});

test('non-editors cannot create recipes or access a private daily plan', async () => {
  const { handler, state, calls } = fixture();
  state.allowed = false;
  const result = await rpc(handler, 'tools/call', { name: 'get_daily_plan', arguments: { date: '2026-11-23' } }, { Authorization: 'Bearer fake' });
  assert.equal(result.data.result.structuredContent.code, 'FORBIDDEN');
  assert.equal(calls.filter(call => call.name === 'get_mcp_scheduled_day').length, 0);
});

test('creation reuses the transactional save, fixes p_id to null and returns the committed ID', async () => {
  const { handler, calls } = fixture();
  const result = await rpc(handler, 'tools/call', { name: 'create_recipe', arguments: { name: ' Ensalada ', ingredientIds: [ingredientId], ingredientAmounts: { [ingredientId]: { kind: 'specific', value: 2, unit: 'pieza' } } } }, { Authorization: 'Bearer fake' });
  assert.equal(result.data.result.structuredContent.id, recipeId);
  const save = calls.find(call => call.name === 'save_recipe_optimized');
  assert.equal(save.args.p_id, null);
  assert.equal(save.args.p_recipe.name, 'Ensalada');
  assert.equal(save.args.p_recipe.pending, true);
  assert.equal(calls.filter(call => call.table === 'recipes').length, 0);
});

test('creation rejects missing ingredients and incompatible ingredient measures before saving', async () => {
  const { service, calls, state } = fixture();
  for (const amount of [{ kind: 'specific', value: 1, unit: 'ml' }, { kind: 'spoon', value: 1 }]) {
    await assert.rejects(service.createRecipe(createRecipeSchema.parse({ name: 'Receta', ingredientIds: [ingredientId], ingredientAmounts: { [ingredientId]: amount } })), /cantidad/);
  }
  state.ingredients = [];
  await assert.rejects(service.createRecipe(createRecipeSchema.parse({ name: 'Receta', ingredientIds: [ingredientId] })), /ingredientes existentes/);
  assert.equal(calls.filter(call => call.name === 'save_recipe_optimized').length, 0);
});

test('creation rejects duplicate ingredients, pending ratings, unknown fields and invalid amounts', () => {
  const base = { name: 'Receta', ingredientIds: [ingredientId] };
  for (const value of [{ ...base, id: recipeId }, { ...base, ingredientIds: [ingredientId, ingredientId] },
    { ...base, rating: 5 }, { ...base, ingredientAmounts: { [recipeId]: { kind: 'specific', value: 1, unit: 'g' } } },
    { ...base, ingredientAmounts: { [ingredientId]: { kind: 'specific', value: -1, unit: 'g' } } }]) {
    assert.equal(createRecipeSchema.safeParse(value).success, false);
  }
});

test('recipe patch schemas preserve omitted fields, allow clearing amounts and reject ambiguous edits', () => {
  const base = { id: recipeId, expectedVersion: recipeVersion, changes: { servings: 2 } };
  assert.deepEqual(updateRecipeSchema.parse(base), base);
  assert.deepEqual(updateRecipeSchema.parse({ ...base, changes: { ingredientAmounts: { [ingredientId]: null } } }).changes,
    { ingredientAmounts: { [ingredientId]: null } });
  for (const change of [{ changes: {} }, { expectedVersion: undefined }, { changes: { servings: 0 } },
    { changes: { photos: [] } }, { changes: { ingredientIds: [] } }, { changes: { ingredientIds: [ingredientId, ingredientId] } },
    { changes: { ingredientIds: [recipeId], ingredientAmounts: { [ingredientId]: null } } },
    { changes: { pending: true, rating: 5 } }, { changes: { owner_id: owner } }]) {
    assert.equal(updateRecipeSchema.safeParse({ ...base, ...change }).success, false);
  }
});

test('recipe updates forward only requested changes and the exact version without creating or retrying', async () => {
  const { handler, calls, state } = fixture();
  const input = { id: recipeId, expectedVersion: recipeVersion, changes: { servings: 2 } };
  const result = await rpc(handler, 'tools/call', { name: 'update_recipe', arguments: input }, { Authorization: 'Bearer fake' });
  assert.equal(result.data.result.structuredContent.saved, true);
  assert.deepEqual(calls.find(call => call.name === 'update_mcp_recipe').args,
    { p_id: recipeId, p_changes: { servings: 2 }, p_expected_version: recipeVersion });
  for (const [code, expected] of [['PT409', 'CONFLICT'], ['P0002', 'NOT_FOUND'], ['22023', 'VALIDATION'], ['PGRST202', 'MIGRATION_REQUIRED']]) {
    state.rpcError = { code, message: 'private SQL details' };
    const failed = await rpc(handler, 'tools/call', { name: 'update_recipe', arguments: input }, { Authorization: 'Bearer fake' });
    assert.equal(failed.data.result.structuredContent.code, expected);
    assert.doesNotMatch(JSON.stringify(failed.data), /private SQL details/);
  }
  state.allowed = false;
  const denied = await rpc(handler, 'tools/call', { name: 'update_recipe', arguments: input }, { Authorization: 'Bearer fake' });
  assert.equal(denied.data.result.structuredContent.code, 'FORBIDDEN');
  assert.equal(calls.filter(call => call.name === 'update_mcp_recipe').length, 5);
  assert.equal(calls.filter(call => call.name === 'save_recipe_optimized' || call.table).length, 0);
});

test('daily plans reject impossible dates, repeated slots/recipes, foreign owners and inventory payloads', () => {
  const meal = { slot: 'lunch', servings: 2, recipes: [{ recipeId, mode: 'scale' }] };
  const base = { date: '2026-11-23', meals: [meal], expectedVersion: 'a'.repeat(32) };
  for (const value of [{ ...base, date: '2026-02-30' }, { ...base, owner_id: owner }, { ...base, expectedVersion: undefined },
    { ...base, meals: [meal, meal] }, { ...base, meals: [{ ...meal, servings: 0 }] },
    { ...base, meals: [{ ...meal, recipes: [{ mode: 'scale' }] }] },
    { ...base, meals: [{ ...meal, recipes: [meal.recipes[0], { recipeId: recipeId.toUpperCase(), mode: 'scale' }] }] },
    { ...base, meals: [{ ...meal, recipes: [{ recipeId, inventory: {} }] }] }]) {
    assert.equal(saveDailyPlanSchema.safeParse(value).success, false);
  }
  assert.equal(saveDailyPlanSchema.safeParse({ ...base, meals: [] }).success, true);
});

test('daily save forwards the expected version and reports conflicts without retrying', async () => {
  const { handler, calls, state } = fixture();
  state.rpcError = { code: 'PT409', message: 'sensitive details' };
  const result = await rpc(handler, 'tools/call', { name: 'save_daily_plan', arguments: { date: '2026-11-23', meals: [], expectedVersion: 'a'.repeat(32) } }, { Authorization: 'Bearer fake' });
  assert.equal(result.data.result.isError, true);
  assert.equal(result.data.result.structuredContent.code, 'CONFLICT');
  const saves = calls.filter(call => call.name === 'save_mcp_scheduled_day');
  assert.equal(saves.length, 1);
  assert.equal(saves[0].args.p_expected_version, 'a'.repeat(32));
  assert.doesNotMatch(JSON.stringify(result.data), /sensitive details/);
});

test('transport rejects hostile origins, batches, oversized payloads and non-JSON bodies', async () => {
  const { handler } = fixture();
  for (const [headers, body, status] of [
    [{ Origin: 'https://attacker.example.com' }, '{}', 403], [{}, '[]', 400], [{}, '{', 400],
    [{}, JSON.stringify({ value: 'x'.repeat(140000) }), 413], [{ 'Content-Type': 'text/plain' }, '{}', 415],
  ]) {
    const response = await handler(new Request(config.resource, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body }));
    assert.equal(response.status, status);
  }
  assert.equal((await handler(new Request(config.resource))).status, 405);
});

test('configuration rejects privileged Supabase keys and insecure public resource URLs', () => {
  const env = { SUPABASE_URL: config.supabaseUrl, SUPABASE_PUBLISHABLE_KEY: config.supabaseKey,
    MCP_RESOURCE_URL: config.resource, PUBLIC_SITE_URL: config.siteUrl };
  assert.equal(loadConfig(env).resource, config.resource);
  assert.throws(() => loadConfig({ ...env, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_no' }));
  const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
  assert.throws(() => loadConfig({ ...env, SUPABASE_PUBLISHABLE_KEY: `header.${payload}.signature` }));
  assert.throws(() => loadConfig({ ...env, MCP_RESOURCE_URL: 'http://public.example.com/mcp' }));
});

test('Node/Vercel entry serves discovery and MCP over HTTP without following the Host header', async t => {
  const variables = { SUPABASE_URL: config.supabaseUrl, SUPABASE_PUBLISHABLE_KEY: config.supabaseKey,
    PUBLIC_SITE_URL: config.siteUrl, MCP_RESOURCE_URL: config.resource, MCP_OAUTH_CLIENT_IDS: 'chatgpt-client' };
  const previous = Object.fromEntries(Object.keys(variables).map(key => [key, process.env[key]]));
  Object.assign(process.env, variables);
  const { default: nodeHandler } = require('../out-tsc/mcp/server/mcp/node.js');
  const server = createNodeServer((request, response) => { void nodeHandler(request, response); });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const metadata = await fetch(`${base}/api/mcp-metadata`, { headers: { Host: 'attacker.example.com' } });
  assert.equal((await metadata.json()).resource, config.resource);
  const response = await fetch(`${base}/mcp`, { method: 'POST', headers: {
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(await response.text(), /search_recipes/);
  const oversized = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(140000) });
  assert.equal(oversized.status, 413);
});
