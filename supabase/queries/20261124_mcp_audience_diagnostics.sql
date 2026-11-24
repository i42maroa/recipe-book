-- Supabase SQL Editor, Database source, administrator. Read-only.
-- Runs the hook on synthetic claims, not on a real user/token.
-- Does not prove that the hook is enabled in Authentication > Hooks.
-- Does not return client secrets, user identities, codes or tokens.
with clients as (
  select
    coalesce(to_jsonb(c)->>'client_id', to_jsonb(c)->>'id') as client_id,
    coalesce(to_jsonb(c)->>'client_name', to_jsonb(c)->>'name') as client_name
  from auth.oauth_clients c
)
select
  c.client_id,
  c.client_name,
  m.resource as mcp_resource,
  public.laurel_mcp_access_token_hook(
    jsonb_build_object('client_id', c.client_id,
      'claims', jsonb_build_object('aud', 'authenticated'))
  )->'claims'->'aud' as hook_audience
from clients c
left join private.mcp_oauth_clients m on m.client_id = c.client_id
order by c.client_name, c.client_id;
