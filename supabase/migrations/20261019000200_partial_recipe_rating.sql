-- Apply after editor_access and recipe_query_optimization, before deploying the front.
begin;

-- Rate without replacing ingredients, steps, cuisines, photos or other scalar fields.
create or replace function public.rate_recipe(p_id uuid, p_rating integer)
returns table(id uuid, rating smallint, pending boolean, stats_changed boolean)
language plpgsql security invoker set search_path = '' as $$
declare
  previous_pending boolean;
  saved_rating smallint;
begin
  if not public.is_recipe_editor() then
    raise exception 'Necesitas pertenecer al grupo de editores.' using errcode = '42501';
  end if;
  if p_rating is null or p_rating not between 1 and 10 then
    raise exception 'La valoración debe ser un entero del 1 al 10.' using errcode = '22023';
  end if;

  -- Lock so stats_changed reflects the committed previous state, even concurrently.
  select r.pending into previous_pending
  from public.recipes r where r.id = p_id for update;
  if not found then
    raise exception 'No se encontró la receta.' using errcode = 'P0002';
  end if;

  update public.recipes r
  set rating = p_rating::smallint, pending = false, updated_at = now()
  where r.id = p_id
  returning r.rating into saved_rating;
  if not found then
    raise exception 'No se pudo actualizar la receta.' using errcode = '42501';
  end if;
  return query select p_id, saved_rating, false, previous_pending;
end;
$$;

revoke all on function public.rate_recipe(uuid, integer) from public, anon, authenticated;
grant execute on function public.rate_recipe(uuid, integer) to authenticated;

commit;
