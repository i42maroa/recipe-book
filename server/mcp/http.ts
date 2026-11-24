import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { challenge, loadConfig, metadata, type McpConfig } from './config';
import { createServer } from './server';
import { LaurelService } from './service';
import { isUuid } from '../../src/app/utils/uuid.utils';

export const MAX_BODY_BYTES = 128 * 1024;
const json = (body: unknown, status = 200, headers: HeadersInit = {}) => Response.json(body, { status, headers });
const sessionOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

type AuthFailureReason = 'issuer_mismatch' | 'audience_mismatch' | 'invalid_identity' | 'expired_token'
  | 'token_not_active' | 'client_not_allowed' | 'missing_scope' | 'malformed_authorization' | 'token_verification_failed';
class TokenValidationError extends Error {
  constructor(readonly reason: AuthFailureReason) { super('Token no válido para Laurel MCP.'); }
}
export interface McpDiagnostic {
  event: 'laurel_mcp_request';
  method: string;
  status: number;
  authorization: 'absent' | 'not_checked' | 'accepted' | 'rejected';
  reason?: AuthFailureReason;
}
const diagnosticMethods = new Set(['initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'ping']);

export function validateClaims(claims: Record<string, unknown>, config: McpConfig): string {
  const audiences = Array.isArray(claims['aud']) ? claims['aud'] : [claims['aud']];
  if (claims['iss'] !== `${config.supabaseUrl}/auth/v1`) throw new TokenValidationError('issuer_mismatch');
  if (!audiences.includes(config.resource)) throw new TokenValidationError('audience_mismatch');
  if (claims['role'] !== 'authenticated' || typeof claims['sub'] !== 'string' || !isUuid(claims['sub'])) throw new TokenValidationError('invalid_identity');
  if (typeof claims['exp'] !== 'number' || claims['exp'] <= Date.now() / 1000) throw new TokenValidationError('expired_token');
  if (typeof claims['nbf'] === 'number' && claims['nbf'] > Date.now() / 1000) throw new TokenValidationError('token_not_active');
  if (typeof claims['client_id'] !== 'string' || !config.oauthClientIds.includes(claims['client_id'])) throw new TokenValidationError('client_not_allowed');
  if (typeof claims['scope'] !== 'string' || !claims['scope'].split(' ').includes('openid')) throw new TokenValidationError('missing_scope');
  return claims['sub'];
}

export interface HttpDependencies {
  config?: McpConfig;
  createSupabase?: typeof createClient;
  log?: (entry: McpDiagnostic) => void;
}

export function createHttpHandler(dependencies: HttpDependencies = {}) {
  const handle = async (request: Request, diagnostic: McpDiagnostic): Promise<Response> => {
    let config: McpConfig;
    try { config = dependencies.config ?? loadConfig(); }
    catch { return json({ error: 'El MCP de Laurel todavía no está configurado.' }, 503); }
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const path = new URL(request.url).pathname;
    if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp' || path === '/api/mcp-metadata') {
      return request.method === 'GET' ? json(metadata(config), 200, headers) : json({ error: 'Método no permitido.' }, 405, { ...headers, Allow: 'GET' });
    }
    if (!['/mcp', '/api/mcp'].includes(path)) return json({ error: 'No encontrado.' }, 404, headers);
    const origin = request.headers.get('origin');
    // Browser calls are same-origin only. ChatGPT's MCP calls are server-to-server.
    if (origin && origin !== new URL(config.siteUrl).origin && origin !== new URL(config.resource).origin) {
      return json({ error: 'Origen no permitido.' }, 403, headers);
    }
    if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405, { ...headers, Allow: 'POST' });
    if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return json({ error: 'Utiliza application/json.' }, 415, headers);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return json({ error: 'Petición demasiado grande.' }, 413, headers);
    let body: unknown;
    try { body = JSON.parse(raw); }
    catch { return json({ error: 'JSON no válido.' }, 400, headers); }
    // Batch execution makes per-operation authorization and write outcomes ambiguous.
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Envía una sola petición JSON-RPC.' }, 400, headers);
    if ('method' in body && typeof body.method === 'string' && diagnosticMethods.has(body.method)) diagnostic.method = body.method;
    const factory = dependencies.createSupabase ?? createClient;
    let userId: string | undefined;
    let client: SupabaseClient;
    const authorization = request.headers.get('authorization');
    if (authorization) {
      try {
        if (!/^Bearer [^\s]+$/i.test(authorization)) throw new TokenValidationError('malformed_authorization');
        const token = authorization.slice(7);
        const verifier = factory(config.supabaseUrl, config.supabaseKey, { auth: sessionOptions,
          global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) } });
        // Signature and expiry verification belongs to the Auth SDK; never trust a decoded JWT.
        const verified = await verifier.auth.getClaims(token);
        if (verified.error || !verified.data?.claims) throw new Error('Firma no válida.');
        userId = validateClaims(verified.data.claims, config);
        diagnostic.authorization = 'accepted';
        // A new client per request keeps identities isolated and forwards the user JWT to RLS.
        client = factory(config.supabaseUrl, config.supabaseKey, { auth: sessionOptions, accessToken: async () => token,
          global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } });
      } catch (error) {
        diagnostic.authorization = 'rejected';
        diagnostic.reason = error instanceof TokenValidationError ? error.reason : 'token_verification_failed';
        return json({ error: 'Vuelve a conectar tu cuenta de Laurel.' }, 401, { ...headers, 'WWW-Authenticate': challenge(config, 'invalid_token') });
      }
    } else {
      client = factory(config.supabaseUrl, config.supabaseKey, { auth: sessionOptions,
        global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } });
    }
    try {
      const service = new LaurelService(client, config, userId);
      const handler = createMcpHandler(() => createServer(service, config, !!userId));
      const response = await handler.fetch(request, { parsedBody: body });
      Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    } catch {
      return json({ error: 'No se pudo procesar la petición MCP.' }, 500, headers);
    }
  };
  return async (request: Request): Promise<Response> => {
    const diagnostic: McpDiagnostic = { event: 'laurel_mcp_request', method: 'unknown', status: 0,
      authorization: request.headers.has('authorization') ? 'not_checked' : 'absent' };
    const response = await handle(request, diagnostic);
    const path = new URL(request.url).pathname;
    if (path === '/mcp' || path === '/api/mcp') {
      diagnostic.status = response.status;
      // Only fixed method/reason labels and HTTP status; never headers, claims, args or SDK errors.
      try { (dependencies.log ?? (entry => console.info(JSON.stringify(entry))))(diagnostic); }
      catch { /* Diagnostics must not change authorization or the response. */ }
    }
    return response;
  };
}
