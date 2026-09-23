-- Phase 2 SQL lint and concurrency corrections discovered during local validation.
create or replace view public.v_upcoming_health_actions with(security_invoker=true) as
select h.id,h.farm_id,h.flock_id,h.record_date,h.health_type,h.product_name,h.reason,h.dose,h.route,h.duration,
  h.quantity,h.quantity_unit,h.veterinary_provider,h.cost,h.next_due_date,h.notes,h.status,h.voided_at,h.voided_by,
  h.void_reason,h.created_at,h.created_by,h.updated_at,h.updated_by,
  coalesce(f.flock_name,b.batch_code) flock_name,h.rearing_batch_id,b.batch_code rearing_batch_code
from public.health_records h left join public.flocks f on f.id=h.flock_id
left join public.rearing_batches b on b.id=h.rearing_batch_id
where h.status='active' and h.next_due_date is not null;

create or replace function public.correct_rearing_feed_consumption(target_consumption uuid,target_feed_type uuid,target_date date,
  target_quantity_kg numeric,target_reason text,target_notes text default null)
returns public.rearing_feed_consumptions language plpgsql security definer set search_path='' as $$
declare old public.rearing_feed_consumptions;b public.rearing_batches;ro text;today date;reversal_id uuid:=gen_random_uuid();new_id uuid:=gen_random_uuid();new_move uuid:=gen_random_uuid();result public.rearing_feed_consumptions;old_move public.feed_inventory_movements;
begin
  select * into old from public.rearing_feed_consumptions where id=target_consumption for update;
  select * into b from public.rearing_batches where id=old.rearing_batch_id for update;
  select role into ro from public.farm_members where farm_id=old.farm_id and user_id=auth.uid() and active;
  if old.id is null or not old.active or ro not in('admin','manager') then raise exception 'Feed correction access denied' using errcode='42501';end if;
  if char_length(trim(target_reason))<3 or target_quantity_kg<=0 or target_date<b.arrival_date then raise exception 'A correction reason and valid quantity/date are required' using errcode='23514';end if;
  select (now() at time zone timezone)::date into today from public.farms where id=b.farm_id;
  if target_date>today or not exists(select 1 from public.feed_types where id=target_feed_type and farm_id=b.farm_id and active) then raise exception 'Invalid replacement feed/date' using errcode='23514';end if;
  select * into old_move from public.feed_inventory_movements where id=old.movement_id;
  -- Lock both product ledgers in a deterministic order before writing either.
  if target_feed_type=old.feed_type_id then
    perform pg_advisory_xact_lock(hashtextextended(b.farm_id::text||old.feed_type_id::text,0));
  elsif target_feed_type<old.feed_type_id then
    perform pg_advisory_xact_lock(hashtextextended(b.farm_id::text||target_feed_type::text,0));
    perform pg_advisory_xact_lock(hashtextextended(b.farm_id::text||old.feed_type_id::text,0));
  else
    perform pg_advisory_xact_lock(hashtextextended(b.farm_id::text||old.feed_type_id::text,0));
    perform pg_advisory_xact_lock(hashtextextended(b.farm_id::text||target_feed_type::text,0));
  end if;
  insert into public.feed_inventory_movements(id,farm_id,rearing_batch_id,feed_type_id,movement_date,movement_type,direction,quantity_kg,unit_cost_snapshot,total_cost_snapshot,source_type,source_id,notes,created_by)
    values(reversal_id,b.farm_id,b.id,old.feed_type_id,old.consumption_date,'consumption_reversal','IN',old.quantity_kg,old_move.unit_cost_snapshot,old_move.total_cost_snapshot,'rearing_feed_reversal',old.id,'Correction reversal: '||trim(target_reason),auth.uid());
  update public.rearing_feed_consumptions set active=false,reversed_by=reversal_id,correction_reason=trim(target_reason) where id=old.id;
  perform public.recalculate_feed_ledger(b.farm_id,old.feed_type_id);
  insert into public.feed_inventory_movements(id,farm_id,rearing_batch_id,feed_type_id,movement_date,movement_type,direction,quantity_kg,source_type,source_id,notes,created_by)
    values(new_move,b.farm_id,b.id,target_feed_type,target_date,'consumption','OUT',round(target_quantity_kg,3),'rearing_feed_consumption',new_id,nullif(trim(target_notes),''),auth.uid());
  perform public.recalculate_feed_ledger(b.farm_id,target_feed_type);
  insert into public.rearing_feed_consumptions(id,farm_id,rearing_batch_id,feed_type_id,daily_record_id,movement_id,consumption_date,quantity_kg,created_by)
    values(new_id,b.farm_id,b.id,target_feed_type,case when target_date=old.consumption_date then old.daily_record_id else null end,new_move,target_date,round(target_quantity_kg,3),auth.uid()) returning * into result;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
    values(b.farm_id,auth.uid(),'rearing.feed_consumption_corrected','rearing_feed_consumptions',old.id,'Rearing feed consumption corrected',jsonb_build_object('reason',trim(target_reason),'replacement_id',new_id,'old_quantity_kg',old.quantity_kg,'new_quantity_kg',round(target_quantity_kg,3)));
  return result;
end;$$;

create or replace function public.get_rearing_cost_summary(target_batch uuid)
returns table(rearing_batch_id uuid,feed_consumed_kg numeric,feed_cost numeric,acquisition_cost numeric,health_cost numeric,
  other_direct_cost numeric,accumulated_rearing_cost numeric,cash_paid_against_linked_expenses numeric,
  outstanding_linked_expenses numeric,current_surviving_birds integer,cost_per_surviving_pullet numeric)
language plpgsql stable security definer set search_path='' as $$
declare f uuid;
begin
  select rb.farm_id into f from public.rearing_batches rb where rb.id=target_batch;
  if f is null or not public.has_farm_role(f,array['admin','manager']) then raise exception 'Financial access denied' using errcode='42501';end if;
  return query with feed as(
    select coalesce(sum(c.quantity_kg),0)::numeric feed_kg,coalesce(sum(m.total_cost_snapshot),0)::numeric cost
    from public.rearing_feed_consumptions c join public.feed_inventory_movements m on m.id=c.movement_id
    where c.rearing_batch_id=target_batch and c.farm_id=f and c.active
  ), expenses_by_kind as(
    select coalesce(sum(e.amount) filter(where e.rearing_cost_kind='acquisition'),0)::numeric acquisition,
      coalesce(sum(e.amount) filter(where e.rearing_cost_kind='health'),0)::numeric health,
      coalesce(sum(e.amount) filter(where e.rearing_cost_kind='other_direct'),0)::numeric other_cost,
      coalesce(sum(p.paid),0)::numeric paid,
      coalesce(sum(e.amount-coalesce(p.paid,0)),0)::numeric outstanding
    from public.expenses e left join lateral(select sum(x.amount) paid from public.expense_payments x where x.expense_id=e.id and x.voided_at is null) p on true
    where e.rearing_batch_id=target_batch and e.farm_id=f and e.status='active'
  ),population as(select vp.current_birds from public.v_rearing_population vp where vp.batch_id=target_batch)
  select target_batch,feed.feed_kg,feed.cost,expenses_by_kind.acquisition,expenses_by_kind.health,expenses_by_kind.other_cost,
    feed.cost+expenses_by_kind.acquisition+expenses_by_kind.health+expenses_by_kind.other_cost,
    expenses_by_kind.paid,expenses_by_kind.outstanding,population.current_birds,
    case when population.current_birds>0 then round((feed.cost+expenses_by_kind.acquisition+expenses_by_kind.health+expenses_by_kind.other_cost)/population.current_birds,2) else null end
  from feed cross join expenses_by_kind cross join population;
end;$$;

create or replace function public.get_rearing_feed_cost_history(target_batch uuid)
returns table(id uuid,feed_type_id uuid,feed_name text,consumption_date date,quantity_kg numeric,unit_cost numeric,total_cost numeric,active boolean,created_by uuid)
language plpgsql stable security definer set search_path='' as $$
declare f uuid;
begin
  select rb.farm_id into f from public.rearing_batches rb where rb.id=target_batch;
  if f is null or not public.has_farm_role(f,array['admin','manager']) then raise exception 'Financial access denied' using errcode='42501';end if;
  return query select c.id,c.feed_type_id,ft.name,c.consumption_date,c.quantity_kg,m.unit_cost_snapshot,m.total_cost_snapshot,c.active,c.created_by
  from public.rearing_feed_consumptions c join public.feed_types ft on ft.id=c.feed_type_id join public.feed_inventory_movements m on m.id=c.movement_id
  where c.rearing_batch_id=target_batch and c.farm_id=f order by c.consumption_date desc,c.created_at desc;
end;$$;

revoke all on function public.correct_rearing_feed_consumption(uuid,uuid,date,numeric,text,text),public.get_rearing_cost_summary(uuid),public.get_rearing_feed_cost_history(uuid) from public,anon;
grant execute on function public.correct_rearing_feed_consumption(uuid,uuid,date,numeric,text,text),public.get_rearing_cost_summary(uuid),public.get_rearing_feed_cost_history(uuid) to authenticated;
