const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadService } = require('./helpers/load-service.cjs');
const settle = () => new Promise(setImmediate);
const authorizationId = '00000000-0000-0000-0000-000000000001';

function fixture({ id = authorizationId, loggedIn = true } = {}) {
  const state = { loggedIn, editor: loggedIn, effects: [], calls: [], redirects: [], hold: null,
    details: { authorization_id: id, client: { name: 'ChatGPT' }, user: { email: 'user@example.com' }, scope: 'openid', redirect_uri: 'https://chatgpt.com/callback' } };
  const signal = initial => { let value = initial; const read = () => value; read.set = next => { value = next; }; return read; };
  const injections = {
    AuthService: { user: () => state.loggedIn ? { id: 'owner' } : null, canEdit: () => state.editor, requireEditor: async () => {
      state.effects[0](); // A session refresh publishes a new user object with the same ID.
      if (!state.editor) throw Error('Sin permisos');
    } },
    ActivatedRoute: { snapshot: { queryParamMap: { get: () => id } } },
    SupabaseService: { requireClient: () => ({ auth: { oauth: {
      getAuthorizationDetails: async requestId => { state.calls.push(['get', requestId]); if (state.hold) await state.hold; return { data: state.details }; },
      approveAuthorization: async (requestId, options) => { state.calls.push(['approve', requestId, options]); return { data: { redirect_url: 'https://chatgpt.com/callback?code=code&state=state' } }; },
      denyAuthorization: async (requestId, options) => { state.calls.push(['deny', requestId, options]); return { data: { redirect_url: 'https://chatgpt.com/callback?error=access_denied&state=state' } }; },
    } } }) },
  };
  const core = { Component: () => value => value, signal, effect: callback => { state.effects.push(callback); callback(); }, inject: token => injections[token] };
  const { OAuthConsentPageComponent } = loadService('src/app/pages/oauth-consent/oauth-consent-page.component.ts', injections,
    { URL, window: { location: { assign: url => state.redirects.push(url) } } }, { '@angular/core': core });
  return { page: new OAuthConsentPageComponent(), state };
}

test('consent waits for an authenticated editor and validates the authorization ID', async () => {
  const anonymous = fixture({ loggedIn: false });
  await settle();
  assert.equal(anonymous.state.calls.length, 0);
  const invalid = fixture({ id: '../../anything' });
  await settle();
  assert.equal(invalid.state.calls.length, 0);
  assert.match(invalid.page.error(), /no es válida/);
});

test('consent approves and denies only via Supabase and preserves the returned code/state URL', async () => {
  for (const approve of [true, false]) {
    const { page, state } = fixture();
    await settle();
    assert.equal(page.details().client.name, 'ChatGPT');
    await page.decide(approve);
    assert.equal(state.calls[1][0], approve ? 'approve' : 'deny');
    assert.equal(state.calls[1][1], authorizationId);
    assert.equal(state.calls[1][2].skipBrowserRedirect, true);
    assert.match(state.redirects[0], approve ? /code=code&state=state/ : /error=access_denied&state=state/);
  }
});

test('a late authorization response cannot restore consent after a session change', async () => {
  const { page, state } = fixture({ loggedIn: false });
  let release;
  state.hold = new Promise(resolve => { release = resolve; });
  state.loggedIn = true; state.editor = true; state.effects[0]();
  state.loggedIn = false; state.editor = false; state.effects[0]();
  release();
  await settle();
  assert.equal(page.details(), null);
  assert.equal(state.redirects.length, 0);
});

test('unsafe return schemes from authorization responses are never followed', async () => {
  const { page, state } = fixture();
  await settle();
  assert.throws(() => page.redirect('javascript:alert(1)'), /retorno no es válida/);
  assert.equal(state.redirects.length, 0);
});
