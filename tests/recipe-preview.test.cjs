const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { createHandler } = require('../api/recipe-preview');

const html = readFileSync(require.resolve('../src/index.html'), 'utf8')
  .replace('</body>', '<script src="main-HASH.js" type="module"></script></body>');
const config = { publicSiteUrl: 'https://laurel.example', supabaseUrl: 'https://db.example', supabaseAnonKey: 'public-key' };
const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const recipe = { name: 'Arroz & verduras', minutes: 25, servings: 2, difficulty: 'Fácil', recipe_photos: [
  { position: 1, storage_path: 'recipe/second.webp', alt_text: 'Segunda' },
  { position: 0, storage_path: 'recipe/first photo.webp', alt_text: 'Foto "principal"' },
] };

async function requestPreview(fetchRecipe, requestId = id) {
  const handler = createHandler({ loadResources: async () => ({ html, config }), fetchRecipe });
  const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = body; } };
  await handler({ url: `/api/recipe-preview?id=${requestId}&fromPlanner=week` }, response);
  return response;
}

test('recipe HTML delivers unique metadata and the ordered primary photo without executing JavaScript', async () => {
  const response = await requestPreview(async (url, options) => {
    assert.equal(url.origin, config.supabaseUrl);
    assert.equal(url.searchParams.get('id'), `eq.${id}`);
    assert.equal(options.headers.apikey, 'public-key');
    assert.equal(options.headers.Authorization, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => [recipe] };
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /og:title" content="Arroz &amp; verduras · Laurel"/);
  assert.match(response.body, /25 min · 2 comensales · Fácil/);
  assert.match(response.body, /og:image" content="https:\/\/db.example\/storage\/v1\/object\/public\/recipe-photos\/recipe\/first%20photo.webp"/);
  assert.match(response.body, /Foto &quot;principal&quot;/);
  assert.match(response.body, new RegExp(`rel="canonical" href="https://laurel.example/recipes/${id}"`));
  assert.doesNotMatch(response.body, /fromPlanner|og:image:width|og:image:type/);
  assert.equal((response.body.match(/property="og:title"/g) || []).length, 1);
  assert.match(response.body, /main-HASH.js/);
  assert.match(response.headers['Cache-Control'], /s-maxage=60/);
});

test('recipes without photos or optional fields use the branded fallback and omit empty details', async () => {
  const response = await requestPreview(async () => ({ ok: true, json: async () => [{ name: 'Sopa', minutes: null, servings: null, recipe_photos: [] }] }));
  assert.match(response.body, /https:\/\/laurel.example\/assets\/brand\/social-preview.png/);
  assert.match(response.body, /og:image:width" content="1200"/);
  assert.doesNotMatch(response.body, /null|undefined|0 min|0 comensales/);
});

test('HTML in public recipe fields is escaped, including replacement tokens', async () => {
  const name = '<script>alert("$&")</script>';
  const response = await requestPreview(async () => ({ ok: true, json: async () => [{ name }] }));
  assert.doesNotMatch(response.body, /<script>alert/);
  assert.match(response.body, /&lt;script&gt;alert\(&quot;\$&amp;&quot;\)&lt;\/script&gt;/);
});

test('invalid IDs skip the database and preserve the app without shared caching', async () => {
  const response = await requestPreview(() => assert.fail('Must not query Supabase'), 'not-a-uuid');
  assert.equal(response.body, html);
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('Vercel rewrite query works when the request retains the original recipe URL', async () => {
  const handler = createHandler({ loadResources: async () => ({ html, config }),
    fetchRecipe: async () => ({ ok: true, json: async () => [recipe] }) });
  let body;
  await handler({ url: `/recipes/${id}`, query: { id } }, { setHeader() {}, end(value) { body = value; } });
  assert.match(body, /og:title" content="Arroz &amp; verduras · Laurel"/);
});

test('missing recipes and upstream errors preserve the app and do not cache a generic preview', async () => {
  for (const fetchRecipe of [async () => ({ ok: true, json: async () => [] }),
    async () => ({ ok: false }), async () => { throw new Error('Timeout'); }]) {
    const response = await requestPreview(fetchRecipe);
    assert.equal(response.body, html);
    assert.equal(response.headers['Cache-Control'], 'no-store');
  }
});

test('Vercel routes recipe URLs before the SPA fallback and packages the required runtime files', () => {
  const vercel = require('../vercel.json');
  assert.deepEqual(vercel.rewrites[0], { source: '/recipes/:id', destination: '/api/recipe-preview?id=:id' });
  const files = vercel.functions['api/recipe-preview.js'].includeFiles;
  assert.ok(files.includes('dist/recetario/browser/index.html'));
  assert.ok(files.includes('src/environments/environment.production.ts'));
});
