begin;

-- Preserve legacy snapshots; new lists carry explicit quantities rather than counts.
create or replace function public.valid_shopping_items(p_items jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item jsonb; amount jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then return false; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'id') is distinct from 'string' or item->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'name') is distinct from 'string' or item->>'name' !~ '\S'
      or item->>'category' not in ('Verdura','Fruta','Legumbre','Pescado','Carne','Lacteo','Cereal','Liquidos','FrutosSecos','Especia','Elaboracion','Otro')
      or jsonb_typeof(item->'category') is distinct from 'string'
      or jsonb_typeof(item->'occurrences') is distinct from 'number' or item->>'occurrences' !~ '^[0-9]+$'
      or (item->>'occurrences')::numeric not between 1 and 2147483647 then return false; end if;
    if item ? 'amounts' then
      if jsonb_typeof(item->'amounts') is distinct from 'array' or jsonb_array_length(item->'amounts')>32 then return false; end if;
      for amount in select value from jsonb_array_elements(item->'amounts') loop
        if amount='null'::jsonb or not public.valid_measured_amount(amount) then return false; end if;
      end loop;
    end if;
    if item ? 'unquantified' and (jsonb_typeof(item->'unquantified') is distinct from 'number'
      or item->>'unquantified' !~ '^[0-9]+$' or (item->>'unquantified')::numeric>9007199254740991) then return false; end if;
    if item ? 'notes' then
      if jsonb_typeof(item->'notes') is distinct from 'array' then return false; end if;
      if exists(select 1 from jsonb_array_elements(item->'notes') note where jsonb_typeof(note)<>'string' or length(note#>>'{}')>500) then return false; end if;
    end if;
  end loop;
  return not exists(select 1 from jsonb_array_elements(p_items) e group by lower(e->>'id') having count(*)>1);
exception when others then return false;
end;
$$;

create function public.shopping_plan_amounts(p_from date,p_to date)
returns table(source text,id uuid,name text,category text,base_unit text,unit_quantity numeric,amount jsonb,factor numeric,missing_servings boolean)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_recipe_editor() then raise exception 'Necesitas pertenecer al grupo de editores.' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_from>p_to then raise exception 'El intervalo de fechas no es válido.' using errcode='22023'; end if;
  return query select m.meal_date::text || ':' || m.slot || ':' || r.id::text || ':' || i.id::text,
    i.id,i.name,i.category,i.base_unit,i.unit_quantity,
    case when ri.amount_kind='none' then null::jsonb else public.measured_amount_json(ri.amount_kind,ri.amount_value,ri.amount_unit,ri.amount_base_unit,ri.amount_unit_quantity) end,
    case when r.servings is null then 1::numeric
      when entry->>'mode'='leftovers' then ceil(m.servings::numeric/r.servings)
      else m.servings::numeric/r.servings end,
    r.servings is null
  from public.scheduled_meals m cross join lateral jsonb_array_elements(m.recipes) entry
  join public.recipes r on r.id=(entry->>'recipeId')::uuid
  join public.recipe_ingredients ri on ri.recipe_id=r.id join public.ingredients i on i.id=ri.ingredient_id
  where m.owner_id=auth.uid() and m.meal_date between p_from and p_to and not (entry ? 'inventory');
end;
$$;

create table public.shopping_purchases (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  operation_id uuid not null,
  request jsonb not null,
  result_version bigint not null,
  created_at timestamptz not null default now(),
  primary key(owner_id,operation_id)
);
alter table public.shopping_purchases enable row level security;
revoke all on public.shopping_purchases from public,anon,authenticated;
grant select,insert on public.shopping_purchases to authenticated;
create policy shopping_purchases_owner_editor on public.shopping_purchases for all to authenticated
using(owner_id=(select auth.uid()) and (select public.is_recipe_editor()))
with check(owner_id=(select auth.uid()) and (select public.is_recipe_editor()));

create function public.complete_shopping_purchase(p_operation_id uuid,p_expected_version bigint,p_items jsonb,p_place_id uuid,p_date date)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare request_data jsonb; receipt public.shopping_purchases; current_version bigint; saved_version bigint; item jsonb; amount jsonb; lot_id uuid; stock jsonb;
begin
  if auth.uid() is null or not public.is_recipe_editor() then raise exception 'Necesitas pertenecer al grupo de editores.' using errcode='42501'; end if;
  if p_operation_id is null or p_expected_version is null or p_expected_version<0 or p_date is null or p_place_id is null
    or not public.valid_shopping_items(p_items) then raise exception 'La compra no es válida.' using errcode='22023'; end if;
  request_data:=jsonb_build_object('version',p_expected_version,'items',p_items,'place',p_place_id,'date',p_date);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text || ':shopping-purchase',0));
  select * into receipt from public.shopping_purchases where owner_id=auth.uid() and operation_id=p_operation_id;
  if found then
    if receipt.request is distinct from request_data then raise exception 'El identificador de compra ya se ha utilizado.' using errcode='22023'; end if;
    return receipt.result_version;
  end if;
  if jsonb_array_length(p_items)=0 then raise exception 'La lista está vacía.' using errcode='22023'; end if;
  perform 1 from public.inventory_places where owner_id=auth.uid() and id=p_place_id for key share;
  if not found then raise exception 'El lugar ya no está disponible.' using errcode='22023'; end if;
  select version into current_version from public.shopping_lists where owner_id=auth.uid() for update;
  if coalesce(current_version,0)<>p_expected_version then raise exception 'La lista ha cambiado. Carga la lista guardada antes de registrar la compra.' using errcode='40001'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if not (item ? 'amounts') or jsonb_array_length(item->'amounts')=0 or coalesce((item->>'unquantified')::numeric,0)>0 then
      raise exception 'Indica todas las cantidades antes de registrar la compra.' using errcode='22023'; end if;
    for amount in select value from jsonb_array_elements(item->'amounts') loop
      if amount->>'kind'='glass' then raise exception 'Revisa las cantidades antiguas en vasos.' using errcode='22023'; end if;
      lot_id:=gen_random_uuid();
      stock:=jsonb_build_object('id',lot_id,'ingredientId',item->>'id','recipeId',null,'servings',null,'name',item->>'name',
        'category',item->>'category','amount',amount,'space','pantry','enteredOn',p_date::text,'arrivedOn',p_date::text);
      insert into public.inventory_entries(owner_id,place_id,id,entry) values(auth.uid(),p_place_id,lot_id,stock);
    end loop;
  end loop;
  saved_version:=public.save_shopping_list('[]'::jsonb,p_expected_version);
  insert into public.shopping_purchases(owner_id,operation_id,request,result_version) values(auth.uid(),p_operation_id,request_data,saved_version);
  return saved_version;
end;
$$;

revoke all on function public.shopping_plan_amounts(date,date),public.complete_shopping_purchase(uuid,bigint,jsonb,uuid,date) from public,anon,authenticated;
grant execute on function public.shopping_plan_amounts(date,date),public.complete_shopping_purchase(uuid,bigint,jsonb,uuid,date) to authenticated;
notify pgrst,'reload schema';
commit;
