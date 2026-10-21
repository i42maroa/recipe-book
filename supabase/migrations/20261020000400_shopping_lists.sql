begin;

create function public.valid_shopping_items(p_items jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then return false; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'id') is distinct from 'string'
      or item->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'name') is distinct from 'string' or btrim(item->>'name') = ''
      or jsonb_typeof(item->'category') is distinct from 'string'
      or item->>'category' not in ('Verdura','Fruta','Legumbre','Pescado','Carne','Lacteo','Cereal','Especia','Elaboracion','Otro')
      or jsonb_typeof(item->'occurrences') is distinct from 'number'
      or item->>'occurrences' !~ '^[0-9]+$'
      or (item->>'occurrences')::numeric not between 1 and 2147483647 then return false; end if;
  end loop;
  return not exists (select 1 from jsonb_array_elements(p_items) e group by lower(e->>'id') having count(*) > 1);
exception when others then return false;
end;
$$;
revoke all on function public.valid_shopping_items(jsonb) from public, anon, authenticated;
grant execute on function public.valid_shopping_items(jsonb) to authenticated;

create table public.shopping_lists (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  items jsonb not null default '[]'::jsonb check (public.valid_shopping_items(items)),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);
alter table public.shopping_lists enable row level security;
revoke all on public.shopping_lists from public, anon, authenticated;
grant select, insert, update on public.shopping_lists to authenticated;
create policy shopping_lists_owner_editor on public.shopping_lists for all to authenticated
using (owner_id = (select auth.uid()) and (select public.is_recipe_editor()))
with check (owner_id = (select auth.uid()) and (select public.is_recipe_editor()));

create function public.save_shopping_list(p_items jsonb, p_expected_version bigint)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare saved_version bigint;
begin
  if auth.uid() is null or not public.is_recipe_editor() then
    raise exception 'Necesitas pertenecer al grupo de editores.' using errcode = '42501';
  end if;
  if not public.valid_shopping_items(p_items) or p_expected_version is null or p_expected_version < 0 then
    raise exception 'La lista de la compra no es válida.' using errcode = '22023';
  end if;
  if p_expected_version = 0 then
    insert into public.shopping_lists(owner_id, items) values (auth.uid(), p_items)
      on conflict (owner_id) do nothing returning version into saved_version;
  else
    update public.shopping_lists set items = p_items, version = version + 1, updated_at = now()
      where owner_id = auth.uid() and version = p_expected_version returning version into saved_version;
  end if;
  if saved_version is null then
    raise exception 'La lista ha cambiado en otra pestaña o dispositivo. Carga la lista guardada antes de volver a guardar.' using errcode = '40001';
  end if;
  return saved_version;
end;
$$;

-- Count each planned recipe occurrence, regardless of portions or preparation
-- mode. An elaboration remains an ingredient; its components are not expanded.
create function public.shopping_ingredients_from_plan(p_from date, p_to date)
returns table(id uuid, name text, category text, occurrences bigint)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_recipe_editor() then
    raise exception 'Necesitas pertenecer al grupo de editores.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'El intervalo de fechas no es válido.' using errcode = '22023';
  end if;
  return query
    select i.id, i.name, i.category, count(*)
    from public.scheduled_meals m
    cross join lateral jsonb_array_elements(m.recipes) entry
    join public.recipe_ingredients ri on ri.recipe_id = (entry->>'recipeId')::uuid
    join public.ingredients i on i.id = ri.ingredient_id
    where m.owner_id = auth.uid() and m.meal_date between p_from and p_to
    group by i.id, i.name, i.category;
end;
$$;
revoke all on function public.save_shopping_list(jsonb, bigint) from public, anon, authenticated;
revoke all on function public.shopping_ingredients_from_plan(date, date) from public, anon, authenticated;
grant execute on function public.save_shopping_list(jsonb, bigint) to authenticated;
grant execute on function public.shopping_ingredients_from_plan(date, date) to authenticated;
notify pgrst, 'reload schema';

commit;
