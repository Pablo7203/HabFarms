-- Flexible recipe batch sizes and safe raw-material maintenance.

alter table public.feed_recipes drop constraint feed_recipes_basis_kg_check;
alter table public.feed_recipes add constraint feed_recipes_basis_kg_check check (basis_kg > 0);

create or replace function public.save_feed_recipe_v2(
  target_feed_type uuid,
  target_effective_from date,
  target_basis_kg numeric,
  target_notes text,
  ingredients jsonb
) returns public.feed_recipes
language plpgsql security definer set search_path='' as $$
declare f uuid; r public.feed_recipes; total numeric; duplicates boolean;
begin
  f := public.feed_access_farm(array['admin','manager']);
  if target_basis_kg <= 0 or target_basis_kg > 100000 or jsonb_typeof(ingredients) <> 'array' or jsonb_array_length(ingredients) = 0
     or not exists(select 1 from public.feed_types where id=target_feed_type and farm_id=f and active) then
    raise exception 'A feed type, positive batch size, and recipe ingredients are required' using errcode='22023';
  end if;
  select sum((x->>'quantity_kg')::numeric), count(*) <> count(distinct (x->>'material_id'))
  into total, duplicates from jsonb_array_elements(ingredients) x;
  if duplicates or round(coalesce(total,0),3) <> round(target_basis_kg,3) then
    raise exception 'Recipe ingredient quantities must be unique and total exactly the selected batch size' using errcode='23514';
  end if;
  if exists(select 1 from jsonb_array_elements(ingredients) x where (x->>'quantity_kg')::numeric <= 0
    or not exists(select 1 from public.raw_materials m where m.id=(x->>'material_id')::uuid and m.farm_id=f and m.is_active)) then
    raise exception 'Invalid recipe material' using errcode='42501';
  end if;
  update public.feed_recipes set effective_to=target_effective_from-1,status='superseded',updated_at=now(),updated_by=auth.uid()
  where farm_id=f and feed_type_id=target_feed_type and status='active' and effective_from<target_effective_from;
  if exists(select 1 from public.feed_recipes where farm_id=f and feed_type_id=target_feed_type and status='active' and effective_from>target_effective_from) then
    raise exception 'A later active recipe already exists' using errcode='23514';
  end if;
  insert into public.feed_recipes(farm_id,feed_type_id,effective_from,basis_kg,notes,created_by)
  values(f,target_feed_type,target_effective_from,target_basis_kg,nullif(trim(target_notes),''),auth.uid()) returning * into r;
  insert into public.feed_recipe_items(recipe_id,material_id,quantity_kg)
  select r.id,(x->>'material_id')::uuid,(x->>'quantity_kg')::numeric from jsonb_array_elements(ingredients) x;
  return r;
end; $$;

create or replace function public.create_feed_production_batch(
  target_feed_type uuid, batch_date date, planned_output_kg numeric, actual_output_kg numeric, actual_items jsonb, batch_notes text default null
) returns public.feed_production_batches language plpgsql security definer set search_path='' as $$
declare f uuid;recipe public.feed_recipes;b public.feed_production_batches;i record;balance numeric;cost numeric;total_input numeric:=0;total_cost numeric:=0;recipe_quantity numeric;
begin
 f:=public.feed_access_farm(array['admin','manager']);if planned_output_kg<=0 or actual_output_kg<=0 or jsonb_typeof(actual_items)<>'array' or jsonb_array_length(actual_items)=0 or not exists(select 1 from public.feed_types where id=target_feed_type and farm_id=f and active) then raise exception 'Invalid feed production values' using errcode='22023';end if;
 select * into recipe from public.feed_recipes where farm_id=f and feed_type_id=target_feed_type and status='active' and effective_from<=batch_date and (effective_to is null or effective_to>=batch_date) order by effective_from desc limit 1;if recipe.id is null then raise exception 'No Feed Setup exists for this finished feed' using errcode='23514';end if;
 if (select count(*) from jsonb_array_elements(actual_items))<>(select count(*) from public.feed_recipe_items where recipe_id=recipe.id) or exists(select 1 from jsonb_array_elements(actual_items) x where (x->>'quantity_kg')::numeric<=0 or not exists(select 1 from public.feed_recipe_items ri where ri.recipe_id=recipe.id and ri.material_id=(x->>'material_id')::uuid)) then raise exception 'Actual materials must match the recipe and be positive' using errcode='23514';end if;
 for i in select (x->>'material_id')::uuid material_id,(x->>'quantity_kg')::numeric quantity_kg from jsonb_array_elements(actual_items) x order by 1 loop perform pg_advisory_xact_lock(hashtextextended(f::text||i.material_id::text,0));select quantity_kg,weighted_average_cost into balance,cost from public.raw_material_inventory_balances where farm_id=f and material_id=i.material_id; if coalesce(balance,0)<i.quantity_kg then raise exception 'Insufficient material stock' using errcode='23514';end if;total_input:=total_input+i.quantity_kg;total_cost:=total_cost+round(i.quantity_kg*coalesce(cost,0),2);end loop;
 if actual_output_kg>total_input then raise exception 'Actual finished output cannot exceed material input' using errcode='23514';end if;perform pg_advisory_xact_lock(hashtextextended(f::text||target_feed_type::text,0));
 insert into public.feed_production_batches(farm_id,feed_type_id,recipe_id,production_date,planned_output_kg,actual_output_kg,total_input_kg,processing_loss_kg,yield_percentage,total_material_cost,material_cost_per_kg,notes,created_by) values(f,target_feed_type,recipe.id,batch_date,planned_output_kg,actual_output_kg,total_input,round(total_input-actual_output_kg,3),round(actual_output_kg/total_input*100,3),round(total_cost,2),round(total_cost/actual_output_kg,4),nullif(trim(batch_notes),''),auth.uid()) returning * into b;
 for i in select (x->>'material_id')::uuid material_id,(x->>'quantity_kg')::numeric quantity_kg from jsonb_array_elements(actual_items) x loop select quantity_kg into recipe_quantity from public.feed_recipe_items where recipe_id=recipe.id and material_id=i.material_id;select weighted_average_cost into cost from public.raw_material_inventory_balances where farm_id=f and material_id=i.material_id;insert into public.feed_production_batch_items(batch_id,material_id,recipe_quantity_kg,actual_quantity_kg,unit_cost_snapshot,total_cost_snapshot) values(b.id,i.material_id,round(recipe_quantity*planned_output_kg/recipe.basis_kg,3),i.quantity_kg,cost,round(i.quantity_kg*cost,2));insert into public.raw_material_inventory_movements(farm_id,material_id,movement_date,movement_type,direction,quantity_kg,source_type,source_id,created_by) values(f,i.material_id,batch_date,'production_consumption','OUT',i.quantity_kg,'feed_production_batch',b.id,auth.uid());perform public.recalculate_raw_material_ledger(f,i.material_id);end loop;
 insert into public.feed_inventory_movements(farm_id,feed_type_id,movement_date,movement_type,direction,quantity_kg,unit_cost_snapshot,total_cost_snapshot,source_type,source_id,created_by) values(f,target_feed_type,batch_date,'production','IN',actual_output_kg,b.material_cost_per_kg,b.total_material_cost,'feed_production_batch',b.id,auth.uid());perform public.recalculate_feed_ledger(f,target_feed_type);return b;
end; $$;

create or replace function public.update_raw_material(target_material uuid, material_name text, material_description text default null) returns public.raw_materials language plpgsql security definer set search_path='' as $$
declare f uuid;r public.raw_materials;begin f:=public.feed_access_farm(array['admin','manager']);update public.raw_materials set name=trim(material_name),description=nullif(trim(material_description),''),updated_at=now(),updated_by=auth.uid() where id=target_material and farm_id=f returning * into r;if r.id is null then raise exception 'Material not found' using errcode='P0002';end if;return r;end; $$;

create or replace function public.archive_raw_material(target_material uuid) returns void language plpgsql security definer set search_path='' as $$
declare f uuid;begin f:=public.feed_access_farm(array['admin','manager']);update public.raw_materials set is_active=false,updated_at=now(),updated_by=auth.uid() where id=target_material and farm_id=f;if not found then raise exception 'Material not found' using errcode='P0002';end if;end; $$;

create or replace function public.delete_unused_raw_material(target_material uuid) returns void language plpgsql security definer set search_path='' as $$
declare f uuid;begin f:=public.feed_access_farm(array['admin']);if not exists(select 1 from public.raw_materials where id=target_material and farm_id=f) then raise exception 'Material not found' using errcode='P0002';end if;if exists(select 1 from public.raw_material_inventory_movements where material_id=target_material) or exists(select 1 from public.raw_material_purchases where material_id=target_material) or exists(select 1 from public.feed_recipe_items where material_id=target_material) then raise exception 'This material has history and must be archived instead of deleted' using errcode='23514';end if;delete from public.raw_materials where id=target_material and farm_id=f;end; $$;

revoke all on function public.save_feed_recipe_v2(uuid,date,numeric,text,jsonb),public.update_raw_material(uuid,text,text),public.archive_raw_material(uuid),public.delete_unused_raw_material(uuid) from public,anon;
grant execute on function public.save_feed_recipe_v2(uuid,date,numeric,text,jsonb),public.update_raw_material(uuid,text,text),public.archive_raw_material(uuid),public.delete_unused_raw_material(uuid) to authenticated;
