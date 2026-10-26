begin;

-- Append one recipe to the latest stored meal. Share save_scheduled_day's lock
-- so this operation never replaces another slot or a concurrent addition.
create function public.add_scheduled_recipe(p_date date, p_slot text, p_servings integer, p_recipe_id uuid, p_mode text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  current_meal public.scheduled_meals%rowtype;
  was_added boolean := false;
begin
  if auth.uid() is null or not public.is_recipe_editor() then
    raise exception 'Necesitas pertenecer al grupo de editores.' using errcode = '42501';
  end if;
  if p_date is null or p_date < date '0001-01-01' or p_date > date '9999-12-31'
    or p_slot is null or p_slot not in ('breakfast', 'lunch', 'dinner')
    or p_servings is null or p_servings not between 1 and 100
    or p_recipe_id is null or p_mode is null or p_mode not in ('scale', 'leftovers') then
    raise exception 'Revisa la fecha, la comida, los comensales y la preparación.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text || ':' || p_date::text, 0));
  perform 1 from public.recipes where id = p_recipe_id for key share;
  if not found then raise exception 'La receta ya no está disponible.' using errcode = '22023'; end if;

  select * into current_meal from public.scheduled_meals
    where owner_id = auth.uid() and meal_date = p_date and slot = p_slot for update;
  if not found then
    insert into public.scheduled_meals(owner_id, meal_date, slot, servings, recipes)
    values (auth.uid(), p_date, p_slot, p_servings, jsonb_build_array(jsonb_build_object('recipeId', p_recipe_id, 'mode', p_mode)))
    returning * into current_meal;
    was_added := true;
  elsif not exists (select 1 from jsonb_array_elements(current_meal.recipes) item where lower(item->>'recipeId') = p_recipe_id::text) then
    if current_meal.servings <> p_servings then
      raise exception 'Los comensales de esta comida han cambiado. Actualiza la comida antes de añadir la receta.' using errcode = '40001';
    end if;
    if jsonb_array_length(current_meal.recipes) >= 5 then
      raise exception 'Esta comida ya contiene el máximo de cinco recetas. Actualiza la comida o elige otra.' using errcode = '22023';
    end if;
    update public.scheduled_meals set recipes = recipes || jsonb_build_array(jsonb_build_object('recipeId', p_recipe_id, 'mode', p_mode)), updated_at = now()
      where owner_id = auth.uid() and meal_date = p_date and slot = p_slot returning * into current_meal;
    was_added := true;
  end if;
  -- Duplicate requests (including retries after a lost response) do not mutate the meal.
  return jsonb_build_object('added', was_added, 'meal', jsonb_build_object('date', current_meal.meal_date,
    'slot', current_meal.slot, 'servings', current_meal.servings, 'recipes', current_meal.recipes));
end;
$$;
revoke all on function public.add_scheduled_recipe(date, text, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.add_scheduled_recipe(date, text, integer, uuid, text) to authenticated;
notify pgrst, 'reload schema';
commit;
