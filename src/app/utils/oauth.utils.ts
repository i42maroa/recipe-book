/** Supabase authorization IDs are opaque tokens, distinct from client/user UUIDs.
 * Keep them unchanged and safe for the Auth SDK's authorization path segment.
 * Supabase remains responsible for checking existence, ownership and expiry.
 */
export function isOAuthAuthorizationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
}
