begin;

-- Freeze old clients before copying their confirmed rows. Legacy tables remain archived.
lock table public.freezers, public.freezer_entries in access exclusive mode;

create function public.valid_inventory_entry(entry jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if not public.valid_freezer_entry(entry)
    or jsonb_typeof(entry->'space') is distinct from 'string'
    or entry->>'space' not in ('pantry','freezer')
    or jsonb_typeof(entry->'arrivedOn') is distinct from 'string'
    or entry->>'arrivedOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or to_char((entry->>'arrivedOn')::date, 'YYYY-MM-DD') <> entry->>'arrivedOn'
    or (entry->>'arrivedOn')::date < (entry->>'enteredOn')::date then return false; end if;
  if jsonb_typeof(entry->'recipeId') = 'null' then
    return jsonb_typeof(entry->'servings') is not distinct from 'null';
  end if;
  if jsonb_typeof(entry->'recipeId') is distinct from 'string'
    or entry->>'recipeId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(entry->'ingredientId') is distinct from 'null'
    or jsonb_typeof(entry->'category') is distinct from 'null'
    or jsonb_typeof(entry->'amount') is distinct from 'null'
    or jsonb_typeof(entry->'servings') is distinct from 'number' then return false; end if;
  return (entry->>'servings')::numeric between 1 and 2147483647
    and trunc((entry->>'servings')::numeric) = (entry->>'servings')::numeric;
exception when others then return false;
end;
$$;
revoke all on function public.valid_inventory_entry(jsonb) from public, anon, authenticated;
grant execute on function public.valid_inventory_entry(jsonb) to authenticated;

create table public.inventory_places (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id uuid not null,
  name text not null check (name ~ '\S'),
  position bigint generated always as identity,
  primary key (owner_id, id)
);

-- No FK to recipes/ingredients: names remain snapshots if catalogue entries disappear.
-- Each place always has exactly two logical spaces, represented by entry.space.
create table public.inventory_entries (
  owner_id uuid not null default auth.uid(),
  place_id uuid not null,
  id uuid not null,
  entry jsonb not null check (public.valid_inventory_entry(entry) and (entry->>'id')::uuid = id),
  position bigint generated always as identity,
  primary key (owner_id, id),
  foreign key (owner_id, place_id) references public.inventory_places(owner_id, id) on delete cascade
);
create index inventory_entries_place_idx on public.inventory_entries(owner_id, place_id, position);

insert into public.inventory_places(owner_id, id, name)
select owner_id, id, name from public.freezers order by position;
insert into public.inventory_entries(owner_id, place_id, id, entry)
select owner_id, freezer_id, id, entry || jsonb_build_object(
  'space','freezer','recipeId',null,'servings',null,'arrivedOn',entry->>'enteredOn')
from public.freezer_entries order by position;

alter table public.inventory_places enable row level security;
alter table public.inventory_entries enable row level security;
revoke all on public.inventory_places, public.inventory_entries from public, anon, authenticated;
grant select, insert, update, delete on public.inventory_places, public.inventory_entries to authenticated;
grant usage on sequence public.inventory_places_position_seq, public.inventory_entries_position_seq to authenticated;
create policy inventory_places_owner_editor on public.inventory_places for all to authenticated
using (owner_id = (select auth.uid()) and (select public.is_recipe_editor()))
with check (owner_id = (select auth.uid()) and (select public.is_recipe_editor()));
create policy inventory_entries_owner_editor on public.inventory_entries for all to authenticated
using (owner_id = (select auth.uid()) and (select public.is_recipe_editor()))
with check (owner_id = (select auth.uid()) and (select public.is_recipe_editor()));

create function public.get_inventory() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', place.id, 'name', place.name,
    'items', (select coalesce(jsonb_agg(item.entry order by item.position), '[]'::jsonb)
      from public.inventory_entries item where item.owner_id = place.owner_id and item.place_id = place.id))
    order by place.position), '[]'::jsonb)
  from public.inventory_places place where place.owner_id = auth.uid();
$$;
revoke all on function public.get_inventory() from public, anon, authenticated;
grant execute on function public.get_inventory() to authenticated;

-- Each operation compares only the affected row. A repeated, already applied
-- operation succeeds, so retrying after a lost response never duplicates a lot.
create function public.apply_inventory_changes(p_changes jsonb) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  change jsonb;
  target_place_id uuid;
  target_item_id uuid;
  previous jsonb;
  desired jsonb;
  current_value jsonb;
  target record;
begin
  if auth.uid() is null or not public.is_recipe_editor() then
    raise exception 'Necesitas pertenecer al grupo de editores.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'Los cambios del inventario no son válidos.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) = 0 then
    raise exception 'No hay cambios que guardar.' using errcode = '22023';
  end if;

  -- Stable lock order prevents deadlocks for batches spanning multiple freezers.
  for target in select distinct (value->>'placeId')::uuid as id from jsonb_array_elements(p_changes) order by id loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text || ':' || target.id::text, 0));
  end loop;

  for change in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(change) is distinct from 'object'
      or not (change ?& array['placeId', 'itemId', 'before', 'after'])
      or jsonb_typeof(change->'placeId') is distinct from 'string'
      or (jsonb_typeof(change->'itemId') not in ('string', 'null')) then
      raise exception 'Los cambios del inventario no son válidos.' using errcode = '22023';
    end if;
    target_place_id := (change->>'placeId')::uuid;
    target_item_id := (change->>'itemId')::uuid;
    if target_place_id is null then raise exception 'Falta el lugar.' using errcode = '22023'; end if;
    previous := nullif(change->'before', 'null'::jsonb);
    desired := nullif(change->'after', 'null'::jsonb);
    if previous is null and desired is null then raise exception 'Falta la entrada.' using errcode = '22023'; end if;

    -- Lock the parent as well: an empty place cannot be deleted while a lot is added.
    select jsonb_build_object('name', place.name) into current_value from public.inventory_places place
      where place.owner_id = auth.uid() and place.id = target_place_id for update;
    if target_item_id is null then
      if (previous is not null and (jsonb_typeof(previous) is distinct from 'object'
        or jsonb_typeof(previous->'name') is distinct from 'string' or not (previous->>'name' ~ '\S')))
        or (desired is not null and (jsonb_typeof(desired) is distinct from 'object'
        or jsonb_typeof(desired->'name') is distinct from 'string' or not (desired->>'name' ~ '\S'))) then
        raise exception 'Revisa el nombre del lugar.' using errcode = '22023';
      end if;
      if current_value is not distinct from desired then continue; end if;
      if current_value is distinct from previous then
        raise exception 'El lugar ha cambiado en otra pestaña o dispositivo. Carga la versión guardada.' using errcode = '40001';
      end if;
      if desired is null then
        if exists (select 1 from public.inventory_entries item where item.owner_id = auth.uid() and item.place_id = target_place_id) then
          raise exception 'Vacía el lugar antes de eliminarlo.' using errcode = '22023';
        end if;
        delete from public.inventory_places place where place.owner_id = auth.uid() and place.id = target_place_id;
      elsif previous is null then
        insert into public.inventory_places(owner_id, id, name) values(auth.uid(), target_place_id, desired->>'name');
      else
        update public.inventory_places place set name = desired->>'name' where place.owner_id = auth.uid() and place.id = target_place_id;
      end if;
    else
      if current_value is null then
        if desired is null and not exists (select 1 from public.inventory_entries item where item.owner_id = auth.uid() and item.id = target_item_id) then
          continue;
        end if;
        raise exception 'El lugar ya no existe. Carga la versión guardada.' using errcode = '40001';
      end if;
      if (previous is not null and (not public.valid_inventory_entry(previous) or (previous->>'id')::uuid is distinct from target_item_id))
        or (desired is not null and (not public.valid_inventory_entry(desired) or (desired->>'id')::uuid is distinct from target_item_id)) then
        raise exception 'Revisa el nombre, la cantidad y la fecha de entrada.' using errcode = '22023';
      end if;
      select item.entry into current_value from public.inventory_entries item
        where item.owner_id = auth.uid() and item.place_id = target_place_id and item.id = target_item_id for update;
      if current_value is not distinct from desired then continue; end if;
      if current_value is distinct from previous then
        raise exception 'La entrada ha cambiado en otra pestaña o dispositivo. Carga la versión guardada.' using errcode = '40001';
      end if;
      if desired is null then
        delete from public.inventory_entries item where item.owner_id = auth.uid() and item.id = target_item_id;
      elsif previous is null then
        insert into public.inventory_entries(owner_id, place_id, id, entry) values(auth.uid(), target_place_id, target_item_id, desired);
      else
        update public.inventory_entries item set entry = desired where item.owner_id = auth.uid() and item.id = target_item_id;
      end if;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.apply_inventory_changes(jsonb) from public, anon, authenticated;
grant execute on function public.apply_inventory_changes(jsonb) to authenticated;


-- Scalar JSON result avoids row limits and never returns recipe content.
create function public.inventory_recipe_ids(p_ids uuid[]) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from public.recipes
  where id = any(p_ids) and auth.uid() is not null and public.is_recipe_editor();
$$;
revoke all on function public.inventory_recipe_ids(uuid[]) from public, anon, authenticated;
grant execute on function public.inventory_recipe_ids(uuid[]) to authenticated;

revoke all on public.freezers, public.freezer_entries from public, anon, authenticated;
revoke all on function public.get_freezer_inventory() from public, anon, authenticated;
revoke all on function public.apply_freezer_changes(jsonb) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
