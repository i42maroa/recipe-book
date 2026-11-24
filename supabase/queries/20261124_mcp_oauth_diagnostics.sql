-- Run in Supabase SQL Editor as an administrator. Read-only: no secrets,
-- secret hashes, user sessions or authorization codes are returned.
with clients as (
  select
    coalesce(to_jsonb(c)->>'client_id', to_jsonb(c)->>'id') as client_id,
    coalesce(to_jsonb(c)->>'client_name', to_jsonb(c)->>'name') as client_name,
    to_jsonb(c)->>'client_type' as client_type,
    to_jsonb(c)->>'token_endpoint_auth_method' as token_endpoint_auth_method,
    to_jsonb(c)->'redirect_uris' as redirect_uris
  from auth.oauth_clients c
)
select c.client_id, c.client_name, c.client_type,
  c.token_endpoint_auth_method, c.redirect_uris,
  m.resource as mcp_resource
from clients c
left join private.mcp_oauth_clients m on m.client_id = c.client_id
order by c.client_name, c.client_id;
