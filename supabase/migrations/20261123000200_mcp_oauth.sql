begin;

-- Explicit mapping of pre-registered OAuth clients to their MCP audience.
-- Only SQL administrators configure this table; no user can approve themselves.
create table private.mcp_oauth_clients (
  client_id text primary key,
  resource text not null check (resource ~ '^https://[^?#]+$')
);
alter table private.mcp_oauth_clients enable row level security;
revoke all on private.mcp_oauth_clients from public,anon,authenticated;
grant usage on schema private to supabase_auth_admin;
grant select on private.mcp_oauth_clients to supabase_auth_admin;
create policy mcp_oauth_hook_read on private.mcp_oauth_clients for select to supabase_auth_admin using (true);

-- Enable manually in Authentication > Hooks after configuring the client.
-- If a hook already exists, compose this function into it instead of replacing it.
create function public.laurel_mcp_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare claims jsonb := event->'claims'; resource text; oauth_client_id text;
begin
  oauth_client_id := coalesce(event->>'client_id', claims->>'client_id');
  select c.resource into resource from private.mcp_oauth_clients c where c.client_id = oauth_client_id;
  if resource is not null then
    -- Retain authenticated for the Supabase Data API; add the specific MCP resource.
    claims := jsonb_set(claims, '{aud}', jsonb_build_array('authenticated', resource));
    claims := jsonb_set(claims, '{client_id}', to_jsonb(oauth_client_id));
    claims := jsonb_set(claims, '{scope}', '"openid"'::jsonb);
    event := jsonb_set(event, '{claims}', claims);
  end if;
  return event;
end;
$$;
revoke all on function public.laurel_mcp_access_token_hook(jsonb) from public,anon,authenticated;
grant execute on function public.laurel_mcp_access_token_hook(jsonb) to supabase_auth_admin;
commit;
