-- Apply after editor_access, before publishing the weekly planner frontend.
begin;

create or replace function public.valid_meal_plan_entries(p_entries jsonb, p_days integer)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  item jsonb;
begin
  if jsonb_typeof(p_entries) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_entries) > 210 then return false; end if;
  for item in select value from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(item) is distinct from 'object'
      or not (item ?& array['day', 'slot', 'recipeId', 'mode'])
      or jsonb_typeof(item->'day') is distinct from 'number'
      or (item->>'day') !~ '^[0-9]+$'
      or (item->>'day')::numeric < 0 or (item->>'day')::numeric >= p_days
      or jsonb_typeof(item->'slot') is distinct from 'string'
      or (item->>'slot') not in ('breakfast', 'lunch', 'dinner')
      or jsonb_typeof(item->'mode') is distinct from 'string'
      or (item->>'mode') not in ('scale', 'leftovers')
      or jsonb_typeof(item->'recipeId') is distinct from 'string'
      or (item->>'recipeId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then return false; end if;
  end loop;
  return not exists (
    select 1 from jsonb_array_elements(p_entries) e
    group by (e->>'day')::numeric, e->>'slot' having count(*) > 5
  );
exception when others then return false;
end;
$$;

create table public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  kind text not null check (kind in ('plan', 'favorite')),
  start_date date not null,
  end_date date not null,
  servings integer not null check (servings between 1 and 100),
  entries jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date - start_date between 0 and 13),
  check (public.valid_meal_plan_entries(entries, end_date - start_date + 1))
);
create index meal_plans_owner_updated_idx on public.meal_plans(owner_id, updated_at desc, id);

create or replace function public.touch_meal_plan()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger meal_plans_updated before update on public.meal_plans
for each row execute function public.touch_meal_plan();

alter table public.meal_plans enable row level security;
revoke all on public.meal_plans from public, anon, authenticated;
grant select, insert, update, delete on public.meal_plans to authenticated;
create policy meal_plans_owner_editor on public.meal_plans for all to authenticated
using (owner_id = (select auth.uid()) and (select public.is_recipe_editor()))
with check (owner_id = (select auth.uid()) and (select public.is_recipe_editor()));

revoke all on function public.valid_meal_plan_entries(jsonb, integer) from public, anon;
grant execute on function public.valid_meal_plan_entries(jsonb, integer) to authenticated;
revoke all on function public.touch_meal_plan() from public, anon, authenticated;
commit;
