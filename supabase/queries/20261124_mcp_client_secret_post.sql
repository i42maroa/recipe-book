-- Manual repair for the client observed in the 2026-11-24 Auth logs.
-- Run in Supabase SQL Editor with Database as the query source.
-- This connection sends client_secret_post; the client was registered as Basic.
-- Keeps the existing client ID, secret, redirect URIs and confidential type.
-- No credentials are returned. This is not an automatic migration.
update auth.oauth_clients as c
set token_endpoint_auth_method = 'client_secret_post'
where coalesce(to_jsonb(c)->>'client_id', to_jsonb(c)->>'id') =
  '960a00d7-aba4-4201-a1b1-e0855ae1c677'
  and c.client_type::text = 'confidential'
  and c.token_endpoint_auth_method::text = 'client_secret_basic'
returning
  coalesce(to_jsonb(c)->>'client_id', to_jsonb(c)->>'id') as client_id,
  c.token_endpoint_auth_method;
