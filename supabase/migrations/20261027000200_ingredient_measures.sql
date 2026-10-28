begin;

alter table public.ingredients add column base_unit text, add column unit_quantity numeric;
update public.ingredients set base_unit = case when category = 'Liquidos' then 'ml' else 'g' end;
alter table public.ingredients alter column base_unit set not null;
alter table public.ingredients add constraint ingredient_base_unit_check check (base_unit in ('g','ml') and (category <> 'Especia' or base_unit = 'g'));
alter table public.ingredients add constraint ingredient_unit_quantity_check check (unit_quantity is null or (unit_quantity > 0 and unit_quantity::double precision < 'Infinity'::double precision));

alter table public.recipe_ingredients add column amount_base_unit text, add column amount_unit_quantity numeric;
alter table public.ingredient_components add column amount_base_unit text, add column amount_unit_quantity numeric;
do $$ declare tab text; constraint_name text; begin
  foreach tab in array array['recipe_ingredients','ingredient_components'] loop
    for constraint_name in select conname from pg_catalog.pg_constraint where conrelid = ('public.' || tab)::regclass
      and contype='c' and pg_catalog.pg_get_constraintdef(oid) like '%amount_kind%' and pg_catalog.pg_get_constraintdef(oid) like '%amount_value%' loop
      execute format('alter table public.%I drop constraint %I',tab,constraint_name);
    end loop;
    execute format('alter table public.%I add constraint measured_amount_shape check (
      (amount_kind in (''none'',''glass'') and amount_value is null and amount_unit is null)
      or (amount_kind = ''spoon'' and amount_unit is null and (amount_value is null or amount_value > 0))
      or (amount_kind = ''specific'' and amount_value > 0 and amount_value is not null and amount_unit is not null))',tab);
    execute format('alter table public.%I add constraint measured_amount_equivalence check (
      (amount_base_unit is null and amount_unit_quantity is null)
      or (amount_kind = ''specific'' and amount_unit = ''pieza'' and amount_base_unit in (''g'',''ml'') and amount_base_unit is not null
        and amount_unit_quantity is not null and amount_unit_quantity > 0 and amount_unit_quantity::double precision < ''Infinity''::double precision))',tab);
  end loop;
end $$;

create function public.measured_amount_json(kind text, value numeric, unit text, base text, quantity numeric) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('kind',kind,'value',value,'unit',unit,'baseUnit',base,'unitQuantity',quantity));
$$;

create function public.valid_measured_amount(amount jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if amount = 'null'::jsonb then return true; end if;
  if jsonb_typeof(amount) is distinct from 'object' then return false; end if;
  if amount->>'kind' = 'glass' then return true; end if;
  if amount->>'kind' = 'spoon' then
    return not (amount ? 'value') or (jsonb_typeof(amount->'value')='number' and (amount->>'value')::numeric>0
      and (amount->>'value')::double precision < 'Infinity'::double precision);
  end if;
  if amount->>'kind' is distinct from 'specific' or jsonb_typeof(amount->'value') is distinct from 'number'
    or (amount->>'value')::numeric <= 0 or (amount->>'value')::double precision >= 'Infinity'::double precision
    or amount->>'unit' not in ('g','ml','pieza') or jsonb_typeof(amount->'unit') is distinct from 'string' then return false; end if;
  if not (amount ? 'baseUnit') and not (amount ? 'unitQuantity') then return true; end if;
  return amount->>'unit' = 'pieza' and jsonb_typeof(amount->'baseUnit')='string' and amount->>'baseUnit' in ('g','ml')
    and jsonb_typeof(amount->'unitQuantity')='number' and (amount->>'unitQuantity')::numeric>0
    and (amount->>'unitQuantity')::double precision < 'Infinity'::double precision;
exception when others then return false;
end;
$$;

-- Existing measurements are preserved verbatim. New measurements obey the ingredient's configuration.
create function public.checked_ingredient_amount(p_id uuid, p_amount jsonb, p_existing jsonb) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare amount jsonb := coalesce(nullif(p_amount,'null'::jsonb),'{}'::jsonb) - 'ingredient_id'; ingredient public.ingredients%rowtype;
begin
  if amount = '{}'::jsonb or amount->>'kind' = 'none' then return '{"kind":"none"}'::jsonb; end if;
  if amount = p_existing then return amount; end if;
  if public.valid_measured_amount(amount) is distinct from true then raise exception 'La cantidad no es válida.' using errcode='22023'; end if;
  if jsonb_typeof(p_existing)='object' and amount-'value'=p_existing-'value'
    and coalesce((amount->>'value')::numeric,1)<=coalesce((p_existing->>'value')::numeric,1) then return amount; end if;
  select * into ingredient from public.ingredients where id=p_id;
  if not found then raise exception 'El ingrediente no existe.' using errcode='22023'; end if;
  if amount->>'kind' = 'glass' then raise exception 'Los vasos anteriores se conservan, pero no se pueden añadir vasos nuevos.' using errcode='22023'; end if;
  if amount->>'kind' = 'spoon' then
    if ingredient.category <> 'Especia' then raise exception 'Las cucharadas solo se permiten para las especias.' using errcode='22023'; end if;
    return jsonb_build_object('kind','spoon','value',coalesce((amount->>'value')::numeric,1));
  end if;
  if amount->>'unit' <> 'pieza' then
    if amount->>'unit' <> ingredient.base_unit then raise exception 'La medida no coincide con la medida base del ingrediente.' using errcode='22023'; end if;
    return amount;
  end if;
  if amount ? 'unitQuantity' then
    if (amount->>'unitQuantity')::numeric = ingredient.unit_quantity and amount->>'baseUnit'=ingredient.base_unit
      or (p_existing->>'unit'='pieza' and amount->'unitQuantity'=p_existing->'unitQuantity' and amount->'baseUnit'=p_existing->'baseUnit') then return amount; end if;
    raise exception 'La equivalencia no coincide con la del ingrediente o con la del registro guardado.' using errcode='22023';
  end if;
  if ingredient.unit_quantity is null then raise exception 'Configura el contenido de una unidad antes de utilizar unidades.' using errcode='22023'; end if;
  return amount || jsonb_build_object('baseUnit',ingredient.base_unit,'unitQuantity',ingredient.unit_quantity);
end;
$$;

create function public.save_ingredient(p_id uuid,p_name text,p_category text,p_components jsonb,p_base_unit text,p_unit_quantity numeric) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare iid uuid := coalesce(p_id,gen_random_uuid()); item jsonb; amount jsonb; previous jsonb; amounts jsonb := '{}';
begin
  if auth.uid() is null or not public.is_recipe_editor() then raise exception 'Necesitas una sesión autorizada.' using errcode='42501'; end if;
  if p_base_unit is null or p_base_unit not in ('g','ml') or (p_category='Especia' and p_base_unit<>'g')
    or (p_unit_quantity is not null and (p_unit_quantity<=0 or p_unit_quantity::double precision >= 'Infinity'::double precision)) then
    raise exception 'Revisa la medida base y la equivalencia por unidad.' using errcode='22023'; end if;
  insert into public.ingredients(id,name,category,base_unit,unit_quantity,updated_at) values(iid,trim(p_name),p_category,p_base_unit,p_unit_quantity,now())
  on conflict(id) do update set name=excluded.name,category=excluded.category,base_unit=excluded.base_unit,unit_quantity=excluded.unit_quantity,updated_at=now();
  for item in select value from jsonb_array_elements(coalesce(p_components,'[]'::jsonb)) loop
    select public.measured_amount_json(amount_kind,amount_value,amount_unit,amount_base_unit,amount_unit_quantity) into previous
      from public.ingredient_components where parent_ingredient_id=iid and component_ingredient_id=(item->>'ingredient_id')::uuid;
    amount := public.checked_ingredient_amount((item->>'ingredient_id')::uuid,item,previous);
    amounts := amounts || jsonb_build_object(item->>'ingredient_id',amount);
  end loop;
  delete from public.ingredient_components where parent_ingredient_id=iid;
  for item in select value from jsonb_array_elements(coalesce(p_components,'[]'::jsonb)) loop
    amount := amounts->(item->>'ingredient_id');
    insert into public.ingredient_components(parent_ingredient_id,component_ingredient_id,amount_kind,amount_value,amount_unit,amount_base_unit,amount_unit_quantity)
    values(iid,(item->>'ingredient_id')::uuid,amount->>'kind',(amount->>'value')::numeric,amount->>'unit',amount->>'baseUnit',(amount->>'unitQuantity')::numeric);
  end loop;
  return iid;
end;
$$;
revoke all on function public.save_ingredient(uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.save_ingredient(uuid,text,text,jsonb,text,numeric) from public,anon,authenticated;
grant execute on function public.save_ingredient(uuid,text,text,jsonb,text,numeric) to authenticated;

create or replace function public.save_recipe(p_id uuid,p_recipe jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare rid uuid := coalesce(p_id,gen_random_uuid()); item jsonb; amount jsonb; previous jsonb; cuisine text; amounts jsonb := '{}';
begin
  if auth.uid() is null or not public.is_recipe_editor() then raise exception 'Necesitas una sesión autorizada.' using errcode='42501'; end if;
  if jsonb_array_length(coalesce(p_recipe->'ingredientIds','[]'::jsonb))=0 then raise exception 'La receta requiere ingredientes.' using errcode='22023'; end if;
  insert into public.recipes(id,name,minutes,servings,pending,meal_types,rating,source_url,annotations,fitness,difficulty,updated_at)
  values(rid,p_recipe->>'name',nullif(p_recipe->>'minutes','')::integer,nullif(p_recipe->>'servings','')::integer,(p_recipe->>'pending')::boolean,
    array(select jsonb_array_elements_text(coalesce(p_recipe->'mealTypes','[]'::jsonb))),nullif(p_recipe->>'rating','')::smallint,
    nullif(p_recipe->>'sourceUrl',''),nullif(p_recipe->>'annotations',''),coalesce((p_recipe->>'fitness')::boolean,false),p_recipe->>'difficulty',now())
  on conflict(id) do update set name=excluded.name,minutes=excluded.minutes,servings=excluded.servings,pending=excluded.pending,meal_types=excluded.meal_types,
    rating=excluded.rating,source_url=excluded.source_url,annotations=excluded.annotations,fitness=excluded.fitness,difficulty=excluded.difficulty,updated_at=now();
  for item in select value from jsonb_array_elements(p_recipe->'ingredientIds') loop
    select public.measured_amount_json(amount_kind,amount_value,amount_unit,amount_base_unit,amount_unit_quantity) into previous
      from public.recipe_ingredients where recipe_id=rid and ingredient_id=(item#>>'{}')::uuid;
    amount := public.checked_ingredient_amount((item#>>'{}')::uuid,p_recipe->'ingredientAmounts'->(item#>>'{}'),previous);
    amounts := amounts || jsonb_build_object(item#>>'{}',amount);
  end loop;
  delete from public.recipe_ingredients where recipe_id=rid;
  for item in select value from jsonb_array_elements(p_recipe->'ingredientIds') loop
    amount := amounts->(item#>>'{}');
    insert into public.recipe_ingredients(recipe_id,ingredient_id,amount_kind,amount_value,amount_unit,amount_base_unit,amount_unit_quantity)
    values(rid,(item#>>'{}')::uuid,amount->>'kind',(amount->>'value')::numeric,amount->>'unit',amount->>'baseUnit',(amount->>'unitQuantity')::numeric);
  end loop;
  delete from public.recipe_steps where recipe_id=rid;
  insert into public.recipe_steps(recipe_id,position,description) select rid,ordinality,value from jsonb_array_elements_text(coalesce(p_recipe->'steps','[]'::jsonb)) with ordinality;
  delete from public.recipe_cuisine_types where recipe_id=rid;
  for cuisine in select jsonb_array_elements_text(coalesce(p_recipe->'cuisineTypes','[]'::jsonb)) loop
    insert into public.cuisine_types(name) values(cuisine) on conflict(name) do nothing;
    insert into public.recipe_cuisine_types(recipe_id,cuisine_type_id) select rid,id from public.cuisine_types where name=cuisine;
  end loop;
  return rid;
end;
$$;

-- Reuse the historical shape validation, adding finite spoon counts and conversion snapshots.
revoke all on function public.save_recipe(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_recipe(uuid,jsonb) to authenticated;

create or replace function public.valid_freezer_entry(entry jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(public.valid_measured_amount(entry->'amount'),false) and public.valid_freezer_inventory(jsonb_build_array(jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000000','name','Entry','items',jsonb_build_array(entry))));
$$;

revoke all on function public.measured_amount_json(text,numeric,text,text,numeric),public.valid_measured_amount(jsonb),public.checked_ingredient_amount(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.measured_amount_json(text,numeric,text,text,numeric),public.valid_measured_amount(jsonb),public.checked_ingredient_amount(uuid,jsonb,jsonb) to authenticated;

-- Inventory validation and its atomic compare-and-set implementation follow below.

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
          and (entry->'amount')-'value'=(desired->'amount')-'value' limit 1;
      end if;
      if desired->>'ingredientId' is not null then
        if exists(select 1 from public.ingredients where id=(desired->>'ingredientId')::uuid) then
          perform public.checked_ingredient_amount((desired->>'ingredientId')::uuid,desired->'amount',original_entry->'amount');
        elsif original_entry is null then raise exception 'El ingrediente no existe.' using errcode='22023'; end if;
      elsif (desired->'amount'->>'kind' in ('glass','spoon')) and desired->'amount' is distinct from original_entry->'amount'
        and not (coalesce((desired->'amount')-'value'=(original_entry->'amount')-'value',false)
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
