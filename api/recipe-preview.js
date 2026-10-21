const { readFile } = require('node:fs/promises');
const path = require('node:path');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

function renderPreview(html, recipe, config, id) {
  const url = new URL(`/recipes/${id.toLowerCase()}`, config.publicSiteUrl).href;
  const title = `${recipe.name} · Laurel`;
  const description = [recipe.name, recipe.minutes > 0 ? `${recipe.minutes} min` : '',
    recipe.servings > 0 ? `${recipe.servings} comensales` : '', recipe.difficulty || '',
    'Consulta los ingredientes y la preparación en Laurel.'].filter(Boolean).join(' · ');
  const photo = [...(recipe.recipe_photos || [])].sort((a, b) => a.position - b.position)[0];
  const image = photo ? `${config.supabaseUrl}/storage/v1/object/public/recipe-photos/${photo.storage_path.split('/').map(encodeURIComponent).join('/')}`
    : new URL('/assets/brand/social-preview.png', config.publicSiteUrl).href;
  const alt = photo?.alt_text || recipe.name;
  // Replace, rather than duplicate, the generic metadata. Keep Angular's built scripts intact.
  html = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(title)}</title>`)
    .replace(/\s*<meta\b[^>]*(?:property="og:[^"]+"|name="(?:twitter:[^"]+|description)")[^>]*>/gi, '')
    .replace(/\s*<link\b[^>]*rel="canonical"[^>]*>/gi, '');
  const properties = { 'og:type': 'article', 'og:site_name': 'Laurel', 'og:locale': 'es_ES',
    'og:url': url, 'og:title': title, 'og:description': description, 'og:image': image, 'og:image:alt': alt };
  if (!photo) Object.assign(properties, { 'og:image:width': '1200', 'og:image:height': '630', 'og:image:type': 'image/png' });
  const names = { description, 'twitter:card': 'summary_large_image', 'twitter:title': title,
    'twitter:description': description, 'twitter:image': image, 'twitter:image:alt': alt };
  const tags = [
    ...Object.entries(properties).map(([key, value]) => `<meta property="${key}" content="${escapeHtml(value)}">`),
    ...Object.entries(names).map(([key, value]) => `<meta name="${key}" content="${escapeHtml(value)}">`),
    `<link rel="canonical" href="${escapeHtml(url)}">`,
  ];
  return html.replace('</head>', () => `${tags.join('\n')}\n</head>`);
}

function createHandler({ loadResources, fetchRecipe = fetch }) {
  return async function handler(request, response) {
    const { html, config } = await loadResources();
    const id = request.query?.id ?? new URL(request.url, config.publicSiteUrl).searchParams.get('id');
    let body = html;
    let cache = 'no-store';
    if (typeof id === 'string' && uuid.test(id)) {
      try {
        const query = new URL('/rest/v1/recipes', config.supabaseUrl);
        query.searchParams.set('id', `eq.${id.toLowerCase()}`);
        query.searchParams.set('select', 'name,minutes,servings,difficulty,recipe_photos(storage_path,position,alt_text)');
        query.searchParams.set('limit', '1');
        const result = await fetchRecipe(query, {
          headers: { apikey: config.supabaseAnonKey }, signal: AbortSignal.timeout(4000),
        });
        if (!result.ok) throw new Error('Recipe preview unavailable');
        const recipes = await result.json();
        if (recipes[0]) {
          body = renderPreview(html, recipes[0], config, id);
          cache = 'public, max-age=0, s-maxage=60';
        }
      } catch {
        // A preview lookup failure must not prevent Angular from loading the recipe.
      }
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', cache);
    response.statusCode = 200;
    response.end(body);
  };
}

let resources;
module.exports = createHandler({
  loadResources: () => {
    resources ??= Promise.all([
      readFile(path.join(process.cwd(), 'dist/recetario/browser/index.html'), 'utf8'),
      readFile(path.join(process.cwd(), 'src/environments/environment.production.ts'), 'utf8'),
    ]).then(([html, source]) => {
      const config = Object.fromEntries(['publicSiteUrl', 'supabaseUrl', 'supabaseAnonKey'].map(key => {
        const value = source.match(new RegExp(`${key}:\\s*'([^']+)'`))?.[1];
        if (!value) throw new Error(`Missing public configuration: ${key}`);
        return [key, value];
      }));
      return { html, config };
    });
    return resources;
  },
});
module.exports.createHandler = createHandler;
