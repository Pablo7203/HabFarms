-- Remove the obsolete, ignored stage argument from feed-consumption RPC.
drop function public.record_rearing_feed_consumption(uuid,uuid,date,numeric,uuid,text,text);
create function public.record_rearing_feed_consumption(target_batch uuid,target_feed_type uuid,target_date date,
  target_quantity_kg numeric,target_daily_record uuid default null,target_notes text default null)
returns public.rearing_feed_consumptions language plpgsql security definer set search_path='' as $$
declare b public.rearing_batches;ro text;today date;cid uuid:=gen_random_uuid();mid uuid;result public.rearing_feed_consumptions;
begin
  select * into b from public.rearing_batches where id=target_batch for update;
  select fm.role into ro from public.farm_members fm where fm.farm_id=b.farm_id and fm.user_id=auth.uid() and fm.active;
  if b.id is null or ro is null or not exists(select 1 from public.feed_types ft where ft.id=target_feed_type and ft.farm_id=b.farm_id and ft.active) then
    raise exception 'Rearing feed access denied' using errcode='42501';end if;
  select (now() at time zone timezone)::date into today from public.farms where id=b.farm_id;
  if ro not in('admin','manager','worker') then raise exception 'Rearing feed access denied' using errcode='42501';end if;
  if target_date<b.arrival_date or target_date>today or (ro='worker' and target_date<>today) or target_quantity_kg<=0 then
    raise exception 'Invalid rearing feed date or quantity' using errcode='23514';end if;
  if target_daily_record is not null and not exists(select 1 from public.rearing_daily_records d where d.id=target_daily_record and d.farm_id=b.farm_id and d.rearing_batch_id=b.id and d.record_date=target_date) then
    raise exception 'Daily record does not match rearing batch and date' using errcode='23514';end if;
  perform pg_advisory_xact_lock(hashtextextended(b.farm_id::text||target_feed_type::text,0));
  mid:=gen_random_uuid();
  insert into public.feed_inventory_movements(id,farm_id,flock_id,rearing_batch_id,feed_type_id,movement_date,movement_type,direction,quantity_kg,source_type,source_id,notes,created_by)
    values(mid,b.farm_id,null,b.id,target_feed_type,target_date,'consumption','OUT',round(target_quantity_kg,3),'rearing_feed_consumption',cid,nullif(trim(target_notes),''),auth.uid());
  perform public.recalculate_feed_ledger(b.farm_id,target_feed_type);
  insert into public.rearing_feed_consumptions(id,farm_id,rearing_batch_id,feed_type_id,daily_record_id,movement_id,consumption_date,quantity_kg,created_by)
    values(cid,b.farm_id,b.id,target_feed_type,target_daily_record,mid,target_date,round(target_quantity_kg,3),auth.uid()) returning * into result;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
    values(b.farm_id,auth.uid(),'rearing.feed_consumed','feed_inventory_movements',mid,'Feed consumed by rearing batch',jsonb_build_object('batch_id',b.id,'feed_type_id',target_feed_type,'date',target_date,'quantity_kg',round(target_quantity_kg,3)));
  return result;
end;$$;
revoke all on function public.record_rearing_feed_consumption(uuid,uuid,date,numeric,uuid,text) from public,anon;
grant execute on function public.record_rearing_feed_consumption(uuid,uuid,date,numeric,uuid,text) to authenticated;
