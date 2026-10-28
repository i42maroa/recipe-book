-- Fix JSON null amounts when looking up a source lot for legacy transfers.
-- Also applies to projects that already ran the ingredient measures migration.
begin;

create or replace function public.apply_inventory_changes(p_changes jsonb) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  change jsonb;
  target_place_id uuid;
  target_item_id uuid;
  previous jsonb;
  desired jsonb;
  current_value jsonb;
  target record;
  original_entry jsonb;
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
    desired := nullif(change->'after','null'::jsonb);
    if change->>'itemId' is not null and desired is not null and desired->>'recipeId' is null then
      select entry into original_entry from public.inventory_entries where owner_id=auth.uid() and id=(change->>'itemId')::uuid;
      if original_entry is null then
        select entry into original_entry from public.inventory_entries stock
        join jsonb_array_elements(p_changes) source on stock.id=(source->>'itemId')::uuid and stock.entry=source->'before'
        where stock.owner_id=auth.uid() and entry->'ingredientId'=desired->'ingredientId'
          and coalesce(nullif(entry->'amount','null'::jsonb),'{}'::jsonb)-'value'
            =coalesce(nullif(desired->'amount','null'::jsonb),'{}'::jsonb)-'value' limit 1;
      end if;
      if desired->>'ingredientId' is not null then
        if exists(select 1 from public.ingredients where id=(desired->>'ingredientId')::uuid) then
          perform public.checked_ingredient_amount((desired->>'ingredientId')::uuid,desired->'amount',original_entry->'amount');
        elsif original_entry is null then raise exception 'El ingrediente no existe.' using errcode='22023'; end if;
      elsif (desired->'amount'->>'kind' in ('glass','spoon')) and desired->'amount' is distinct from original_entry->'amount'
        and not (coalesce(nullif(desired->'amount','null'::jsonb),'{}'::jsonb)-'value'
          =coalesce(nullif(original_entry->'amount','null'::jsonb),'{}'::jsonb)-'value'
          and coalesce((desired->'amount'->>'value')::numeric,1)<=coalesce((original_entry->'amount'->>'value')::numeric,1)) then
        raise exception 'Los productos libres utilizan gramos, mililitros o unidades.' using errcode='22023';
      end if;
    end if;
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

notify pgrst, 'reload schema';
commit;
