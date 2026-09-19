-- Raw materials and internally produced finished feed.
-- Migration 020 was applied locally during development, so this is intentionally forward-only.

create table public.raw_materials(
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  name text not null check(char_length(trim(name)) between 2 and 160),
  description text,
  default_unit text not null default 'kg' check(default_unit='kg'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id)
);
create unique index raw_materials_farm_name_uidx on public.raw_materials(farm_id,lower(name));
create index raw_materials_farm_active_idx on public.raw_materials(farm_id,is_active);

create table public.raw_material_inventory_movements(
  id uuid primary key default gen_random_uuid(), farm_id uuid not null references public.farms(id) on delete cascade,
  material_id uuid not null references public.raw_materials(id) on delete restrict,
  movement_date date not null, movement_type text not null check(movement_type in('opening_stock','purchase','production_consumption','adjustment','reversal')),
  direction text not null check(direction in('IN','OUT')), quantity_kg numeric(14,3) not null check(quantity_kg>0),
  unit_cost_snapshot numeric(14,4), total_cost_snapshot numeric(14,2), source_type text, source_id uuid, reason text, notes text,
  created_at timestamptz not null default now(), created_by uuid not null references public.profiles(id)
);
create index raw_material_movements_lookup_idx on public.raw_material_inventory_movements(farm_id,material_id,movement_date,created_at,id);
create index raw_material_movements_source_idx on public.raw_material_inventory_movements(source_type,source_id);

create table public.raw_material_inventory_balances(
  farm_id uuid not null references public.farms(id) on delete cascade, material_id uuid not null references public.raw_materials(id) on delete cascade,
  quantity_kg numeric(14,3) not null default 0, inventory_value numeric(14,2) not null default 0,
  weighted_average_cost numeric(14,4) not null default 0, updated_at timestamptz not null default now(), primary key(farm_id,material_id)
);

create table public.supplier_raw_materials(
  supplier_id uuid not null references public.suppliers(id) on delete cascade, material_id uuid not null references public.raw_materials(id) on delete cascade,
  created_at timestamptz not null default now(), created_by uuid not null references public.profiles(id), primary key(supplier_id,material_id)
);
create table public.supplier_feed_types(
  supplier_id uuid not null references public.suppliers(id) on delete cascade, feed_type_id uuid not null references public.feed_types(id) on delete cascade,
  created_at timestamptz not null default now(), created_by uuid not null references public.profiles(id), primary key(supplier_id,feed_type_id)
);
insert into public.supplier_feed_types(supplier_id,feed_type_id,created_by)
select s.id,x,s.created_by from public.suppliers s cross join lateral unnest(s.supplied_feed_type_ids) x on conflict do nothing;

create table public.raw_material_purchases(
  id uuid primary key default gen_random_uuid(), farm_id uuid not null references public.farms(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete restrict, material_id uuid not null references public.raw_materials(id) on delete restrict,
  purchase_number text not null, purchase_date date not null, quantity_kg numeric(14,3) not null check(quantity_kg>0),
  unit_cost numeric(14,4) not null check(unit_cost>=0), total_cost numeric(14,2) not null check(total_cost>=0),
  payment_terms_days integer check(payment_terms_days between 1 and 365), payment_due_date date check(payment_due_date is null or payment_due_date>=purchase_date),
  notes text, status text not null default 'completed' check(status in('completed','voided')),
  created_at timestamptz not null default now(), created_by uuid not null references public.profiles(id), updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id),
  unique(farm_id,purchase_number)
);
create index raw_material_purchases_farm_date_idx on public.raw_material_purchases(farm_id,purchase_date desc);
create index raw_material_purchases_material_date_idx on public.raw_material_purchases(material_id,purchase_date desc);
create index raw_material_purchases_supplier_due_idx on public.raw_material_purchases(farm_id,payment_due_date) where status='completed';

create table public.feed_recipes(
  id uuid primary key default gen_random_uuid(), farm_id uuid not null references public.farms(id) on delete cascade,
  feed_type_id uuid not null references public.feed_types(id) on delete restrict, effective_from date not null,
  effective_to date, basis_kg numeric(8,3) not null default 100 check(basis_kg=100), status text not null default 'active' check(status in('active','superseded')),
  notes text, created_at timestamptz not null default now(), created_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id), check(effective_to is null or effective_to>=effective_from), unique(feed_type_id,effective_from)
);
create index feed_recipes_effective_idx on public.feed_recipes(farm_id,feed_type_id,effective_from desc);
create table public.feed_recipe_items(
  id uuid primary key default gen_random_uuid(), recipe_id uuid not null references public.feed_recipes(id) on delete cascade,
  material_id uuid not null references public.raw_materials(id) on delete restrict, quantity_kg numeric(14,3) not null check(quantity_kg>0), unique(recipe_id,material_id)
);

create table public.feed_production_batches(
  id uuid primary key default gen_random_uuid(), farm_id uuid not null references public.farms(id) on delete cascade,
  feed_type_id uuid not null references public.feed_types(id) on delete restrict, recipe_id uuid not null references public.feed_recipes(id) on delete restrict,
  production_date date not null, planned_output_kg numeric(14,3) not null check(planned_output_kg>0), actual_output_kg numeric(14,3) not null check(actual_output_kg>0),
  total_input_kg numeric(14,3) not null check(total_input_kg>0), processing_loss_kg numeric(14,3) not null check(processing_loss_kg>=0),
  yield_percentage numeric(8,3) not null check(yield_percentage>0 and yield_percentage<=100), total_material_cost numeric(14,2) not null check(total_material_cost>=0), material_cost_per_kg numeric(14,4) not null check(material_cost_per_kg>=0),
  status text not null default 'completed' check(status in('completed','reversed')), notes text,
  created_at timestamptz not null default now(), created_by uuid not null references public.profiles(id)
);
create index feed_production_batches_farm_date_idx on public.feed_production_batches(farm_id,production_date desc);
create table public.feed_production_batch_items(
  id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.feed_production_batches(id) on delete restrict,
  material_id uuid not null references public.raw_materials(id) on delete restrict, recipe_quantity_kg numeric(14,3) not null check(recipe_quantity_kg>0),
  actual_quantity_kg numeric(14,3) not null check(actual_quantity_kg>0), unit_cost_snapshot numeric(14,4) not null check(unit_cost_snapshot>=0), total_cost_snapshot numeric(14,2) not null check(total_cost_snapshot>=0), unique(batch_id,material_id)
);

create trigger raw_materials_updated_at before update on public.raw_materials for each row execute function public.set_updated_at();
create trigger raw_material_purchases_updated_at before update on public.raw_material_purchases for each row execute function public.set_updated_at();
create trigger feed_recipes_updated_at before update on public.feed_recipes for each row execute function public.set_updated_at();

create or replace function public.recalculate_raw_material_ledger(target_farm uuid,target_material uuid) returns void language plpgsql security definer set search_path='' as $$
declare m record;q numeric:=0;v numeric:=0;w numeric:=0;c numeric;begin
 perform pg_advisory_xact_lock(hashtextextended(target_farm::text||target_material::text,0));
 for m in select * from public.raw_material_inventory_movements where farm_id=target_farm and material_id=target_material order by movement_date,case when movement_type='opening_stock' then 1 when movement_type='purchase' then 2 when movement_type='adjustment' and direction='IN' then 3 else 4 end,created_at,id loop
  if m.direction='IN' then c:=coalesce(m.unit_cost_snapshot,0);q:=q+m.quantity_kg;v:=round(v+m.quantity_kg*c,2);w:=case when q=0 then 0 else round(v/q,4) end;
  else if m.quantity_kg>q then raise exception 'Only % kg material is available on %',q,m.movement_date using errcode='23514'; end if;c:=w;q:=q-m.quantity_kg;v:=case when q=0 then 0 else round(v-m.quantity_kg*c,2) end;w:=case when q=0 then 0 else round(v/q,4) end; end if;
  update public.raw_material_inventory_movements set unit_cost_snapshot=c,total_cost_snapshot=round(m.quantity_kg*c,2) where id=m.id;
 end loop;
 insert into public.raw_material_inventory_balances(farm_id,material_id,quantity_kg,inventory_value,weighted_average_cost,updated_at) values(target_farm,target_material,q,v,w,now()) on conflict(farm_id,material_id) do update set quantity_kg=excluded.quantity_kg,inventory_value=excluded.inventory_value,weighted_average_cost=excluded.weighted_average_cost,updated_at=now();
end; $$;

create or replace function public.create_raw_material(material_name text, material_description text default null) returns public.raw_materials language plpgsql security definer set search_path='' as $$
declare f uuid;r public.raw_materials;begin f:=public.feed_access_farm(array['admin','manager']);insert into public.raw_materials(farm_id,name,description,created_by) values(f,trim(material_name),nullif(trim(material_description),''),auth.uid()) returning * into r;return r;end; $$;

create or replace function public.set_raw_material_opening_stock(target_material uuid,effective_date date,quantity_kg numeric,unit_cost numeric,notes text default null) returns public.raw_material_inventory_movements language plpgsql security definer set search_path='' as $$
declare f uuid;r public.raw_material_inventory_movements;begin f:=public.feed_access_farm(array['admin']);if quantity_kg<=0 or unit_cost<0 or not exists(select 1 from public.raw_materials where id=target_material and farm_id=f) or exists(select 1 from public.raw_material_inventory_movements where farm_id=f and material_id=target_material and movement_type='opening_stock') then raise exception 'Invalid or duplicate material opening stock' using errcode='23514'; end if;insert into public.raw_material_inventory_movements(farm_id,material_id,movement_date,movement_type,direction,quantity_kg,unit_cost_snapshot,source_type,notes,created_by) values(f,target_material,effective_date,'opening_stock','IN',quantity_kg,unit_cost,'material_opening_stock',nullif(trim(notes),''),auth.uid()) returning * into r;perform public.recalculate_raw_material_ledger(f,target_material);return r;end; $$;

create or replace function public.post_raw_material_purchase(target_material uuid,target_supplier uuid,purchase_date date,quantity_kg numeric,unit_cost numeric,amount_paid numeric default 0,notes text default null) returns public.raw_material_purchases language plpgsql security definer set search_path='' as $$
declare f uuid;r public.raw_material_purchases;total numeric;num text;terms integer;due date;begin f:=public.feed_access_farm(array['admin','manager']);if quantity_kg<=0 or unit_cost<0 or amount_paid<0 or not exists(select 1 from public.raw_materials where id=target_material and farm_id=f and is_active) or (target_supplier is not null and not exists(select 1 from public.suppliers where id=target_supplier and farm_id=f and active)) then raise exception 'Invalid material purchase' using errcode='23514'; end if;total:=round(quantity_kg*unit_cost,2);if amount_paid>total then raise exception 'Payment exceeds purchase total' using errcode='23514';end if;select default_payment_days into terms from public.suppliers where id=target_supplier;due:=case when terms is null then null else purchase_date+terms end;num:='MAT-'||to_char(purchase_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));insert into public.raw_material_purchases(farm_id,supplier_id,material_id,purchase_number,purchase_date,quantity_kg,unit_cost,total_cost,payment_terms_days,payment_due_date,notes,created_by) values(f,target_supplier,target_material,num,purchase_date,quantity_kg,unit_cost,total,terms,due,nullif(trim(notes),''),auth.uid()) returning * into r;insert into public.raw_material_inventory_movements(farm_id,material_id,movement_date,movement_type,direction,quantity_kg,unit_cost_snapshot,total_cost_snapshot,source_type,source_id,created_by) values(f,target_material,purchase_date,'purchase','IN',quantity_kg,unit_cost,total,'raw_material_purchase',r.id,auth.uid());perform public.recalculate_raw_material_ledger(f,target_material);return r;end; $$;

create or replace function public.save_feed_recipe(target_feed_type uuid,target_effective_from date,target_notes text,ingredients jsonb) returns public.feed_recipes language plpgsql security definer set search_path='' as $$
declare f uuid;r public.feed_recipes;total numeric;duplicates boolean;begin f:=public.feed_access_farm(array['admin','manager']);if jsonb_typeof(ingredients)<>'array' or jsonb_array_length(ingredients)=0 or not exists(select 1 from public.feed_types where id=target_feed_type and farm_id=f and active) then raise exception 'A feed type and recipe ingredients are required' using errcode='22023'; end if;select sum((x->>'quantity_kg')::numeric),count(*)<>count(distinct (x->>'material_id')) into total,duplicates from jsonb_array_elements(ingredients) x;if duplicates or total<>100 then raise exception 'Recipe ingredients must be unique and total exactly 100 kg' using errcode='23514';end if;if exists(select 1 from jsonb_array_elements(ingredients) x where (x->>'quantity_kg')::numeric<=0 or not exists(select 1 from public.raw_materials m where m.id=(x->>'material_id')::uuid and m.farm_id=f and m.is_active)) then raise exception 'Invalid recipe material' using errcode='42501';end if;update public.feed_recipes set effective_to=target_effective_from-1,status='superseded',updated_at=now(),updated_by=auth.uid() where farm_id=f and feed_type_id=target_feed_type and status='active' and effective_from<target_effective_from; if exists(select 1 from public.feed_recipes where farm_id=f and feed_type_id=target_feed_type and status='active' and effective_from>target_effective_from) then raise exception 'A later active recipe already exists' using errcode='23514';end if;insert into public.feed_recipes(farm_id,feed_type_id,effective_from,notes,created_by) values(f,target_feed_type,target_effective_from,nullif(trim(target_notes),''),auth.uid()) returning * into r;insert into public.feed_recipe_items(recipe_id,material_id,quantity_kg) select r.id,(x->>'material_id')::uuid,(x->>'quantity_kg')::numeric from jsonb_array_elements(ingredients) x;return r;end; $$;

create or replace function public.create_feed_production_batch(target_feed_type uuid,batch_date date,planned_output_kg numeric,actual_output_kg numeric,actual_items jsonb,batch_notes text default null) returns public.feed_production_batches language plpgsql security definer set search_path='' as $$
declare f uuid;recipe public.feed_recipes;b public.feed_production_batches;i record;balance numeric;cost numeric;total_input numeric:=0;total_cost numeric:=0;recipe_quantity numeric;begin
 f:=public.feed_access_farm(array['admin','manager']);if planned_output_kg<=0 or actual_output_kg<=0 or jsonb_typeof(actual_items)<>'array' or jsonb_array_length(actual_items)=0 or not exists(select 1 from public.feed_types where id=target_feed_type and farm_id=f and active) then raise exception 'Invalid feed production values' using errcode='22023';end if;
 select * into recipe from public.feed_recipes where farm_id=f and feed_type_id=target_feed_type and status='active' and effective_from<=batch_date and (effective_to is null or effective_to>=batch_date) order by effective_from desc limit 1;if recipe.id is null then raise exception 'No Feed Setup exists for this finished feed' using errcode='23514';end if;
 if (select count(*) from jsonb_array_elements(actual_items))<>(select count(*) from public.feed_recipe_items where recipe_id=recipe.id) or exists(select 1 from jsonb_array_elements(actual_items) x where (x->>'quantity_kg')::numeric<=0 or not exists(select 1 from public.feed_recipe_items ri where ri.recipe_id=recipe.id and ri.material_id=(x->>'material_id')::uuid)) then raise exception 'Actual materials must match the recipe and be positive' using errcode='23514';end if;
 for i in select (x->>'material_id')::uuid material_id,(x->>'quantity_kg')::numeric quantity_kg from jsonb_array_elements(actual_items) x order by 1 loop perform pg_advisory_xact_lock(hashtextextended(f::text||i.material_id::text,0));select quantity_kg,weighted_average_cost into balance,cost from public.raw_material_inventory_balances where farm_id=f and material_id=i.material_id; if coalesce(balance,0)<i.quantity_kg then raise exception 'Insufficient material stock' using errcode='23514';end if;total_input:=total_input+i.quantity_kg;total_cost:=total_cost+round(i.quantity_kg*coalesce(cost,0),2);end loop;
 if actual_output_kg>total_input then raise exception 'Actual finished output cannot exceed material input' using errcode='23514';end if;perform pg_advisory_xact_lock(hashtextextended(f::text||target_feed_type::text,0));
 insert into public.feed_production_batches(farm_id,feed_type_id,recipe_id,production_date,planned_output_kg,actual_output_kg,total_input_kg,processing_loss_kg,yield_percentage,total_material_cost,material_cost_per_kg,notes,created_by) values(f,target_feed_type,recipe.id,batch_date,planned_output_kg,actual_output_kg,total_input,round(total_input-actual_output_kg,3),round(actual_output_kg/total_input*100,3),round(total_cost,2),round(total_cost/actual_output_kg,4),nullif(trim(batch_notes),''),auth.uid()) returning * into b;
 for i in select (x->>'material_id')::uuid material_id,(x->>'quantity_kg')::numeric quantity_kg from jsonb_array_elements(actual_items) x loop select quantity_kg into recipe_quantity from public.feed_recipe_items where recipe_id=recipe.id and material_id=i.material_id;select weighted_average_cost into cost from public.raw_material_inventory_balances where farm_id=f and material_id=i.material_id;insert into public.feed_production_batch_items(batch_id,material_id,recipe_quantity_kg,actual_quantity_kg,unit_cost_snapshot,total_cost_snapshot) values(b.id,i.material_id,round(recipe_quantity*planned_output_kg/100,3),i.quantity_kg,cost,round(i.quantity_kg*cost,2));insert into public.raw_material_inventory_movements(farm_id,material_id,movement_date,movement_type,direction,quantity_kg,source_type,source_id,created_by) values(f,i.material_id,batch_date,'production_consumption','OUT',i.quantity_kg,'feed_production_batch',b.id,auth.uid());perform public.recalculate_raw_material_ledger(f,i.material_id);end loop;
 insert into public.feed_inventory_movements(farm_id,feed_type_id,movement_date,movement_type,direction,quantity_kg,unit_cost_snapshot,total_cost_snapshot,source_type,source_id,created_by) values(f,target_feed_type,batch_date,'production','IN',actual_output_kg,b.material_cost_per_kg,b.total_material_cost,'feed_production_batch',b.id,auth.uid());perform public.recalculate_feed_ledger(f,target_feed_type);return b;
end; $$;

alter table public.feed_inventory_movements drop constraint feed_movement_type_check,drop constraint feed_movement_direction_check;
alter table public.feed_inventory_movements add constraint feed_movement_type_check check(movement_type in('opening_stock','purchase','production','consumption','wastage','adjustment','purchase_reversal','mixing_input','mixing_output'));
alter table public.feed_inventory_movements add constraint feed_movement_direction_check check((movement_type in('opening_stock','purchase','production','mixing_output') and direction='IN') or (movement_type in('consumption','wastage','purchase_reversal','mixing_input') and direction='OUT') or movement_type='adjustment');

alter table public.raw_materials enable row level security;alter table public.raw_material_inventory_movements enable row level security;alter table public.raw_material_inventory_balances enable row level security;alter table public.supplier_raw_materials enable row level security;alter table public.supplier_feed_types enable row level security;alter table public.raw_material_purchases enable row level security;alter table public.feed_recipes enable row level security;alter table public.feed_recipe_items enable row level security;alter table public.feed_production_batches enable row level security;alter table public.feed_production_batch_items enable row level security;
create policy raw_materials_read on public.raw_materials for select to authenticated using(public.has_farm_role(farm_id,array['admin','manager']));
create policy raw_material_movements_read on public.raw_material_inventory_movements for select to authenticated using(public.has_farm_role(farm_id,array['admin','manager']));
create policy raw_material_balances_read on public.raw_material_inventory_balances for select to authenticated using(public.has_farm_role(farm_id,array['admin','manager']));
create policy raw_material_purchases_read on public.raw_material_purchases for select to authenticated using(public.has_farm_role(farm_id,array['admin','manager']));
create policy feed_recipes_read on public.feed_recipes for select to authenticated using(public.has_farm_role(farm_id,array['admin','manager']));
create policy feed_recipe_items_read on public.feed_recipe_items for select to authenticated using(exists(select 1 from public.feed_recipes r where r.id=recipe_id and public.has_farm_role(r.farm_id,array['admin','manager'])));
create policy feed_production_batches_read on public.feed_production_batches for select to authenticated using(public.has_farm_role(farm_id,array['admin','manager']));
create policy feed_production_items_read on public.feed_production_batch_items for select to authenticated using(exists(select 1 from public.feed_production_batches b where b.id=batch_id and public.has_farm_role(b.farm_id,array['admin','manager'])));
create policy supplier_materials_read on public.supplier_raw_materials for select to authenticated using(exists(select 1 from public.suppliers s where s.id=supplier_id and public.has_farm_role(s.farm_id,array['admin','manager'])));
create policy supplier_feed_types_read on public.supplier_feed_types for select to authenticated using(exists(select 1 from public.suppliers s where s.id=supplier_id and public.has_farm_role(s.farm_id,array['admin','manager'])));
grant select on public.raw_materials,public.raw_material_inventory_movements,public.raw_material_inventory_balances,public.supplier_raw_materials,public.supplier_feed_types,public.raw_material_purchases,public.feed_recipes,public.feed_recipe_items,public.feed_production_batches,public.feed_production_batch_items to authenticated;
revoke all on function public.recalculate_raw_material_ledger(uuid,uuid),public.create_raw_material(text,text),public.set_raw_material_opening_stock(uuid,date,numeric,numeric,text),public.post_raw_material_purchase(uuid,uuid,date,numeric,numeric,numeric,text),public.save_feed_recipe(uuid,date,text,jsonb),public.create_feed_production_batch(uuid,date,numeric,numeric,jsonb,text) from public,anon;
grant execute on function public.create_raw_material(text,text),public.set_raw_material_opening_stock(uuid,date,numeric,numeric,text),public.post_raw_material_purchase(uuid,uuid,date,numeric,numeric,numeric,text),public.save_feed_recipe(uuid,date,text,jsonb),public.create_feed_production_batch(uuid,date,numeric,numeric,jsonb,text) to authenticated;
do $$declare t text;begin foreach t in array array['raw_materials','raw_material_inventory_movements','raw_material_purchases','feed_recipes','feed_recipe_items','feed_production_batches','feed_production_batch_items'] loop execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.write_business_audit()',t,t);end loop;end$$;
