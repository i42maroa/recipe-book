create extension if not exists pgcrypto;

create table public.recipes (
  id uuid primary key default gen_random_uuid(), name text not null,
  minutes integer check (minutes is null or minutes >= 0), pending boolean not null,
  meal_types text[] not null default '{}', rating smallint check (rating is null or rating between 1 and 10),
  source_url text, annotations text, fitness boolean not null default false,
  difficulty text check (difficulty is null or difficulty in ('Fácil','Media','Difícil')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.ingredients (
  id uuid primary key default gen_random_uuid(), name text not null unique,
  category text not null check (category in ('Verdura','Fruta','Legumbre','Pescado','Carne','Lacteo','Cereal','Especia','Elaboracion','Otro')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.recipe_ingredients (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  amount_kind text not null check (amount_kind in ('none','spoon','glass','specific')),
  amount_value numeric check (amount_value is null or amount_value > 0),
  amount_unit text check (amount_unit is null or amount_unit in ('ml','g','pieza')),
  primary key (recipe_id, ingredient_id),
  check ((amount_kind='specific' and amount_value is not null and amount_unit is not null) or (amount_kind<>'specific' and amount_value is null and amount_unit is null))
);
create table public.recipe_steps (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  position integer not null check (position > 0), description text not null,
  primary key (recipe_id, position)
);
create table public.ingredient_components (
  parent_ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  component_ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  amount_kind text not null check (amount_kind in ('none','spoon','glass','specific')),
  amount_value numeric check (amount_value is null or amount_value > 0),
  amount_unit text check (amount_unit is null or amount_unit in ('ml','g','pieza')),
  primary key (parent_ingredient_id, component_ingredient_id), check (parent_ingredient_id <> component_ingredient_id),
  check ((amount_kind='specific' and amount_value is not null and amount_unit is not null) or (amount_kind<>'specific' and amount_value is null and amount_unit is null))
);
create table public.cuisine_types (id uuid primary key default gen_random_uuid(), name text not null unique);
create table public.recipe_cuisine_types (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  cuisine_type_id uuid not null references public.cuisine_types(id) on delete restrict,
  primary key (recipe_id, cuisine_type_id)
);
create index recipe_ingredients_by_ingredient on public.recipe_ingredients(ingredient_id, recipe_id);
create index recipes_by_pending on public.recipes(pending);

create or replace function public.save_recipe(p_id uuid, p_recipe jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare rid uuid := coalesce(p_id, gen_random_uuid()); item jsonb; amount jsonb; cuisine text;
begin
  if jsonb_array_length(coalesce(p_recipe->'ingredientIds','[]'::jsonb)) = 0 then raise exception 'La receta requiere ingredientes'; end if;
  insert into public.recipes(id,name,minutes,pending,meal_types,rating,source_url,annotations,fitness,difficulty,updated_at)
  values(rid,p_recipe->>'name',nullif(p_recipe->>'minutes','')::integer,(p_recipe->>'pending')::boolean,
    array(select jsonb_array_elements_text(coalesce(p_recipe->'mealTypes','[]'::jsonb))),nullif(p_recipe->>'rating','')::smallint,
    nullif(p_recipe->>'sourceUrl',''),nullif(p_recipe->>'annotations',''),coalesce((p_recipe->>'fitness')::boolean,false),p_recipe->>'difficulty',now())
  on conflict(id) do update set name=excluded.name,minutes=excluded.minutes,pending=excluded.pending,meal_types=excluded.meal_types,
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

create or replace function public.save_ingredient(p_id uuid,p_name text,p_category text,p_components jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare iid uuid := coalesce(p_id,gen_random_uuid()); item jsonb;
begin
  insert into public.ingredients(id,name,category,updated_at) values(iid,trim(p_name),p_category,now())
  on conflict(id) do update set name=trim(p_name),category=p_category,updated_at=now();
  delete from public.ingredient_components where parent_ingredient_id=iid;
  for item in select value from jsonb_array_elements(coalesce(p_components,'[]'::jsonb)) loop
    insert into public.ingredient_components(parent_ingredient_id,component_ingredient_id,amount_kind,amount_value,amount_unit)
    values(iid,(item->>'ingredient_id')::uuid,coalesce(item->>'kind','none'),nullif(item->>'value','')::numeric,item->>'unit');
  end loop;
  return iid;
end $$;

-- MVP sin autenticación: cualquier visitante con la clave pública puede leer y modificar estos datos.
-- Añadir autenticación y políticas por usuario antes de usar con datos que deban ser privados.
alter table public.recipes enable row level security;
alter table public.ingredients enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_steps enable row level security;
alter table public.ingredient_components enable row level security;
alter table public.cuisine_types enable row level security;
alter table public.recipe_cuisine_types enable row level security;
do $$ declare t text; begin
  foreach t in array array['recipes','ingredients','recipe_ingredients','recipe_steps','ingredient_components','cuisine_types','recipe_cuisine_types'] loop
    execute format('create policy anon_all on public.%I for all to anon using (true) with check (true)',t);
    execute format('grant select, insert, update, delete on public.%I to anon',t);
  end loop;
end $$;
grant execute on function public.save_recipe(uuid,jsonb) to anon;
grant execute on function public.save_ingredient(uuid,text,text,jsonb) to anon;
