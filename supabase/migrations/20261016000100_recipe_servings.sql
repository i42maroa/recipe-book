alter table public.recipes
  add column if not exists servings integer
  check (servings is null or servings >= 1);

create or replace function public.save_recipe(p_id uuid, p_recipe jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare rid uuid := coalesce(p_id, gen_random_uuid()); item jsonb; amount jsonb; cuisine text;
begin
  if jsonb_array_length(coalesce(p_recipe->'ingredientIds','[]'::jsonb)) = 0 then raise exception 'La receta requiere ingredientes'; end if;
  insert into public.recipes(id,name,minutes,servings,pending,meal_types,rating,source_url,annotations,fitness,difficulty,updated_at)
  values(rid,p_recipe->>'name',nullif(p_recipe->>'minutes','')::integer,nullif(p_recipe->>'servings','')::integer,(p_recipe->>'pending')::boolean,
    array(select jsonb_array_elements_text(coalesce(p_recipe->'mealTypes','[]'::jsonb))),nullif(p_recipe->>'rating','')::smallint,
    nullif(p_recipe->>'sourceUrl',''),nullif(p_recipe->>'annotations',''),coalesce((p_recipe->>'fitness')::boolean,false),p_recipe->>'difficulty',now())
  on conflict(id) do update set name=excluded.name,minutes=excluded.minutes,servings=excluded.servings,pending=excluded.pending,meal_types=excluded.meal_types,
    rating=excluded.rating,source_url=excluded.source_url,annotations=excluded.annotations,fitness=excluded.fitness,difficulty=excluded.difficulty,updated_at=now();
  delete from public.recipe_ingredients where recipe_id=rid;
  for item in select value from jsonb_array_elements(coalesce(p_recipe->'ingredientIds','[]'::jsonb)) loop
    amount := coalesce(p_recipe->'ingredientAmounts'->(item#>>'{}'), '{}'::jsonb);
    insert into public.recipe_ingredients(recipe_id,ingredient_id,amount_kind,amount_value,amount_unit)
    values(rid,(item#>>'{}')::uuid,coalesce(amount->>'kind','none'),nullif(amount->>'value','')::numeric,amount->>'unit');
  end loop;
  delete from public.recipe_steps where recipe_id=rid;
  insert into public.recipe_steps(recipe_id,position,description)
    select rid,ordinality,value from jsonb_array_elements_text(coalesce(p_recipe->'steps','[]'::jsonb)) with ordinality;
  delete from public.recipe_cuisine_types where recipe_id=rid;
  for cuisine in select jsonb_array_elements_text(coalesce(p_recipe->'cuisineTypes','[]'::jsonb)) loop
    insert into public.cuisine_types(name) values(cuisine) on conflict(name) do nothing;
    insert into public.recipe_cuisine_types(recipe_id,cuisine_type_id) select rid,id from public.cuisine_types where name=cuisine;
  end loop;
  return rid;
end $$;
