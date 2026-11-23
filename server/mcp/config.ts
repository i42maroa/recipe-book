export interface McpConfig {
  supabaseUrl: string;
  supabaseKey: string;
  resource: string;
  siteUrl: string;
  oauthClientIds: string[];
}

function url(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Falta ${name}.`);
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
    throw new Error(`${name} debe utilizar HTTPS.`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error(`${name} no es válida.`);
  return parsed.href.replace(/\/$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const supabaseKey = env['SUPABASE_PUBLISHABLE_KEY'] || env['SUPABASE_ANON_KEY'];
  if (!supabaseKey || supabaseKey.startsWith('sb_secret_')) throw new Error('Configura una clave pública de Supabase.');
  // Legacy service_role keys must never bypass the user's RLS policies.
  if (supabaseKey.split('.').length === 3) {
    const claims = JSON.parse(Buffer.from(supabaseKey.split('.')[1]!, 'base64url').toString());
    if (claims.role !== 'anon') throw new Error('La clave de Supabase debe ser anon.');
  }
  return {
    supabaseUrl: url(env['SUPABASE_URL'], 'SUPABASE_URL'), supabaseKey,
    resource: url(env['MCP_RESOURCE_URL'], 'MCP_RESOURCE_URL'),
    siteUrl: url(env['PUBLIC_SITE_URL'], 'PUBLIC_SITE_URL'),
    oauthClientIds: (env['MCP_OAUTH_CLIENT_IDS'] || '').split(',').map(value => value.trim()).filter(Boolean),
  };
}

export function metadata(config: McpConfig) {
  return { resource: config.resource, authorization_servers: [`${config.supabaseUrl}/auth/v1`],
    scopes_supported: ['openid'], bearer_methods_supported: ['header'], resource_name: 'Laurel' };
}

export function challenge(config: McpConfig, error: 'invalid_token' | 'insufficient_scope' = 'insufficient_scope'): string {
  return `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource', config.resource).href}", scope="openid", error="${error}", error_description="Connect your Laurel account to continue"`;
}
