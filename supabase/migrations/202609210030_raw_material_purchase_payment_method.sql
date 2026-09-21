-- Preserve the original multi-line material invoice behavior while recording the
-- method chosen for its immediate payment instead of assuming cash.
create or replace function public.post_raw_material_purchase_batch(target_supplier uuid,target_purchase_date date,target_amount_paid numeric,target_notes text,purchase_items jsonb,target_payment_method text default 'cash')
returns public.raw_material_purchase_batches language plpgsql security definer set search_path='' as $$
declare f uuid; b public.raw_material_purchase_batches; i record; total numeric:=0; line_total numeric; terms integer; due date; number text; line_number integer:=0;
begin
 f:=public.feed_access_farm(array['admin','manager']);
 if jsonb_typeof(purchase_items)<>'array' or jsonb_array_length(purchase_items)=0 or target_amount_paid<0 or target_payment_method not in('cash','momo','bank_transfer','other') then raise exception 'Invalid material purchase' using errcode='23514'; end if;
 if target_supplier is not null and not exists(select 1 from public.suppliers where id=target_supplier and farm_id=f and active) then raise exception 'Invalid supplier' using errcode='42501'; end if;
 if exists(select 1 from jsonb_array_elements(purchase_items) x where coalesce((x->>'quantity_kg')::numeric,0)<=0 or coalesce((x->>'unit_cost')::numeric,-1)<0 or not exists(select 1 from public.raw_materials m where m.id=(x->>'material_id')::uuid and m.farm_id=f and m.is_active)) then raise exception 'Every purchase line needs an active material, quantity, and unit cost' using errcode='23514'; end if;
 if (select count(*) from jsonb_array_elements(purchase_items))<>(select count(distinct (x->>'material_id')) from jsonb_array_elements(purchase_items)x) then raise exception 'A material can appear only once on a purchase' using errcode='23514'; end if;
 select coalesce(sum(round((x->>'quantity_kg')::numeric*(x->>'unit_cost')::numeric,2)),0) into total from jsonb_array_elements(purchase_items)x;
 if target_amount_paid>total then raise exception 'Payment exceeds purchase total' using errcode='23514'; end if;
 select default_payment_days into terms from public.suppliers where id=target_supplier; due:=case when target_amount_paid<total and terms is not null then target_purchase_date+terms else null end;
 number:='MAT-'||to_char(target_purchase_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
 insert into public.raw_material_purchase_batches(farm_id,supplier_id,purchase_number,purchase_date,total_cost,amount_paid,payment_terms_days,payment_due_date,notes,created_by) values(f,target_supplier,number,target_purchase_date,total,0,terms,due,nullif(trim(target_notes),''),auth.uid()) returning * into b;
 for i in select (x->>'material_id')::uuid material_id,(x->>'quantity_kg')::numeric quantity_kg,(x->>'unit_cost')::numeric unit_cost,nullif(x->>'package_count','')::numeric package_count,nullif(x->>'package_weight_kg','')::numeric package_weight_kg from jsonb_array_elements(purchase_items)x loop
  line_number:=line_number+1; line_total:=round(i.quantity_kg*i.unit_cost,2);
  insert into public.raw_material_purchases(farm_id,supplier_id,material_id,purchase_batch_id,purchase_number,purchase_date,quantity_kg,unit_cost,total_cost,payment_terms_days,payment_due_date,package_count,package_weight_kg_snapshot,notes,created_by) values(f,target_supplier,i.material_id,b.id,number||'-'||line_number,target_purchase_date,i.quantity_kg,i.unit_cost,line_total,terms,due,i.package_count,i.package_weight_kg,nullif(trim(target_notes),''),auth.uid());
  insert into public.raw_material_inventory_movements(farm_id,material_id,movement_date,movement_type,direction,quantity_kg,unit_cost_snapshot,total_cost_snapshot,source_type,source_id,created_by) values(f,i.material_id,target_purchase_date,'purchase','IN',i.quantity_kg,i.unit_cost,line_total,'raw_material_purchase_batch',b.id,auth.uid()); perform public.recalculate_raw_material_ledger(f,i.material_id);
 end loop;
 if target_amount_paid>0 then perform public.record_raw_material_purchase_payment(b.id,target_purchase_date,target_amount_paid,target_payment_method,null,null); end if;
 return b;
end;$$;
revoke all on function public.post_raw_material_purchase_batch(uuid,date,numeric,text,jsonb,text) from public,anon;
grant execute on function public.post_raw_material_purchase_batch(uuid,date,numeric,text,jsonb,text) to authenticated;
