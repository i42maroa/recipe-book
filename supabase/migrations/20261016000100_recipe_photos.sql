-- Recipe images are stored in Supabase Storage; PostgreSQL stores their order and paths.
create table if not exists public.recipe_photos (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  storage_path text not null,
  position integer not null check (position between 1 and 3),
  alt_text text,
  created_at timestamptz not null default now(),
  unique (recipe_id, position)
);

alter table public.recipe_photos drop constraint if exists recipe_photos_position_check;
alter table public.recipe_photos add constraint recipe_photos_position_check
  check (position between 1 and 3);
create unique index if not exists recipe_photos_storage_path_uidx
  on public.recipe_photos(storage_path);

alter table public.recipe_photos enable row level security;
drop policy if exists recipe_photos_anon_all on public.recipe_photos;
create policy recipe_photos_anon_all on public.recipe_photos
  for all to anon using (true) with check (true);
grant select, insert, update, delete on public.recipe_photos to anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recipe-photos',
  'recipe-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists recipe_photos_public_upload on storage.objects;
create policy recipe_photos_public_upload on storage.objects
  for insert to anon with check (bucket_id = 'recipe-photos');

drop policy if exists recipe_photos_public_delete on storage.objects;
create policy recipe_photos_public_delete on storage.objects
  for delete to anon using (bucket_id = 'recipe-photos');
