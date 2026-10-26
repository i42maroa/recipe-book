begin;

-- Preserve the old inventory as an archive while moving writes to individual rows.
lock table public.freezer_inventories in access exclusive mode;

create table public.freezers (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id uuid not null,
  name text not null check (name ~ '\S'),
  position bigint generated always as identity,
  primary key (owner_id, id)
);

create function public.valid_freezer_entry(entry jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select public.valid_freezer_inventory(jsonb_build_array(jsonb_build_object(
    'id', '00000000-0000-4000-8000-000000000000', 'name', 'Entry', 'items', jsonb_build_array(entry))));
$$;
revoke all on function public.valid_freezer_entry(jsonb) from public, anon, authenticated;
grant execute on function public.valid_freezer_entry(jsonb) to authenticated;

create table public.freezer_entries (
  owner_id uuid not null default auth.uid(),
  freezer_id uuid not null,
  id uuid not null,
  entry jsonb not null check (public.valid_freezer_entry(entry) and (entry->>'id')::uuid = id),
  position bigint generated always as identity,
  primary key (owner_id, id),
  foreign key (owner_id, freezer_id) references public.freezers(owner_id, id) on delete cascade
);
create index freezer_entries_freezer_idx on public.freezer_entries(owner_id, freezer_id, position);

insert into public.freezers(owner_id, id, name)
select inventory.owner_id, (freezer->>'id')::uuid, freezer->>'name'
from public.freezer_inventories inventory,
  lateral jsonb_array_elements(inventory.freezers) with ordinality as f(freezer, ordinal)
order by inventory.owner_id, f.ordinal;

insert into public.freezer_entries(owner_id, freezer_id, id, entry)
select inventory.owner_id, (freezer->>'id')::uuid, (item->>'id')::uuid, item
from public.freezer_inventories inventory,
  lateral jsonb_array_elements(inventory.freezers) with ordinality as f(freezer, ordinal),
  lateral jsonb_array_elements(freezer->'items') with ordinality as i(item, ordinal)
order by inventory.owner_id, f.ordinal, i.ordinal;

alter table public.freezers enable row level security;
alter table public.freezer_entries enable row level security;
revoke all on public.freezers, public.freezer_entries from public, anon, authenticated;
grant select, insert, update, delete on public.freezers, public.freezer_entries to authenticated;
grant usage on sequence public.freezers_position_seq, public.freezer_entries_position_seq to authenticated;
create policy freezers_owner_editor on public.freezers for all to authenticated
using (owner_id = (select auth.uid()) and (select public.is_recipe_editor()))
with check (owner_id = (select auth.uid()) and (select public.is_recipe_editor()));
create policy freezer_entries_owner_editor on public.freezer_entries for all to authenticated
using (owner_id = (select auth.uid()) and (select public.is_recipe_editor()))
with check (owner_id = (select auth.uid()) and (select public.is_recipe_editor()));

create function public.get_freezer_inventory() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', freezer.id, 'name', freezer.name,
    'items', (select coalesce(jsonb_agg(item.entry order by item.position), '[]'::jsonb)
      from public.freezer_entries item where item.owner_id = freezer.owner_id and item.freezer_id = freezer.id))
    order by freezer.position), '[]'::jsonb)
  from public.freezers freezer where freezer.owner_id = auth.uid();
$$;
revoke all on function public.get_freezer_inventory() from public, anon, authenticated;
grant execute on function public.get_freezer_inventory() to authenticated;

-- Each operation compares only the affected row. A repeated, already applied
-- operation succeeds, so retrying after a lost response never duplicates a lot.
create function public.apply_freezer_changes(p_changes jsonb) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  change jsonb;
  target_freezer_id uuid;
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
    raise exception 'Los cambios del congelador no son válidos.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) = 0 then
    raise exception 'No hay cambios que guardar.' using errcode = '22023';
  end if;

  -- Stable lock order prevents deadlocks for batches spanning multiple freezers.
  for target in select distinct (value->>'freezerId')::uuid as id from jsonb_array_elements(p_changes) order by id loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text || ':' || target.id::text, 0));
  end loop;

  for change in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(change) is distinct from 'object'
      or not (change ?& array['freezerId', 'itemId', 'before', 'after'])
      or jsonb_typeof(change->'freezerId') is distinct from 'string'
      or (jsonb_typeof(change->'itemId') not in ('string', 'null')) then
      raise exception 'Los cambios del congelador no son válidos.' using errcode = '22023';
    end if;
    target_freezer_id := (change->>'freezerId')::uuid;
    target_item_id := (change->>'itemId')::uuid;
    if target_freezer_id is null then raise exception 'Falta el congelador.' using errcode = '22023'; end if;
    previous := nullif(change->'before', 'null'::jsonb);
    desired := nullif(change->'after', 'null'::jsonb);
    if previous is null and desired is null then raise exception 'Falta la entrada.' using errcode = '22023'; end if;

    -- Lock the parent as well: an empty freezer cannot be deleted while a lot is added.
    select jsonb_build_object('name', freezer.name) into current_value from public.freezers freezer
      where freezer.owner_id = auth.uid() and freezer.id = target_freezer_id for update;
    if target_item_id is null then
      if (previous is not null and (jsonb_typeof(previous) is distinct from 'object'
        or jsonb_typeof(previous->'name') is distinct from 'string' or not (previous->>'name' ~ '\S')))
        or (desired is not null and (jsonb_typeof(desired) is distinct from 'object'
        or jsonb_typeof(desired->'name') is distinct from 'string' or not (desired->>'name' ~ '\S'))) then
        raise exception 'Revisa el nombre del congelador.' using errcode = '22023';
      end if;
      if current_value is not distinct from desired then continue; end if;
      if current_value is distinct from previous then
        raise exception 'El congelador ha cambiado en otra pestaña o dispositivo. Carga la versión guardada.' using errcode = '40001';
      end if;
      if desired is null then
        if exists (select 1 from public.freezer_entries item where item.owner_id = auth.uid() and item.freezer_id = target_freezer_id) then
          raise exception 'Vacía el congelador antes de eliminarlo.' using errcode = '22023';
        end if;
        delete from public.freezers freezer where freezer.owner_id = auth.uid() and freezer.id = target_freezer_id;
      elsif previous is null then
        insert into public.freezers(owner_id, id, name) values(auth.uid(), target_freezer_id, desired->>'name');
      else
        update public.freezers freezer set name = desired->>'name' where freezer.owner_id = auth.uid() and freezer.id = target_freezer_id;
      end if;
    else
      if current_value is null then
        if desired is null and not exists (select 1 from public.freezer_entries item where item.owner_id = auth.uid() and item.id = target_item_id) then
          continue;
        end if;
        raise exception 'El congelador ya no existe. Carga la versión guardada.' using errcode = '40001';
      end if;
      if (previous is not null and (not public.valid_freezer_entry(previous) or (previous->>'id')::uuid is distinct from target_item_id))
        or (desired is not null and (not public.valid_freezer_entry(desired) or (desired->>'id')::uuid is distinct from target_item_id)) then
        raise exception 'Revisa el nombre, la cantidad y la fecha de entrada.' using errcode = '22023';
      end if;
      select item.entry into current_value from public.freezer_entries item
        where item.owner_id = auth.uid() and item.freezer_id = target_freezer_id and item.id = target_item_id for update;
      if current_value is not distinct from desired then continue; end if;
      if current_value is distinct from previous then
        raise exception 'La entrada ha cambiado en otra pestaña o dispositivo. Carga la versión guardada.' using errcode = '40001';
      end if;
      if desired is null then
        delete from public.freezer_entries item where item.owner_id = auth.uid() and item.id = target_item_id;
      elsif previous is null then
        insert into public.freezer_entries(owner_id, freezer_id, id, entry) values(auth.uid(), target_freezer_id, target_item_id, desired);
      else
        update public.freezer_entries item set entry = desired where item.owner_id = auth.uid() and item.id = target_item_id;
      end if;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.apply_freezer_changes(jsonb) from public, anon, authenticated;
grant execute on function public.apply_freezer_changes(jsonb) to authenticated;

-- Old clients must reload; writing the archived document would split the inventory.
revoke all on public.freezer_inventories from public, anon, authenticated;
revoke all on function public.save_freezer_inventory(jsonb, bigint) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
