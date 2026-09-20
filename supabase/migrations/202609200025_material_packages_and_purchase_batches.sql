-- Keep every material ledger in kilograms while making package-based entry practical.

alter table public.raw_materials
  add column package_label text,
  add column default_package_weight_kg numeric(14,3);

alter table public.raw_materials
  add constraint raw_materials_package_label_check
    check (package_label is null or char_length(trim(package_label)) between 2 and 40),
  add constraint raw_materials_default_package_weight_check
    check (default_package_weight_kg is null or default_package_weight_kg > 0);

create table public.raw_material_purchase_batches(
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  purchase_number text not null,
  purchase_date date not null,
  total_cost numeric(14,2) not null check(total_cost >= 0),
  amount_paid numeric(14,2) not null default 0 check(amount_paid >= 0 and amount_paid <= total_cost),
  payment_terms_days integer check(payment_terms_days between 1 and 365),
  payment_due_date date check(payment_due_date is null or payment_due_date >= purchase_date),
  notes text,
  status text not null default 'completed' check(status in('completed','voided')),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  unique(farm_id,purchase_number)
);

alter table public.raw_material_purchases
  add column purchase_batch_id uuid references public.raw_material_purchase_batches(id) on delete restrict,
  add column package_count numeric(14,3),
  add column package_weight_kg_snapshot numeric(14,3),
  add constraint raw_material_purchases_package_count_check check(package_count is null or package_count > 0),
  add constraint raw_material_purchases_package_weight_check check(package_weight_kg_snapshot is null or package_weight_kg_snapshot > 0);

create index raw_material_purchase_batches_farm_date_idx
  on public.raw_material_purchase_batches(farm_id,purchase_date desc);
create index raw_material_purchases_batch_idx on public.raw_material_purchases(purchase_batch_id);

create or replace function public.create_raw_material(
  material_name text,
  material_description text default null,
  material_package_label text default null,
  material_package_weight_kg numeric default null
) returns public.raw_materials language plpgsql security definer set search_path='' as $$
declare f uuid; r public.raw_materials;
begin
  f:=public.feed_access_farm(array['admin','manager']);
  if material_package_weight_kg is not null and material_package_weight_kg <= 0 then
    raise exception 'Package weight must be greater than zero' using errcode='23514';
  end if;
  insert into public.raw_materials(farm_id,name,description,package_label,default_package_weight_kg,created_by)
  values(f,trim(material_name),nullif(trim(material_description),''),nullif(trim(material_package_label),''),material_package_weight_kg,auth.uid())
  returning * into r;
  return r;
end; $$;

create or replace function public.update_raw_material(
  target_material uuid,
  material_name text,
  material_description text default null,
  material_package_label text default null,
  material_package_weight_kg numeric default null
) returns public.raw_materials language plpgsql security definer set search_path='' as $$
declare f uuid; r public.raw_materials;
begin
  f:=public.feed_access_farm(array['admin','manager']);
  if material_package_weight_kg is not null and material_package_weight_kg <= 0 then
    raise exception 'Package weight must be greater than zero' using errcode='23514';
  end if;
  update public.raw_materials
  set name=trim(material_name),description=nullif(trim(material_description),''),
      package_label=nullif(trim(material_package_label),''),
      default_package_weight_kg=material_package_weight_kg,
      updated_at=now(),updated_by=auth.uid()
  where id=target_material and farm_id=f returning * into r;
  if r.id is null then raise exception 'Material not found' using errcode='P0002'; end if;
  return r;
end; $$;

create or replace function public.post_raw_material_purchase_batch(
  target_supplier uuid,
  target_purchase_date date,
  target_amount_paid numeric,
  target_notes text,
  purchase_items jsonb
) returns public.raw_material_purchase_batches language plpgsql security definer set search_path='' as $$
declare
  f uuid; b public.raw_material_purchase_batches; i record; total numeric:=0; line_total numeric;
  terms integer; due date; number text; line_number integer:=0;
begin
  f:=public.feed_access_farm(array['admin','manager']);
  if jsonb_typeof(purchase_items)<>'array' or jsonb_array_length(purchase_items)=0 or target_amount_paid<0 then
    raise exception 'At least one valid purchase item is required' using errcode='23514';
  end if;
  if target_supplier is not null and not exists(select 1 from public.suppliers where id=target_supplier and farm_id=f and active) then
    raise exception 'Invalid supplier' using errcode='42501';
  end if;
  if exists(
    select 1 from jsonb_array_elements(purchase_items) x
    where coalesce((x->>'quantity_kg')::numeric,0)<=0
       or coalesce((x->>'unit_cost')::numeric,-1)<0
       or not exists(select 1 from public.raw_materials m where m.id=(x->>'material_id')::uuid and m.farm_id=f and m.is_active)
  ) then
    raise exception 'Every purchase line needs an active material, quantity, and unit cost' using errcode='23514';
  end if;
  if (select count(*) from jsonb_array_elements(purchase_items)) <> (select count(distinct (x->>'material_id')) from jsonb_array_elements(purchase_items) x) then
    raise exception 'A material can appear only once on a purchase' using errcode='23514';
  end if;
  select coalesce(sum(round((x->>'quantity_kg')::numeric*(x->>'unit_cost')::numeric,2)),0)
    into total from jsonb_array_elements(purchase_items) x;
  if target_amount_paid>total then raise exception 'Payment exceeds purchase total' using errcode='23514'; end if;
  select default_payment_days into terms from public.suppliers where id=target_supplier;
  due:=case when target_amount_paid<total and terms is not null then target_purchase_date+terms else null end;
  number:='MAT-'||to_char(target_purchase_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.raw_material_purchase_batches(farm_id,supplier_id,purchase_number,purchase_date,total_cost,amount_paid,payment_terms_days,payment_due_date,notes,created_by)
  values(f,target_supplier,number,target_purchase_date,total,target_amount_paid,terms,due,nullif(trim(target_notes),''),auth.uid())
  returning * into b;
  for i in select
    (x->>'material_id')::uuid material_id,
    (x->>'quantity_kg')::numeric quantity_kg,
    (x->>'unit_cost')::numeric unit_cost,
    nullif(x->>'package_count','')::numeric package_count,
    nullif(x->>'package_weight_kg','')::numeric package_weight_kg
    from jsonb_array_elements(purchase_items) x
  loop
    line_number:=line_number+1; line_total:=round(i.quantity_kg*i.unit_cost,2);
    insert into public.raw_material_purchases(farm_id,supplier_id,material_id,purchase_batch_id,purchase_number,purchase_date,quantity_kg,unit_cost,total_cost,payment_terms_days,payment_due_date,package_count,package_weight_kg_snapshot,notes,created_by)
    values(f,target_supplier,i.material_id,b.id,number||'-'||line_number,target_purchase_date,i.quantity_kg,i.unit_cost,line_total,terms,due,i.package_count,i.package_weight_kg,nullif(trim(target_notes),''),auth.uid());
    insert into public.raw_material_inventory_movements(farm_id,material_id,movement_date,movement_type,direction,quantity_kg,unit_cost_snapshot,total_cost_snapshot,source_type,source_id,created_by)
    values(f,i.material_id,target_purchase_date,'purchase','IN',i.quantity_kg,i.unit_cost,line_total,'raw_material_purchase_batch',b.id,auth.uid());
    perform public.recalculate_raw_material_ledger(f,i.material_id);
  end loop;
  return b;
end; $$;

alter table public.raw_material_purchase_batches enable row level security;
create policy raw_material_purchase_batches_read on public.raw_material_purchase_batches
  for select to authenticated using(public.has_farm_role(farm_id,array['admin','manager']));
grant select on public.raw_material_purchase_batches to authenticated;

revoke all on function public.post_raw_material_purchase_batch(uuid,date,numeric,text,jsonb) from public,anon;
grant execute on function public.post_raw_material_purchase_batch(uuid,date,numeric,text,jsonb) to authenticated;

create trigger raw_material_purchase_batches_updated_at
before update on public.raw_material_purchase_batches for each row execute function public.set_updated_at();
create trigger raw_material_purchase_batches_audit
after insert or update or delete on public.raw_material_purchase_batches
for each row execute function public.write_business_audit();
