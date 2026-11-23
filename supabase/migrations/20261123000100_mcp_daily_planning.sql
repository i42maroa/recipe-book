begin;

-- Read meals and their version from a single snapshot. Version is an opaque
-- concurrency token, not an authentication credential.
create function public.get_mcp_scheduled_day(p_date date) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare meals jsonb;
begin
  if auth.uid() is null or not public.is_recipe_editor() then
    raise exception 'Necesitas una sesión autorizada.' using errcode = '42501';
  end if;
  if p_date is null then raise exception 'Fecha no válida.' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('slot', slot, 'servings', servings, 'recipes', recipes) order by slot), '[]'::jsonb)
    into meals from public.scheduled_meals where owner_id = auth.uid() and meal_date = p_date;
  return jsonb_build_object('date', p_date, 'meals', meals, 'version', md5(meals::text));
end;
$$;

create function public.save_mcp_scheduled_day(p_date date, p_meals jsonb, p_expected_version text) returns void
language plpgsql security invoker set search_path = '' as $$
declare current_day jsonb;
begin
  if auth.uid() is null or not public.is_recipe_editor() then
    raise exception 'Necesitas una sesión autorizada.' using errcode = '42501';
  end if;
  if p_date is null or p_expected_version is null then raise exception 'Fecha o versión no válida.' using errcode = '22023'; end if;
  -- Same lock as the web's save_scheduled_day and add_scheduled_recipe.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text || ':' || p_date::text, 0));
  current_day := public.get_mcp_scheduled_day(p_date);
  if current_day->>'version' is distinct from p_expected_version then
    raise exception 'El día ha cambiado.' using errcode = 'PT409';
  end if;
  -- Inventory is outside this first version. Never silently discard its links.
  if exists (select 1 from jsonb_array_elements(current_day->'meals') meal,
      lateral jsonb_array_elements(meal->'recipes') recipe where recipe ? 'inventory') then
    raise exception 'Gestiona los días con inventario desde Laurel.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_meals) meal,
      lateral jsonb_array_elements(meal->'recipes') recipe
      where not exists (select 1 from public.recipes r where r.id = (recipe->>'recipeId')::uuid)) then
    raise exception 'Alguna receta ya no existe.' using errcode = '23503';
  end if;
  perform public.save_scheduled_day(p_date, p_meals);
end;
$$;

revoke all on function public.get_mcp_scheduled_day(date), public.save_mcp_scheduled_day(date,jsonb,text) from public,anon,authenticated;
grant execute on function public.get_mcp_scheduled_day(date), public.save_mcp_scheduled_day(date,jsonb,text) to authenticated;
commit;
