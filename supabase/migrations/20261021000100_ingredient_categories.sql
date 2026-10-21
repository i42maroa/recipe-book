begin;

alter table public.ingredients
  drop constraint if exists ingredients_category_check;
alter table public.ingredients
  add constraint ingredients_category_check check (category in (
    'Verdura','Fruta','Legumbre','Pescado','Carne','Lacteo','Cereal',
    'Liquidos','FrutosSecos','Especia','Elaboracion','Otro'
  ));

-- Shopping lists store category snapshots and must accept the new categories too.
create or replace function public.valid_shopping_items(p_items jsonb)
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
      or item->>'category' not in ('Verdura','Fruta','Legumbre','Pescado','Carne','Lacteo','Cereal','Liquidos','FrutosSecos','Especia','Elaboracion','Otro')
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

notify pgrst, 'reload schema';
commit;
