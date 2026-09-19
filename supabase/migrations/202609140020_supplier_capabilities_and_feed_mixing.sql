-- Supplier capabilities and internally mixed feed.  This is forward-only: 018/019 are already deployed.
alter table public.suppliers add column supplied_feed_type_ids uuid[] not null default '{}';

create table public.feed_mixing_batches(
 id uuid primary key default gen_random_uuid(), farm_id uuid not null references public.farms(id) on delete cascade,
 output_feed_type_id uuid not null references public.feed_types(id) on delete restrict, mixed_on date not null,
 output_kg numeric(14,3) not null check(output_kg>0), material_cost numeric(14,2) not null check(material_cost>=0),
 cost_per_kg numeric(14,4) not null check(cost_per_kg>=0), notes text, status text not null default 'completed' check(status in('completed','voided')),
 created_at timestamptz not null default now(), created_by uuid not null references public.profiles(id)
);
create table public.feed_mixing_batch_items(
 id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.feed_mixing_batches(id) on delete cascade,
 feed_type_id uuid not null references public.feed_types(id) on delete restrict, quantity_kg numeric(14,3) not null check(quantity_kg>0),
 unit_cost_snapshot numeric(14,4) not null check(unit_cost_snapshot>=0), total_cost_snapshot numeric(14,2) not null check(total_cost_snapshot>=0), unique(batch_id,feed_type_id)
);
create index feed_mixing_batches_farm_date_idx on public.feed_mixing_batches(farm_id,mixed_on desc);

alter table public.feed_inventory_movements drop constraint feed_movement_type_check, drop constraint feed_movement_direction_check;
alter table public.feed_inventory_movements add constraint feed_movement_type_check check(movement_type in('opening_stock','purchase','consumption','wastage','adjustment','purchase_reversal','mixing_input','mixing_output'));
alter table public.feed_inventory_movements add constraint feed_movement_direction_check check((movement_type in('opening_stock','purchase','mixing_output') and direction='IN') or (movement_type in('consumption','wastage','purchase_reversal','mixing_input') and direction='OUT') or movement_type='adjustment');

create or replace function public.save_supplier_with_capabilities(target_supplier uuid, supplier_name text, supplier_phone text, supplier_email text, supplier_location text, supplier_notes text, supplied_types uuid[], supplier_active boolean default true) returns public.suppliers language plpgsql security definer set search_path='' as $$
declare f uuid; r public.suppliers; clean uuid[];
begin f:=public.feed_access_farm(array['admin','manager']); clean:=coalesce(array(select distinct x from unnest(coalesce(supplied_types,'{}'::uuid[])) x),'{}'::uuid[]);
 if exists(select 1 from unnest(clean) x where not exists(select 1 from public.feed_types ft where ft.id=x and ft.farm_id=f)) then raise exception 'Invalid supplied feed type' using errcode='42501'; end if;
 if target_supplier is null then insert into public.suppliers(farm_id,name,phone,email,location,notes,supplied_feed_type_ids,active,created_by) values(f,trim(supplier_name),nullif(trim(supplier_phone),''),nullif(trim(supplier_email),''),nullif(trim(supplier_location),''),nullif(trim(supplier_notes),''),clean,supplier_active,auth.uid()) returning * into r;
 else update public.suppliers set name=trim(supplier_name),phone=nullif(trim(supplier_phone),''),email=nullif(trim(supplier_email),''),location=nullif(trim(supplier_location),''),notes=nullif(trim(supplier_notes),''),supplied_feed_type_ids=clean,active=supplier_active,updated_by=auth.uid() where id=target_supplier and farm_id=f returning * into r; if r.id is null then raise exception 'Supplier access denied' using errcode='42501'; end if; end if; return r;
end;$$;

create function public.create_feed_mixing_batch(output_feed_type uuid, batch_date date, output_quantity_kg numeric, ingredients jsonb, batch_notes text default null) returns public.feed_mixing_batches language plpgsql security definer set search_path='' as $$
declare f uuid; b public.feed_mixing_batches; i record; unit_cost numeric; total numeric:=0; types uuid[]; lock_type uuid;
begin f:=public.feed_access_farm(array['admin','manager']); if output_quantity_kg<=0 or jsonb_typeof(ingredients)<>'array' or jsonb_array_length(ingredients)=0 then raise exception 'Output quantity and at least one ingredient are required' using errcode='22023'; end if;
 if not exists(select 1 from public.feed_types where id=output_feed_type and farm_id=f and active) then raise exception 'Invalid finished feed type' using errcode='42501'; end if;
 select array_agg((x->>'feed_type_id')::uuid) into types from jsonb_array_elements(ingredients) x; if output_feed_type=any(types) or exists(select 1 from unnest(types) t where not exists(select 1 from public.feed_types where id=t and farm_id=f and active)) then raise exception 'Invalid ingredient feed type' using errcode='42501'; end if;
 foreach lock_type in array types loop perform pg_advisory_xact_lock(hashtextextended(f::text||lock_type::text,0)); end loop; perform pg_advisory_xact_lock(hashtextextended(f::text||output_feed_type::text,0));
 for i in select (x->>'feed_type_id')::uuid feed_type_id,(x->>'quantity_kg')::numeric quantity_kg from jsonb_array_elements(ingredients) x loop
  if i.quantity_kg<=0 then raise exception 'Ingredient quantities must be positive' using errcode='22023'; end if; select weighted_average_cost into unit_cost from public.feed_inventory_balances where farm_id=f and feed_type_id=i.feed_type_id; if unit_cost is null then raise exception 'Ingredient stock is unavailable' using errcode='23514'; end if; total:=total+round(i.quantity_kg*unit_cost,2);
 end loop;
 insert into public.feed_mixing_batches(farm_id,output_feed_type_id,mixed_on,output_kg,material_cost,cost_per_kg,notes,created_by) values(f,output_feed_type,batch_date,output_quantity_kg,round(total,2),round(total/output_quantity_kg,4),nullif(trim(batch_notes),''),auth.uid()) returning * into b;
 for i in select (x->>'feed_type_id')::uuid feed_type_id,(x->>'quantity_kg')::numeric quantity_kg from jsonb_array_elements(ingredients) x loop select weighted_average_cost into unit_cost from public.feed_inventory_balances where farm_id=f and feed_type_id=i.feed_type_id; insert into public.feed_mixing_batch_items(batch_id,feed_type_id,quantity_kg,unit_cost_snapshot,total_cost_snapshot) values(b.id,i.feed_type_id,i.quantity_kg,unit_cost,round(i.quantity_kg*unit_cost,2)); insert into public.feed_inventory_movements(farm_id,feed_type_id,movement_date,movement_type,direction,quantity_kg,source_type,source_id,created_by) values(f,i.feed_type_id,batch_date,'mixing_input','OUT',i.quantity_kg,'feed_mixing_batch',b.id,auth.uid()); perform public.recalculate_feed_ledger(f,i.feed_type_id); end loop;
 insert into public.feed_inventory_movements(farm_id,feed_type_id,movement_date,movement_type,direction,quantity_kg,unit_cost_snapshot,source_type,source_id,created_by) values(f,output_feed_type,batch_date,'mixing_output','IN',output_quantity_kg,b.cost_per_kg,'feed_mixing_batch',b.id,auth.uid()); perform public.recalculate_feed_ledger(f,output_feed_type); return b;
end;$$;

alter table public.feed_mixing_batches enable row level security; alter table public.feed_mixing_batch_items enable row level security;
create policy feed_mixing_batches_read on public.feed_mixing_batches for select to authenticated using(public.has_farm_role(farm_id,array['admin','manager']));
create policy feed_mixing_batch_items_read on public.feed_mixing_batch_items for select to authenticated using(exists(select 1 from public.feed_mixing_batches b where b.id=batch_id and public.has_farm_role(b.farm_id,array['admin','manager'])));
grant select on public.feed_mixing_batches,public.feed_mixing_batch_items to authenticated;
revoke all on function public.save_supplier_with_capabilities(uuid,text,text,text,text,text,uuid[],boolean),public.create_feed_mixing_batch(uuid,date,numeric,jsonb,text) from public;
grant execute on function public.save_supplier_with_capabilities(uuid,text,text,text,text,text,uuid[],boolean),public.create_feed_mixing_batch(uuid,date,numeric,jsonb,text) to authenticated;
