begin;

-- Inventory searches require every selected ingredient, before counting/paging.
-- Return the recipes relation so PostgREST retains card embeds and RLS.
create function public.search_recipes_with_all_ingredients(p_ingredient_ids uuid[], p_sort text default 'recent')
returns setof public.recipes
language sql stable security invoker set search_path = '' as $$
  select r.* from public.recipes r
  where cardinality(p_ingredient_ids)>0
    and not exists (
      select 1 from unnest(p_ingredient_ids) ingredient(id)
      where ingredient.id is null or not exists (
        select 1 from public.recipe_ingredients ri where ri.recipe_id=r.id and ri.ingredient_id=ingredient.id
      )
    )
  order by case when p_sort='name' then r.name end asc,
    case when p_sort='rating' then r.rating end desc nulls last,
    case when p_sort='time' then r.minutes end asc nulls last,
    case when p_sort not in ('name','rating','time') then r.created_at end desc,
    r.id;
$$;

revoke all on function public.search_recipes_with_all_ingredients(uuid[],text) from public,anon,authenticated;
grant execute on function public.search_recipes_with_all_ingredients(uuid[],text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
