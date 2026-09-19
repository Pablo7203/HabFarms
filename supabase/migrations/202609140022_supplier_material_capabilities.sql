-- Extends the local supplier-capability prototype with farm-scoped raw-material capabilities.
create or replace function public.save_supplier_capabilities(target_supplier uuid,supplier_name text,supplier_phone text,supplier_email text,supplier_location text,supplier_notes text,supplied_types uuid[],supplied_materials uuid[],supplier_active boolean default true) returns public.suppliers language plpgsql security definer set search_path='' as $$
declare f uuid;r public.suppliers;feed_ids uuid[];material_ids uuid[];begin
 f:=public.feed_access_farm(array['admin','manager']);
 feed_ids:=coalesce(array(select distinct x from unnest(coalesce(supplied_types,'{}'::uuid[])) x),'{}'::uuid[]);
 material_ids:=coalesce(array(select distinct x from unnest(coalesce(supplied_materials,'{}'::uuid[])) x),'{}'::uuid[]);
 if exists(select 1 from unnest(feed_ids) x where not exists(select 1 from public.feed_types ft where ft.id=x and ft.farm_id=f)) or exists(select 1 from unnest(material_ids) x where not exists(select 1 from public.raw_materials rm where rm.id=x and rm.farm_id=f)) then raise exception 'Invalid supplier capability' using errcode='42501';end if;
 if target_supplier is null then insert into public.suppliers(farm_id,name,phone,email,location,notes,supplied_feed_type_ids,active,created_by) values(f,trim(supplier_name),nullif(trim(supplier_phone),''),nullif(trim(supplier_email),''),nullif(trim(supplier_location),''),nullif(trim(supplier_notes),''),feed_ids,supplier_active,auth.uid()) returning * into r;
 else update public.suppliers set name=trim(supplier_name),phone=nullif(trim(supplier_phone),''),email=nullif(trim(supplier_email),''),location=nullif(trim(supplier_location),''),notes=nullif(trim(supplier_notes),''),supplied_feed_type_ids=feed_ids,active=supplier_active,updated_by=auth.uid() where id=target_supplier and farm_id=f returning * into r;if r.id is null then raise exception 'Supplier access denied' using errcode='42501';end if;end if;
 delete from public.supplier_feed_types where supplier_id=r.id;insert into public.supplier_feed_types(supplier_id,feed_type_id,created_by) select r.id,x,auth.uid() from unnest(feed_ids) x;
 delete from public.supplier_raw_materials where supplier_id=r.id;insert into public.supplier_raw_materials(supplier_id,material_id,created_by) select r.id,x,auth.uid() from unnest(material_ids) x;
 return r;
end; $$;
revoke all on function public.save_supplier_capabilities(uuid,text,text,text,text,text,uuid[],uuid[],boolean) from public,anon;
grant execute on function public.save_supplier_capabilities(uuid,text,text,text,text,text,uuid[],uuid[],boolean) to authenticated;
