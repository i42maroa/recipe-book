-- Supabase SQL Editor, Database source, administrator. Read-only.
-- Does not execute the function, edit recipes or return tokens/secrets.
with rpc as (
  select to_regprocedure('public.update_mcp_recipe(uuid,jsonb,timestamp with time zone)') as function_id
)
select
  function_id::text as function_signature,
  function_id is not null as function_exists,
  case when function_id is not null then
    has_function_privilege('authenticated', function_id, 'EXECUTE')
  else false end as authenticated_can_execute,
  case when function_id is not null then
    has_function_privilege('anon', function_id, 'EXECUTE')
  else false end as anonymous_can_execute
from rpc;
