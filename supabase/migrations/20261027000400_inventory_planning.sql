begin;

-- A planning reference marks a prepared lot; it never consumes or reserves portions.
create function public.valid_scheduled_inventory_source(source jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(source)='object'
    and jsonb_typeof(source->'placeId')='string' and source->>'placeId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and jsonb_typeof(source->'itemId')='string' and source->>'itemId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and jsonb_typeof(source->'placeName')='string' and source->>'placeName' ~ '\S'
    and jsonb_typeof(source->'space')='string' and source->>'space' in ('pantry','freezer'),false);
$$;

create or replace function public.valid_scheduled_recipes(p_recipes jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb;
begin
  if jsonb_typeof(p_recipes) is distinct from 'array' or jsonb_array_length(p_recipes)>5 then return false; end if;
  for item in select value from jsonb_array_elements(p_recipes) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'recipeId') is distinct from 'string'
      or (item->>'recipeId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'mode') is distinct from 'string'
      or (item->>'mode') not in ('scale','leftovers')
      or (item ? 'inventory' and not public.valid_scheduled_inventory_source(item->'inventory')) then return false; end if;
  end loop;
  return not exists(select 1 from jsonb_array_elements(p_recipes) e group by lower(e->>'recipeId') having count(*)>1);
exception when others then return false;
end;
$$;

create or replace function public.save_scheduled_day(p_date date,p_meals jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare item jsonb; recipe jsonb; source jsonb;
begin
  if auth.uid() is null or not public.is_recipe_editor() then
    raise exception 'Necesitas pertenecer al grupo de editores.' using errcode='42501'; end if;
  if p_date is null or jsonb_typeof(p_meals) is distinct from 'array' then
    raise exception 'Fecha o comidas no válidas.' using errcode='22023'; end if;
  if jsonb_array_length(p_meals)>3 or exists(select 1 from jsonb_array_elements(p_meals) e group by e->>'slot' having count(*)>1) then
    raise exception 'Cada comida debe aparecer una sola vez.' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(p_meals) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'slot') is distinct from 'string' or item->>'slot' not in ('breakfast','lunch','dinner')
      or jsonb_typeof(item->'servings') is distinct from 'number' or item->>'servings' !~ '^[0-9]+$'
      or (item->>'servings')::numeric not between 1 and 100 or not public.valid_scheduled_recipes(item->'recipes') then
      raise exception 'Comida, comensales o recetas no válidos.' using errcode='22023'; end if;
  end loop;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text || ':' || p_date::text,0));
  for item in select value from jsonb_array_elements(p_meals) loop
    for recipe in select value from jsonb_array_elements(item->'recipes') loop
      source:=recipe->'inventory';
      if source is not null and not exists (
        select 1 from public.inventory_entries stock where stock.owner_id=auth.uid()
          and stock.place_id=(source->>'placeId')::uuid and stock.id=(source->>'itemId')::uuid
          and lower(stock.entry->>'recipeId')=lower(recipe->>'recipeId')
      ) and not exists (
        -- Keep historical sources unchanged after an owned lot is withdrawn.
        select 1 from public.scheduled_meals saved cross join lateral jsonb_array_elements(saved.recipes) old
        where saved.owner_id=auth.uid() and saved.meal_date=p_date and saved.slot=item->>'slot'
          and lower(old->>'recipeId')=lower(recipe->>'recipeId') and old->'inventory'=source
      ) then raise exception 'La receta preparada ya no está disponible en ese lugar. Actualiza el inventario.' using errcode='22023'; end if;
    end loop;
  end loop;
  delete from public.scheduled_meals where owner_id=auth.uid() and meal_date=p_date;
  for item in select value from jsonb_array_elements(p_meals) loop
    if jsonb_array_length(item->'recipes')>0 then
      insert into public.scheduled_meals(owner_id,meal_date,slot,servings,recipes)
      values(auth.uid(),p_date,item->>'slot',(item->>'servings')::integer,item->'recipes');
    end if;
  end loop;
end;
$$;

-- Return one JSON array to avoid losing links to the API's row cap.
create function public.get_inventory_planning_links(p_from date) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_recipe_editor() then
    raise exception 'Necesitas pertenecer al grupo de editores.' using errcode='42501'; end if;
  if p_from is null then raise exception 'Falta la fecha inicial.' using errcode='22023'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('placeId',stock.place_id,'itemId',stock.id,
      'recipeId',recipe->>'recipeId','date',meal.meal_date,'slot',meal.slot) order by meal.meal_date,meal.slot,stock.id)
    from public.scheduled_meals meal cross join lateral jsonb_array_elements(meal.recipes) recipe
    join public.inventory_entries stock on stock.owner_id=meal.owner_id
      and stock.id::text=lower(recipe->'inventory'->>'itemId')
      and stock.place_id::text=lower(recipe->'inventory'->>'placeId')
      and lower(stock.entry->>'recipeId')=lower(recipe->>'recipeId')
    where meal.owner_id=auth.uid() and meal.meal_date>=p_from
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.valid_scheduled_inventory_source(jsonb),public.valid_scheduled_recipes(jsonb),public.save_scheduled_day(date,jsonb),public.get_inventory_planning_links(date) from public,anon,authenticated;
grant execute on function public.valid_scheduled_inventory_source(jsonb),public.valid_scheduled_recipes(jsonb),public.save_scheduled_day(date,jsonb),public.get_inventory_planning_links(date) to authenticated;
notify pgrst,'reload schema';
commit;
