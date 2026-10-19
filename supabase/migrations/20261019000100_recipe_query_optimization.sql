begin;

-- One scan and one HTTP request for both public counters. RLS still applies.
create or replace function public.get_recipe_stats()
returns table(total bigint, pending bigint)
language sql stable security invoker set search_path = '' as $$
  select count(*), count(*) filter (where r.pending)
  from public.recipes r;
$$;
revoke all on function public.get_recipe_stats() from public, anon, authenticated;
grant execute on function public.get_recipe_stats() to anon, authenticated;

-- Compare pending on the server, rather than trusting a possibly stale client
-- snapshot. Reuse the existing transactional save and report whether counts
-- need refreshing. No additional HTTP read is needed to make this decision.
create or replace function public.save_recipe_optimized(p_id uuid, p_recipe jsonb)
returns table(id uuid, stats_changed boolean)
language plpgsql security invoker set search_path = '' as $$
declare
  previous_pending boolean;
  existed boolean;
  saved_id uuid;
begin
  select r.pending into previous_pending
  from public.recipes r where r.id = p_id for update;
  existed := found;
  saved_id := public.save_recipe(p_id, p_recipe);
  return query select saved_id,
    not existed or previous_pending is distinct from (p_recipe->>'pending')::boolean;
end;
$$;
revoke all on function public.save_recipe_optimized(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_recipe_optimized(uuid, jsonb) to authenticated;

commit;
