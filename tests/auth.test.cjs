const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadService } = require('./helpers/load-service.cjs');

function setup() {
  const document = new EventTarget();
  document.visibilityState = 'visible';
  document.defaultView = new EventTarget();
  const cleanup = [];
  const state = { session: { user: { id: 'user', email: 'user@example.com' } }, allowed: true, offline: false, reads: 0, rpcs: 0, pendingRpc: null };
  let callback;
  const client = {
    auth: {
      onAuthStateChange: (handler) => {
        callback = handler;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      getSession: async () => {
        state.reads++;
        if (state.offline) throw Error('Offline');
        return { data: { session: state.session }, error: null };
      },
      signOut: async () => {
        state.session = null;
        callback('SIGNED_OUT', null);
        return { error: null };
      },
    },
    rpc: async () => {
      state.rpcs++;
      if (state.pendingRpc) await state.pendingRpc;
      return { data: state.allowed, error: null };
    },
  };
  const { AuthService } = loadService('src/app/services/auth.service.ts', {
    DOCUMENT: document,
    DestroyRef: { onDestroy: (handler) => cleanup.push(handler) },
    SupabaseService: { client, requireClient: () => client },
  });
  return { auth: new AuthService(), state, document, dispose: () => cleanup.forEach((handler) => handler()) };
}

test('restores session at startup and rechecks permissions after hiding and resuming', async () => {
  const { auth, state, document, dispose } = setup();
  try {
    await auth.refreshPermission();
    assert.equal(auth.user().id, 'user');
    assert.equal(auth.canEdit(), true);
    const before = state.reads;
    document.visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(state.reads, before);
    state.allowed = false;
    document.visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await auth.refreshPermission();
    assert.equal(auth.user().id, 'user');
    assert.equal(auth.canEdit(), false);
  } finally { dispose(); }
});

test('pageshow, focus and online reuse an in-flight restore instead of duplicating requests', async () => {
  const { auth, state, document, dispose } = setup();
  try {
    await auth.refreshPermission();
    const before = state.reads;
    for (const event of ['pageshow', 'focus', 'online']) document.defaultView.dispatchEvent(new Event(event));
    await auth.refreshPermission();
    assert.equal(state.reads, before + 1);
    assert.equal(auth.canEdit(), true);
  } finally { dispose(); }
});

test('temporary connection loss preserves the user and online restores permissions', async () => {
  const { auth, state, document, dispose } = setup();
  try {
    await auth.refreshPermission();
    state.offline = true;
    await assert.rejects(auth.refreshPermission());
    assert.equal(auth.user().id, 'user');
    state.offline = false;
    document.defaultView.dispatchEvent(new Event('online'));
    await auth.refreshPermission();
    assert.equal(auth.canEdit(), true);
  } finally { dispose(); }
});

test('a permission response arriving after logout cannot restore the user or grant editing', async () => {
  const { auth, state, dispose } = setup();
  try {
    await auth.refreshPermission();
    let release;
    state.pendingRpc = new Promise((resolve) => { release = resolve; });
    const restoring = auth.refreshPermission();
    await Promise.resolve();
    await auth.signOut();
    release();
    assert.equal(await restoring, false);
    assert.equal(auth.user(), null);
    assert.equal(auth.canEdit(), false);
  } finally { dispose(); }
});

test('revoked membership blocks the next write even with a restored session', async () => {
  const { auth, state, dispose } = setup();
  try {
    await auth.refreshPermission();
    state.allowed = false;
    await assert.rejects(auth.requireEditor());
    assert.equal(auth.user().id, 'user');
    assert.equal(auth.canEdit(), false);
  } finally { dispose(); }
});
