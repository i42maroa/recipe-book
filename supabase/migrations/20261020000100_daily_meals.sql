-- Meals belong directly to a user, calendar date and meal slot.
begin;
create or replace function public.valid_scheduled_recipes(p_recipes jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb;
begin
  if jsonb_typeof(p_recipes) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_recipes) > 5 then return false; end if;
  for item in select value from jsonb_array_elements(p_recipes) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'recipeId') is distinct from 'string'
      or (item->>'recipeId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'mode') is distinct from 'string'
      or (item->>'mode') not in ('scale', 'leftovers') then return false; end if;
  end loop;
  return not exists (select 1 from jsonb_array_elements(p_recipes) e group by lower(e->>'recipeId') having count(*) > 1);
exception when others then return false;
end;
$$;

create table public.scheduled_meals (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  meal_date date not null,
  slot text not null check (slot in ('breakfast', 'lunch', 'dinner')),
  servings integer not null check (servings between 1 and 100),
  recipes jsonb not null check (jsonb_array_length(recipes) between 1 and 5 and public.valid_scheduled_recipes(recipes)),
  updated_at timestamptz not null default now(),
  primary key (owner_id, meal_date, slot)
);

-- Preserve real dated meals. For overlapping old records the newest record for
-- each date wins, including its empty slots. Favorites were never dated meals.
-- Block legacy writes until their browser permissions have been revoked.
lock table public.meal_plans in access exclusive mode;
with dated as (
  select distinct on (p.owner_id, p.start_date + d.offset_days)
    p.owner_id, p.start_date + d.offset_days as meal_date, d.offset_days, p.servings, p.entries, p.updated_at
  from public.meal_plans p
  cross join lateral generate_series(0, p.end_date - p.start_date) d(offset_days)
  where p.kind = 'plan'
  order by p.owner_id, p.start_date + d.offset_days, p.updated_at desc, p.id
), deduplicated as (
  select distinct on (d.owner_id, d.meal_date, e.item->>'slot', lower(e.item->>'recipeId'))
    d.owner_id, d.meal_date, e.item->>'slot' as slot, d.servings, d.updated_at, e.item, e.position
  from dated d cross join lateral jsonb_array_elements(d.entries) with ordinality e(item, position)
  where (e.item->>'day')::integer = d.offset_days
  order by d.owner_id, d.meal_date, e.item->>'slot', lower(e.item->>'recipeId'), e.position
)
insert into public.scheduled_meals(owner_id, meal_date, slot, servings, recipes, updated_at)
select owner_id, meal_date, slot, servings,
  jsonb_agg(jsonb_build_object('recipeId', lower(item->>'recipeId'), 'mode', item->>'mode') order by position), updated_at
from deduplicated group by owner_id, meal_date, slot, servings, updated_at;

alter table public.scheduled_meals enable row level security;
revoke all on public.scheduled_meals from public, anon, authenticated;
grant select, insert, update, delete on public.scheduled_meals to authenticated;
create policy scheduled_meals_owner_editor on public.scheduled_meals for all to authenticated
using (owner_id = (select auth.uid()) and (select public.is_recipe_editor()))
with check (owner_id = (select auth.uid()) and (select public.is_recipe_editor()));

-- A single transaction saves one day's three slots, including removing meals.
create or replace function public.save_scheduled_day(p_date date, p_meals jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare item jsonb;
begin
  if auth.uid() is null or not public.is_recipe_editor() then
    raise exception 'Necesitas pertenecer al grupo de editores.' using errcode = '42501';
  end if;
  if p_date is null or jsonb_typeof(p_meals) is distinct from 'array' then
    raise exception 'Fecha o comidas no válidas.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_meals) > 3 or exists (
    select 1 from jsonb_array_elements(p_meals) e group by e->>'slot' having count(*) > 1
  ) then raise exception 'Cada comida debe aparecer una sola vez.' using errcode = '22023'; end if;
  for item in select value from jsonb_array_elements(p_meals) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'slot') is distinct from 'string'
      or (item->>'slot') not in ('breakfast', 'lunch', 'dinner')
      or jsonb_typeof(item->'servings') is distinct from 'number'
      or (item->>'servings') !~ '^[0-9]+$'
      or (item->>'servings')::numeric not between 1 and 100
      or not public.valid_scheduled_recipes(item->'recipes') then
      raise exception 'Comida, comensales o recetas no válidos.' using errcode = '22023';
    end if;
  end loop;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text || ':' || p_date::text, 0));
  delete from public.scheduled_meals where owner_id = auth.uid() and meal_date = p_date;
  for item in select value from jsonb_array_elements(p_meals) loop
    if jsonb_array_length(item->'recipes') > 0 then
      insert into public.scheduled_meals(owner_id, meal_date, slot, servings, recipes)
      values (auth.uid(), p_date, item->>'slot', (item->>'servings')::integer, item->'recipes');
    end if;
  end loop;
end;
$$;
revoke all on function public.valid_scheduled_recipes(jsonb) from public, anon;
grant execute on function public.valid_scheduled_recipes(jsonb) to authenticated;
revoke all on function public.save_scheduled_day(date, jsonb) from public, anon;
grant execute on function public.save_scheduled_day(date, jsonb) to authenticated;

-- Retain old data as an archive, without exposing the retired API to browsers.
revoke all on public.meal_plans from public, anon, authenticated;
commit;
