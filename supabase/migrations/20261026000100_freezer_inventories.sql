begin;

-- Names/categories are snapshots. Free products never enter the ingredient catalogue.
create function public.valid_freezer_inventory(p_freezers jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare freezer jsonb; item jsonb; amount jsonb;
  freezer_ids text[] := '{}'; item_ids text[] := '{}';
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if jsonb_typeof(p_freezers) is distinct from 'array' then return false; end if;
  for freezer in select value from jsonb_array_elements(p_freezers) loop
    if jsonb_typeof(freezer) is distinct from 'object'
      or jsonb_typeof(freezer->'id') is distinct from 'string' or freezer->>'id' !~* uuid_pattern
      or lower(freezer->>'id') = any(freezer_ids)
      or jsonb_typeof(freezer->'name') is distinct from 'string' or freezer->>'name' !~ '[^[:space:]]'
      or jsonb_typeof(freezer->'items') is distinct from 'array' then return false; end if;
    freezer_ids := array_append(freezer_ids, lower(freezer->>'id'));
    for item in select value from jsonb_array_elements(freezer->'items') loop
      if jsonb_typeof(item) is distinct from 'object'
        or jsonb_typeof(item->'id') is distinct from 'string' or item->>'id' !~* uuid_pattern
        or lower(item->>'id') = any(item_ids)
        or jsonb_typeof(item->'name') is distinct from 'string' or item->>'name' !~ '[^[:space:]]'
        or jsonb_typeof(item->'enteredOn') is distinct from 'string'
        or item->>'enteredOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or to_char((item->>'enteredOn')::date, 'YYYY-MM-DD') <> item->>'enteredOn'
        or (item->>'enteredOn')::date < date '0001-01-01' then return false; end if;
      item_ids := array_append(item_ids, lower(item->>'id'));
      if jsonb_typeof(item->'ingredientId') = 'null' then
        if jsonb_typeof(item->'category') is distinct from 'null' then return false; end if;
      elsif jsonb_typeof(item->'ingredientId') is distinct from 'string' or item->>'ingredientId' !~* uuid_pattern
        or jsonb_typeof(item->'category') is distinct from 'string'
        or item->>'category' not in ('Verdura','Fruta','Legumbre','Pescado','Carne','Lacteo','Cereal','Liquidos','FrutosSecos','Especia','Elaboracion','Otro') then return false;
      end if;
      amount := item->'amount';
      if jsonb_typeof(amount) = 'null' then continue; end if;
      if jsonb_typeof(amount) is distinct from 'object' or jsonb_typeof(amount->'kind') is distinct from 'string' then return false; end if;
      if amount->>'kind' = 'specific' then
        if jsonb_typeof(amount->'value') is distinct from 'number' or (amount->>'value')::numeric <= 0
          or (amount->>'value')::double precision = 'Infinity'::double precision
          or jsonb_typeof(amount->'unit') is distinct from 'string' or amount->>'unit' not in ('g','ml','pieza') then return false; end if;
      elsif amount->>'kind' not in ('spoon','glass') then return false;
      end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.valid_freezer_inventory(jsonb) from public, anon, authenticated;
grant execute on function public.valid_freezer_inventory(jsonb) to authenticated;

create table public.freezer_inventories (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  freezers jsonb not null default '[]'::jsonb check (public.valid_freezer_inventory(freezers)),
  version bigint not null default 1 check (version between 1 and 9007199254740991),
  updated_at timestamptz not null default now()
);
alter table public.freezer_inventories enable row level security;
revoke all on public.freezer_inventories from public, anon, authenticated;
grant select, insert, update on public.freezer_inventories to authenticated;
create policy freezer_inventories_owner_editor on public.freezer_inventories for all to authenticated
using (owner_id = (select auth.uid()) and (select public.is_recipe_editor()))
with check (owner_id = (select auth.uid()) and (select public.is_recipe_editor()));

create function public.save_freezer_inventory(p_freezers jsonb, p_expected_version bigint)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare saved_version bigint;
begin
  if auth.uid() is null or not public.is_recipe_editor() then
    raise exception 'Necesitas pertenecer al grupo de editores.' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 or p_expected_version >= 9007199254740991
    or not public.valid_freezer_inventory(p_freezers) then
    raise exception 'El inventario de congeladores no es válido.' using errcode = '22023';
  end if;
  if p_expected_version = 0 then
    insert into public.freezer_inventories(owner_id, freezers) values(auth.uid(), p_freezers)
      on conflict (owner_id) do nothing returning version into saved_version;
  else
    update public.freezer_inventories set freezers = p_freezers, version = version + 1, updated_at = now()
      where owner_id = auth.uid() and version = p_expected_version returning version into saved_version;
  end if;
  if saved_version is null then
    raise exception 'El inventario ha cambiado en otra pestaña o dispositivo. Carga la versión guardada antes de volver a guardar.' using errcode = '40001';
  end if;
  return saved_version;
end;
$$;
revoke all on function public.save_freezer_inventory(jsonb, bigint) from public, anon, authenticated;
grant execute on function public.save_freezer_inventory(jsonb, bigint) to authenticated;
notify pgrst, 'reload schema';

commit;
