begin;

-- Keep cleanup durable: Storage is external to PostgreSQL transactions.
create table public.recipe_photo_cleanup (
  storage_path text primary key,
  created_at timestamptz not null default now()
);
alter table public.recipe_photo_cleanup enable row level security;
create policy recipe_photo_cleanup_editor on public.recipe_photo_cleanup
  for all to authenticated
  using ((select public.is_recipe_editor()))
  with check ((select public.is_recipe_editor()));
grant select, insert, delete on public.recipe_photo_cleanup to authenticated;

create function public.sync_recipe_photos(p_recipe_id uuid, p_expected jsonb, p_photos jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  current_photos jsonb;
  photo jsonb;
begin
  if auth.uid() is null or not public.is_recipe_editor() then
    raise exception 'Necesitas pertenecer al grupo de editores.' using errcode = '42501';
  end if;
  perform 1 from public.recipes where id = p_recipe_id for update;
  if not found then raise exception 'La receta ya no existe.' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'storage_path', storage_path,
    'position', position, 'alt_text', alt_text) order by position), '[]'::jsonb)
  into current_photos from public.recipe_photos where recipe_id = p_recipe_id;
  if current_photos is distinct from p_expected then
    raise exception 'Las fotos han cambiado. Vuelve a cargar la receta antes de guardarlas.' using errcode = '40001';
  end if;
  if jsonb_typeof(p_photos) is distinct from 'array' then
    raise exception 'Las fotos no son válidas.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_photos) > 3 then
    raise exception 'Puedes guardar como máximo 3 fotos por receta.' using errcode = '22023';
  end if;
  for photo in select value from jsonb_array_elements(p_photos) loop
    if jsonb_typeof(photo) is distinct from 'object'
      or jsonb_typeof(photo->'storage_path') is distinct from 'string'
      or photo->>'storage_path' not like p_recipe_id::text || '/%'
      or (photo->>'storage_path') = p_recipe_id::text || '/'
      or photo->>'storage_path' like '%/../%'
      or (photo->>'position')::integer not between 1 and 3 then
      raise exception 'Los datos de las fotos no son válidos.' using errcode = '22023';
    end if;
    -- Retained IDs must still identify the same file on this recipe.
    if photo->>'id' is not null and not exists (
      select 1 from public.recipe_photos where recipe_id = p_recipe_id
        and id = (photo->>'id')::uuid and storage_path = photo->>'storage_path'
    ) then
      raise exception 'Una foto seleccionada ya no está disponible.' using errcode = '40001';
    end if;
    -- Never allow a file already queued for deletion to become referenced again.
    if exists (select 1 from public.recipe_photo_cleanup where storage_path = photo->>'storage_path') then
      raise exception 'Una foto seleccionada ya no está disponible.' using errcode = '40001';
    end if;
  end loop;

  insert into public.recipe_photo_cleanup(storage_path)
    select storage_path from public.recipe_photos old where recipe_id = p_recipe_id
      and not exists (select 1 from jsonb_array_elements(p_photos) new where new->>'storage_path' = old.storage_path)
    on conflict do nothing;
  delete from public.recipe_photos where recipe_id = p_recipe_id;
  insert into public.recipe_photos(id, recipe_id, storage_path, position, alt_text)
    select coalesce((item->>'id')::uuid, gen_random_uuid()), p_recipe_id,
      item->>'storage_path', (item->>'position')::integer, item->>'alt_text'
    from jsonb_array_elements(p_photos) item;
end;
$$;

create function public.delete_recipe_with_photos(p_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_recipe_editor() then
    raise exception 'Necesitas pertenecer al grupo de editores.' using errcode = '42501';
  end if;
  perform 1 from public.recipes where id = p_id for update;
  -- A lost response may hide a committed deletion. Retrying remains safe and
  -- allows the browser to invalidate its caches and retry the cleanup queue.
  if not found then return p_id; end if;
  insert into public.recipe_photo_cleanup(storage_path)
    select storage_path from public.recipe_photos where recipe_id = p_id on conflict do nothing;
  delete from public.recipes where id = p_id;
  return p_id;
end;
$$;

revoke all on function public.sync_recipe_photos(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.delete_recipe_with_photos(uuid) from public, anon, authenticated;
grant execute on function public.sync_recipe_photos(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.delete_recipe_with_photos(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
