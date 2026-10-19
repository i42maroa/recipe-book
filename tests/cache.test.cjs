const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createClient } = require('@supabase/supabase-js');
const { loadService, memoryStorage } = require('./helpers/load-service.cjs');

const ttl = 30 * 24 * 60 * 60 * 1000;
function setup(storage = memoryStorage()) {
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const { CacheService } = loadService('src/app/services/cache.service.ts', {
    DOCUMENT: { defaultView: { localStorage: storage } },
  }, { Date: Clock });
  return { cache: new CacheService(), reload: () => new CacheService(), storage, advance: (ms) => { now += ms; } };
}

test('persists values across service recreation and expires at the requested time', () => {
  const { cache, reload, advance } = setup();
  cache.set('filters', { pending: true }, 1000);
  assert.equal(reload().get('filters').pending, true);
  advance(999);
  assert.equal(cache.get('filters').pending, true);
  advance(1);
  assert.equal(cache.get('filters'), null);
  assert.equal(reload().get('filters'), null);
});

test('reads do not extend expiry, zero TTL removes values, invalid TTL is rejected', () => {
  const { cache, advance } = setup();
  cache.set('item', 'value', 100);
  advance(90); assert.equal(cache.get('item'), 'value');
  advance(10); assert.equal(cache.get('item'), null);
  cache.set('item', 'value', 100); cache.set('item', 'value', 0);
  assert.equal(cache.get('item'), null);
  assert.throws(() => cache.set('item', 'value', -1));
  assert.throws(() => cache.set('item', 'value', Infinity));
});

test('corrupted or invalid entries are discarded without breaking the app', () => {
  const { cache, storage } = setup();
  for (const bad of ['{broken', 'null', '{}', '{"version":1,"value":"bad","expiresAt":"tomorrow"}']) {
    storage.setItem('laurel:cache:item', bad);
    assert.equal(cache.get('item'), null);
    assert.equal(storage.getItem('laurel:cache:item'), null);
  }
});

test('blocked or full storage falls back to expiring memory in the current tab', () => {
  const blocked = { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Quota'); }, removeItem() { throw Error('Blocked'); } };
  const { cache, advance } = setup(blocked);
  cache.set('item', 'value', 100);
  assert.equal(cache.get('item'), 'value');
  advance(100); assert.equal(cache.get('item'), null);
  cache.set('item', 'value', 100); cache.remove('item');
  assert.equal(cache.get('item'), null);
});

test('migrates existing Supabase sessions and clears both storage formats on logout', () => {
  const { cache, reload, storage, advance } = setup();
  storage.setItem('sb-project-auth-token', '{"access_token":"existing"}');
  const adapter = cache.createStorage(ttl);
  assert.equal(adapter.getItem('sb-project-auth-token'), '{"access_token":"existing"}');
  assert.equal(storage.getItem('sb-project-auth-token'), null);
  assert.equal(reload().createStorage(ttl).getItem('sb-project-auth-token'), '{"access_token":"existing"}');
  advance(ttl);
  assert.equal(adapter.getItem('sb-project-auth-token'), null);
  adapter.setItem('sb-project-auth-token', 'new-session');
  adapter.removeItem('sb-project-auth-token');
  assert.equal(reload().createStorage(ttl).getItem('sb-project-auth-token'), null);
});

const user = { id: '67c2c188-5725-471f-8bac-74d81adfad96', email: 'user@example.com', app_metadata: { provider: 'google' }, user_metadata: {}, aud: 'authenticated', created_at: new Date().toISOString() };
function session(expired = false) {
  const expires_at = Math.floor(Date.now() / 1000) + (expired ? -60 : 3600);
  const jwt = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: user.id, exp: expires_at })).toString('base64url'), 'signature',
  ].join('.');
  return { access_token: jwt, refresh_token: 'refresh-token', token_type: 'bearer', expires_in: 3600, expires_at, user };
}
function sdk(cache, storageKey, fetcher) {
  return createClient('https://cache-test.supabase.co', 'public-test-key', {
    auth: { storage: cache.createStorage(ttl), storageKey, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetcher ?? (async () => { throw Error('Unexpected network call'); }) },
  });
}

test('the real Supabase SDK restores the same session after closing and reopening the app', async () => {
  const { cache, reload, storage } = setup();
  const key = 'sdk-persistence';
  storage.setItem(key, JSON.stringify(session()));
  const first = sdk(cache, key);
  assert.equal((await first.auth.getSession()).data.session.user.id, user.id);
  await first.auth.dispose();
  const reopened = sdk(reload(), key);
  try {
    const restored = await reopened.auth.getSession();
    assert.equal(restored.error, null);
    assert.equal(restored.data.session.user.id, user.id);
  } finally { await reopened.auth.dispose(); }
});

test('an expired access token is renewed with its refresh token and the rotated session is persisted', async () => {
  const { cache, reload } = setup();
  const key = 'sdk-refresh';
  cache.createStorage(ttl).setItem(key, JSON.stringify(session(true)));
  let refreshes = 0;
  const client = sdk(cache, key, async (url, options) => {
    assert.ok(String(url).includes('grant_type=refresh_token'));
    assert.equal(JSON.parse(options.body).refresh_token, 'refresh-token');
    refreshes++;
    return new Response(JSON.stringify({ ...session(), refresh_token: 'rotated-refresh-token' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  try {
    const restored = await client.auth.getSession();
    assert.equal(restored.error, null);
    assert.equal(restored.data.session.refresh_token, 'rotated-refresh-token');
    assert.equal(refreshes, 1);
    assert.equal(JSON.parse(reload().createStorage(ttl).getItem(key)).refresh_token, 'rotated-refresh-token');
  } finally { await client.auth.dispose(); }
});

test('real SDK sign-out removes the cached session and reopening stays signed out', async () => {
  const { cache, reload } = setup();
  const key = 'sdk-logout';
  cache.createStorage(ttl).setItem(key, JSON.stringify(session()));
  const client = sdk(cache, key, async () => new Response(null, { status: 204 }));
  await client.auth.getSession();
  assert.equal((await client.auth.signOut({ scope: 'local' })).error, null);
  await client.auth.dispose();
  const reopened = sdk(reload(), key);
  try { assert.equal((await reopened.auth.getSession()).data.session, null); }
  finally { await reopened.auth.dispose(); }
});


test('startup and writes prune expired data without expiring or removing sessions', () => {
  const { cache, reload, storage, advance } = setup();
  const auth = cache.createStorage(ttl);
  auth.setItem('custom-session-key', 'session');
  cache.set('expired', 'old', 10);
  storage.setItem('unrelated', 'keep');
  advance(10);
  const next = reload();
  assert.equal(storage.getItem('laurel:cache:expired'), null);
  assert.equal(next.createStorage(ttl).getItem('custom-session-key'), 'session');
  next.set('fresh', 'value', 100);
  next.clearData();
  assert.equal(next.get('fresh'), null);
  assert.equal(next.createStorage(ttl).getItem('custom-session-key'), 'session');
  assert.equal(storage.getItem('unrelated'), 'keep');
});

test('data eviction caps entries and bytes while retaining the session', () => {
  const { cache, advance } = setup();
  cache.createStorage(ttl).setItem('sb-project-auth-token', 'session');
  for (let i = 0; i < 100; i++) { cache.set('recipe-' + i, i, 1000); advance(1); }
  assert.equal(cache.get('recipe-0'), null);
  assert.equal(cache.get('recipe-19'), null);
  assert.equal(cache.get('recipe-20'), 20);
  assert.equal(cache.get('recipe-99'), 99);
  cache.set('too-large', 'x'.repeat(1100000), 1000);
  assert.equal(cache.get('too-large'), null);
  assert.equal(cache.createStorage(ttl).getItem('sb-project-auth-token'), 'session');
});

test('bounded memory fallback retains multiple values when localStorage is blocked', () => {
  const blocked = { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Blocked'); }, removeItem() {} };
  const { cache } = setup(blocked);
  for (let i = 0; i < 85; i++) cache.set('data-' + i, i, 1000);
  assert.equal(cache.get('data-0'), null);
  assert.equal(cache.get('data-5'), 5);
  assert.equal(cache.get('data-84'), 84);
});

test('quota recovery removes only cached data and retries persisting auth', () => {
  const storage = memoryStorage();
  const { cache } = setup(storage);
  cache.set('recipe', 'old', 1000);
  storage.setItem('outside-cache', 'keep');
  const setItem = storage.setItem;
  let first = true;
  storage.setItem = (key, value) => {
    if (first) { first = false; const error = Error('quota'); error.name = 'QuotaExceededError'; throw error; }
    setItem(key, value);
  };
  cache.createStorage(ttl).setItem('sb-project-auth-token', 'session');
  assert.equal(cache.get('recipe'), null);
  assert.equal(cache.createStorage(ttl).getItem('sb-project-auth-token'), 'session');
  assert.ok(storage.getItem('laurel:cache:sb-project-auth-token'));
  assert.equal(storage.getItem('outside-cache'), 'keep');
});
