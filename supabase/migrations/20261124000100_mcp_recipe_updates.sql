begin;

-- Merge partial edits under the same recipe row lock used by save_recipe_optimized.
-- No upsert on an absent ID: this operation can only update an existing recipe.
create function public.update_mcp_recipe(p_id uuid, p_changes jsonb, p_expected_version timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  current_recipe public.recipes%rowtype;
  payload jsonb; ingredient_ids jsonb; amounts jsonb; amount_changes jsonb;
  field text; item jsonb; entry record; saved record; next_version timestamptz;
begin
  if auth.uid() is null or not public.is_recipe_editor() then
    raise exception 'Necesitas una sesión autorizada.' using errcode='42501';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'object' or p_changes='{}'::jsonb then
    raise exception 'Indica los cambios de la receta.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_changes) k where k not in
    ('name','ingredientIds','ingredientAmounts','minutes','servings','steps','pending','mealTypes',
     'cuisineTypes','rating','sourceUrl','annotations','fitness','difficulty')) then
    raise exception 'Campo de receta no permitido.' using errcode='22023';
  end if;
  select * into current_recipe from public.recipes where id=p_id for update;
  if not found then raise exception 'La receta no existe.' using errcode='P0002'; end if;
  if p_expected_version is null or current_recipe.updated_at is distinct from p_expected_version then
    raise exception 'La receta ha cambiado. Consúltala otra vez.' using errcode='PT409';
  end if;

  foreach field in array array['name','sourceUrl','annotations'] loop
    if p_changes ? field and jsonb_typeof(p_changes->field) is distinct from 'string' then
      raise exception 'Texto de receta no válido.' using errcode='22023';
    end if;
  end loop;
  if p_changes ? 'name' and length(trim(p_changes->>'name')) not between 1 and 200
    or p_changes ? 'annotations' and length(p_changes->>'annotations')>20000
    or p_changes ? 'sourceUrl' and p_changes->>'sourceUrl'<>'' and p_changes->>'sourceUrl' !~ '^https?://' then
    raise exception 'Texto de receta no válido.' using errcode='22023';
  end if;
  foreach field in array array['pending','fitness'] loop
    if p_changes ? field and jsonb_typeof(p_changes->field) is distinct from 'boolean' then
      raise exception 'Estado de receta no válido.' using errcode='22023';
    end if;
  end loop;
  foreach field in array array['minutes','servings','rating'] loop
    if p_changes ? field and p_changes->field <> 'null'::jsonb then
      if jsonb_typeof(p_changes->field) is distinct from 'number' then
        raise exception 'Número de receta no válido.' using errcode='22023';
      end if;
      if (p_changes->>field)::numeric <> trunc((p_changes->>field)::numeric)
        or (p_changes->>field)::numeric < 1
        or (p_changes->>field)::numeric > (case field when 'minutes' then 100000 when 'servings' then 10000 else 10 end) then
        raise exception 'Número de receta fuera de rango.' using errcode='22023';
      end if;
    end if;
  end loop;
  if p_changes ? 'difficulty' and p_changes->'difficulty'<>'null'::jsonb
    and (jsonb_typeof(p_changes->'difficulty')<>'string' or p_changes->>'difficulty' not in ('Fácil','Media','Difícil')) then
    raise exception 'Dificultad no válida.' using errcode='22023';
  end if;
  foreach field in array array['ingredientIds','steps','mealTypes','cuisineTypes'] loop
    if p_changes ? field then
      if jsonb_typeof(p_changes->field) is distinct from 'array' then
        raise exception 'Lista de receta no válida.' using errcode='22023';
      end if;
      if jsonb_array_length(p_changes->field)>(case field when 'mealTypes' then 4 when 'cuisineTypes' then 10 else 100 end) then
        raise exception 'Lista de receta demasiado larga.' using errcode='22023';
      end if;
      for item in select value from jsonb_array_elements(p_changes->field) loop
        if jsonb_typeof(item) is distinct from 'string' then
          raise exception 'Elemento de receta no válido.' using errcode='22023';
        end if;
        if field='steps' and length(trim(item#>>'{}')) not between 1 and 10000
          or field='mealTypes' and item#>>'{}' not in ('Desayuno','Entrante','Plato','Postre')
          or field='cuisineTypes' and item#>>'{}' not in ('Española','Italiana','Mexicana','Japonesa','China','India','Francesa','Peruana','Árabe','Otra') then
          raise exception 'Elemento de receta no válido.' using errcode='22023';
        end if;
      end loop;
    end if;
  end loop;

  select coalesce(jsonb_agg(ingredient_id::text order by ingredient_id),'[]'::jsonb),
    coalesce(jsonb_object_agg(ingredient_id::text,public.measured_amount_json(
      amount_kind,amount_value,amount_unit,amount_base_unit,amount_unit_quantity)),'{}'::jsonb)
    into ingredient_ids,amounts from public.recipe_ingredients where recipe_id=p_id;
  if p_changes ? 'ingredientIds' then
    select coalesce(jsonb_agg((value#>>'{}')::uuid::text order by ordinality),'[]'::jsonb)
      into ingredient_ids from jsonb_array_elements(p_changes->'ingredientIds') with ordinality;
  end if;
  if jsonb_array_length(ingredient_ids)=0 or
    (select count(distinct value) from jsonb_array_elements_text(ingredient_ids))<>jsonb_array_length(ingredient_ids) then
    raise exception 'Selecciona ingredientes sin duplicados.' using errcode='22023';
  end if;
  amount_changes := coalesce(p_changes->'ingredientAmounts','{}'::jsonb);
  if jsonb_typeof(amount_changes) is distinct from 'object' then
    raise exception 'Cantidades no válidas.' using errcode='22023';
  end if;
  for entry in select key,value from jsonb_each(amount_changes) loop
    if not (ingredient_ids ? entry.key::uuid::text) then
      raise exception 'Cantidad de un ingrediente no seleccionado.' using errcode='22023';
    end if;
    amounts := amounts || jsonb_build_object(entry.key::uuid::text,entry.value);
  end loop;

  payload := jsonb_build_object(
    'name',current_recipe.name,'minutes',current_recipe.minutes,'servings',current_recipe.servings,
    'pending',current_recipe.pending,'mealTypes',to_jsonb(current_recipe.meal_types),
    'rating',current_recipe.rating,'sourceUrl',current_recipe.source_url,'annotations',current_recipe.annotations,
    'fitness',current_recipe.fitness,'difficulty',current_recipe.difficulty,
    'steps',coalesce((select jsonb_agg(description order by position) from public.recipe_steps where recipe_id=p_id),'[]'::jsonb),
    'cuisineTypes',coalesce((select jsonb_agg(c.name order by c.name) from public.recipe_cuisine_types rc
      join public.cuisine_types c on c.id=rc.cuisine_type_id where rc.recipe_id=p_id),'[]'::jsonb)
  ) || p_changes || jsonb_build_object('ingredientIds',ingredient_ids,'ingredientAmounts',amounts);
  if (payload->>'pending')::boolean and payload->'rating'<>'null'::jsonb then
    raise exception 'Una receta pendiente no puede tener valoración.' using errcode='22023';
  end if;
  if p_changes ? 'name' then payload := jsonb_set(payload,'{name}',to_jsonb(trim(p_changes->>'name'))); end if;
  select * into saved from public.save_recipe_optimized(p_id,payload);
  -- Preserve microsecond precision and advance the version even inside a long transaction.
  update public.recipes set updated_at=greatest(clock_timestamp(),current_recipe.updated_at+interval '1 microsecond')
    where id=p_id returning updated_at into next_version;
  return jsonb_build_object('id',saved.id,'version',next_version,'stats_changed',saved.stats_changed);
end;
$$;
revoke all on function public.update_mcp_recipe(uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.update_mcp_recipe(uuid,jsonb,timestamptz) to authenticated;

commit;
