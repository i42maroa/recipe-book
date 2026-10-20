-- Apply after meal_plans. Existing entries are preserved; future saves reject duplicates.
begin;

create or replace function public.unique_meal_plan_recipes(p_entries jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p_entries) is distinct from 'array' then return false; end if;
  return not exists (
    select 1 from jsonb_array_elements(p_entries) e
    group by (e->>'day')::numeric, e->>'slot', lower(e->>'recipeId')
    having count(*) > 1
  );
exception when others then return false;
end;
$$;

revoke all on function public.unique_meal_plan_recipes(jsonb) from public, anon;
grant execute on function public.unique_meal_plan_recipes(jsonb) to authenticated;

-- NOT VALID preserves historical plans, but checks every new or updated row.
-- Old duplicates can be removed in the planner before saving that plan again.
alter table public.meal_plans add constraint meal_plans_unique_recipes
  check (public.unique_meal_plan_recipes(entries)) not valid;

commit;
