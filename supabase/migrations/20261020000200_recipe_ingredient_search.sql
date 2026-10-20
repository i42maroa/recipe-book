begin;

-- Return the recipes relation so PostgREST can embed the usual card fields.
-- Rank before pagination; keep RLS and use the selected sort to break ties.
create or replace function public.search_recipes_by_ingredients(p_ingredient_ids uuid[], p_sort text default 'recent')
returns setof public.recipes
language sql stable security invoker set search_path = '' as $$
  select r.*
  from public.recipes r
  join (
    select ri.recipe_id, count(distinct ri.ingredient_id) as matches
    from public.recipe_ingredients ri
    where ri.ingredient_id = any(p_ingredient_ids)
    group by ri.recipe_id
  ) matched on matched.recipe_id = r.id
  order by matched.matches desc,
    case when p_sort = 'name' then r.name end asc,
    case when p_sort = 'rating' then r.rating end desc nulls last,
    case when p_sort = 'time' then r.minutes end asc nulls last,
    case when p_sort not in ('name', 'rating', 'time') then r.created_at end desc,
    r.id;
$$;

revoke all on function public.search_recipes_by_ingredients(uuid[], text) from public, anon, authenticated;
grant execute on function public.search_recipes_by_ingredients(uuid[], text) to anon, authenticated;

commit;
