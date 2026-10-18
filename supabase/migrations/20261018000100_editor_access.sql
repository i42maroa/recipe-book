-- Apply AFTER the schema, servings and photos migrations. No recipe data is deleted.
begin;

-- Membership is administered only from SQL Editor / a trusted backend.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.recipe_editors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.recipe_editors enable row level security;
revoke all on private.recipe_editors from public, anon, authenticated;

-- This RPC only answers whether the caller is a member; it accepts no user ID.
create or replace function public.is_recipe_editor() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.recipe_editors
    where user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_recipe_editor() from public;
grant execute on function public.is_recipe_editor() to anon, authenticated;

-- Replace old permissive policies, including anon_all. Cover the MVP and any
-- optional tables already created from DB.md. Future tables need their own RLS.
do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'recipes', 'ingredients', 'recipe_ingredients', 'recipe_steps',
    'ingredient_components', 'cuisine_types', 'recipe_cuisine_types',
    'recipe_photos', 'weekly_plans', 'weekly_plan_items',
    'shopping_lists', 'shopping_list_items', 'ingredient_nutrients'
  ] loop
    if to_regclass(format('public.%I', t)) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    -- Remove TRUNCATE/REFERENCES/TRIGGER as well as old write grants.
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy public_read on public.%I for select to anon, authenticated using (true)', t);
    execute format('create policy editor_insert on public.%I for insert to authenticated with check ((select public.is_recipe_editor()))', t);
    execute format('create policy editor_update on public.%I for update to authenticated using ((select public.is_recipe_editor())) with check ((select public.is_recipe_editor()))', t);
    execute format('create policy editor_delete on public.%I for delete to authenticated using ((select public.is_recipe_editor()))', t);
  end loop;
end $$;

-- Transactional saves remain SECURITY INVOKER so every statement obeys RLS.
alter function public.save_recipe(uuid, jsonb) security invoker;
alter function public.save_ingredient(uuid, text, text, jsonb) security invoker;
revoke all on function public.save_recipe(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.save_ingredient(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_recipe(uuid, jsonb) to authenticated;
grant execute on function public.save_ingredient(uuid, text, text, jsonb) to authenticated;

-- Public image URLs remain public; file writes require membership.
drop policy if exists recipe_photos_public_upload on storage.objects;
drop policy if exists recipe_photos_public_delete on storage.objects;
create policy recipe_photos_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'recipe-photos');
create policy recipe_photos_editor_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'recipe-photos' and (select public.is_recipe_editor()));
create policy recipe_photos_editor_update on storage.objects
  for update to authenticated
  using (bucket_id = 'recipe-photos' and (select public.is_recipe_editor()))
  with check (bucket_id = 'recipe-photos' and (select public.is_recipe_editor()));
create policy recipe_photos_editor_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'recipe-photos' and (select public.is_recipe_editor()));

-- Restrictive policies prevent other permissive Storage policies from granting
-- writes to this bucket. Other buckets retain their existing access rules.
create policy recipe_photos_write_guard_insert on storage.objects as restrictive
  for insert to anon, authenticated
  with check (bucket_id <> 'recipe-photos' or (select public.is_recipe_editor()));
create policy recipe_photos_write_guard_update on storage.objects as restrictive
  for update to anon, authenticated
  using (bucket_id <> 'recipe-photos' or (select public.is_recipe_editor()))
  with check (bucket_id <> 'recipe-photos' or (select public.is_recipe_editor()));
create policy recipe_photos_write_guard_delete on storage.objects as restrictive
  for delete to anon, authenticated
  using (bucket_id <> 'recipe-photos' or (select public.is_recipe_editor()));

commit;
