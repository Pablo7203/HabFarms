-- Admin/manager corrections may change a saved daily record date. Keep the
-- bird ledger append-only: reverse the old mortality movement, validate the
-- corrected date, and post the corrected movement at its new date.
-- Linked feed usage remains on its actual consumption date; detach only the
-- optional daily-record association when that record is moved to another day.
-- Feed-correction RPC lock order is aligned (batch before consumption) below.
-- Forward-only migration: a rollback must be a new migration restoring the
-- prior RPC behavior; no historical ledger rows are rewritten or deleted.

create or replace function public.save_rearing_daily_record(
  target_batch uuid,
  target_record_date date,
  target_deaths integer,
  target_observations text,
  target_record uuid default null
)
returns public.rearing_daily_records
language plpgsql security definer set search_path=''
as $$
declare
  b public.rearing_batches;
  existing public.rearing_daily_records;
  r public.rearing_daily_records;
  member_role text;
  farm_timezone text;
  available integer;
  old_movement public.rearing_movements;
  new_movement public.rearing_movements;
  date_changed boolean := false;
  mortality_changed boolean := false;
  detached_feed_ids uuid[] := array[]::uuid[];
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  select * into b from public.rearing_batches where id=target_batch for update;
  if b.id is null then
    raise exception 'Rearing batch not found' using errcode='23503';
  end if;
  select role into member_role from public.farm_members
    where farm_id=b.farm_id and user_id=auth.uid() and active;
  select timezone into farm_timezone from public.farms where id=b.farm_id;
  if member_role is null then
    raise exception 'Rearing record access denied' using errcode='42501';
  end if;
  if target_record_date is null or target_deaths is null or target_deaths<0
    or char_length(coalesce(target_observations,''))>2000
    or target_record_date<b.arrival_date
    or target_record_date>(now() at time zone farm_timezone)::date then
    raise exception 'Invalid rearing daily record date or values' using errcode='23514';
  end if;
  if member_role='worker' and target_record_date<>(now() at time zone farm_timezone)::date then
    raise exception 'Workers may record today only' using errcode='42501';
  end if;

  if target_record is null then
    if b.status not in ('active','partially_transferred') then
      raise exception 'Rearing batch is not open for daily operations' using errcode='23514';
    end if;
    available:=public.rearing_balance_at(b.id,target_record_date);
    if target_deaths>available then
      raise exception 'Deaths exceed birds available on that date' using errcode='23514';
    end if;
    insert into public.rearing_daily_records(
      farm_id,rearing_batch_id,record_date,deaths,observations,created_by,updated_by
    ) values (
      b.farm_id,b.id,target_record_date,target_deaths,nullif(trim(target_observations),''),auth.uid(),auth.uid()
    ) returning * into r;
    if target_deaths>0 then
      insert into public.rearing_movements(
        farm_id,rearing_batch_id,daily_record_id,movement_date,movement_type,direction,quantity,created_by
      ) values (
        b.farm_id,b.id,r.id,target_record_date,'death','OUT',target_deaths,auth.uid()
      ) returning * into new_movement;
      perform public.assert_nonnegative_rearing_history(b.id);
      insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
      values(b.farm_id,auth.uid(),'rearing_mortality.recorded','rearing_movements',new_movement.id,
        'Rearing mortality recorded',jsonb_build_object(
          'batch_code',b.batch_code,'event_date',target_record_date,'quantity',target_deaths
        ));
    end if;
    insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
    values(b.farm_id,auth.uid(),'rearing_daily_record.created','rearing_daily_records',r.id,
      'Rearing daily record created',jsonb_build_object(
        'batch_code',b.batch_code,'record_date',target_record_date,'deaths',target_deaths
      ));
    return r;
  end if;

  if member_role not in ('admin','manager') then
    raise exception 'Only farm admins or managers may correct a posted daily record' using errcode='42501';
  end if;
  select * into existing from public.rearing_daily_records
    where id=target_record and rearing_batch_id=b.id and farm_id=b.farm_id for update;
  if existing.id is null then
    raise exception 'Daily record not found for this batch' using errcode='23503';
  end if;

  date_changed:=existing.record_date is distinct from target_record_date;
  mortality_changed:=existing.deaths is distinct from target_deaths;

  if date_changed or mortality_changed then
    select * into old_movement from public.rearing_movements m
    where m.daily_record_id=existing.id and m.movement_type='death'
      and not exists (
        select 1 from public.rearing_movements reversal where reversal.reversal_of=m.id
      )
    order by m.created_at desc limit 1 for update;

    if (existing.deaths>0 and (old_movement.id is null or old_movement.quantity<>existing.deaths))
      or (existing.deaths=0 and old_movement.id is not null) then
      raise exception 'Daily mortality ledger integrity check failed; contact support before correcting this record' using errcode='23514';
    end if;

    if old_movement.id is not null then
      insert into public.rearing_movements(
        farm_id,rearing_batch_id,daily_record_id,movement_date,movement_type,direction,quantity,reversal_of,created_by
      ) values (
        b.farm_id,b.id,existing.id,existing.record_date,'reversal','IN',old_movement.quantity,old_movement.id,auth.uid()
      );
      insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
      values(b.farm_id,auth.uid(),'rearing_mortality.reversed','rearing_movements',old_movement.id,
        'Rearing mortality reversed for correction',jsonb_build_object(
          'batch_code',b.batch_code,'event_date',existing.record_date,'quantity',old_movement.quantity,
          'corrected_record_date',target_record_date
        ));
    end if;

    available:=public.rearing_balance_at(b.id,target_record_date);
    if target_deaths>available then
      raise exception 'Deaths exceed birds available on the corrected date' using errcode='23514';
    end if;
  end if;

  if date_changed then
    select coalesce(array_agg(id order by id),array[]::uuid[]) into detached_feed_ids
      from public.rearing_feed_consumptions where daily_record_id=existing.id;
    update public.rearing_feed_consumptions set daily_record_id=null where daily_record_id=existing.id;
  end if;

  update public.rearing_daily_records
    set record_date=target_record_date,deaths=target_deaths,
      observations=nullif(trim(target_observations),''),updated_by=auth.uid()
    where id=existing.id returning * into r;

  if (date_changed or mortality_changed) and target_deaths>0 then
    insert into public.rearing_movements(
      farm_id,rearing_batch_id,daily_record_id,movement_date,movement_type,direction,quantity,created_by
    ) values (
      b.farm_id,b.id,r.id,target_record_date,'death','OUT',target_deaths,auth.uid()
    ) returning * into new_movement;
    insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
    values(b.farm_id,auth.uid(),'rearing_mortality.recorded','rearing_movements',new_movement.id,
      'Corrected rearing mortality recorded',jsonb_build_object(
        'batch_code',b.batch_code,'event_date',target_record_date,'quantity',target_deaths,
        'previous_event_date',existing.record_date
      ));
  end if;

  if date_changed or mortality_changed then
    perform public.assert_nonnegative_rearing_history(b.id);
  end if;

  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
  values(b.farm_id,auth.uid(),'rearing_daily_record.corrected','rearing_daily_records',r.id,
    'Rearing daily record corrected',jsonb_build_object(
      'batch_code',b.batch_code,'previous_record_date',existing.record_date,'record_date',r.record_date,
      'previous_deaths',existing.deaths,'new_deaths',target_deaths,
      'previous_observations',existing.observations,'new_observations',r.observations,
      'detached_feed_consumption_ids',to_jsonb(detached_feed_ids)
    ));
  return r;
exception when unique_violation then
  raise exception 'A daily record already exists for this batch and date' using errcode='23505';
end;
$$;

-- Keep correction lock order consistent with daily-record corrections:
-- batch row first, feed-consumption row second. Otherwise a simultaneous date
-- correction and feed correction can deadlock while the latter holds a feed
-- row and waits for the batch lock.
create or replace function public.correct_rearing_feed_consumption(
  target_consumption uuid,
  target_feed_type uuid,
  target_date date,
  target_quantity_kg numeric,
  target_reason text,
  target_notes text default null
)
returns public.rearing_feed_consumptions
language plpgsql
security definer
set search_path=''
as $$
declare
  old public.rearing_feed_consumptions;
  b public.rearing_batches;
  ro text;
  today date;
  reversal_id uuid:=gen_random_uuid();
  new_id uuid:=gen_random_uuid();
  new_move uuid:=gen_random_uuid();
  result public.rearing_feed_consumptions;
  old_move public.feed_inventory_movements;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  -- Read the owning batch id without locking the consumption, then acquire
  -- locks in the common batch -> consumption order and reread current values.
  select * into old from public.rearing_feed_consumptions where id=target_consumption;
  if old.id is null then
    raise exception 'Feed correction access denied' using errcode='42501';
  end if;
  select * into b from public.rearing_batches where id=old.rearing_batch_id for update;
  if b.id is null then
    raise exception 'Feed correction access denied' using errcode='42501';
  end if;
  select * into old from public.rearing_feed_consumptions where id=target_consumption for update;
  select role into ro from public.farm_members where farm_id=old.farm_id and user_id=auth.uid() and active;
  if old.id is null or old.rearing_batch_id<>b.id or not old.active or ro is null or ro not in('admin','manager') then
    raise exception 'Feed correction access denied' using errcode='42501';
  end if;
  if target_reason is null or char_length(trim(target_reason))<3
    or target_quantity_kg is null or target_quantity_kg<=0
    or target_date is null or target_date<b.arrival_date then
    raise exception 'A correction reason and valid quantity/date are required' using errcode='23514';
  end if;
  select (now() at time zone timezone)::date into today from public.farms where id=b.farm_id;
  if target_date>today or not exists(
    select 1 from public.feed_types where id=target_feed_type and farm_id=b.farm_id and active
  ) then
    raise exception 'Invalid replacement feed/date' using errcode='23514';
  end if;
  select * into old_move from public.feed_inventory_movements where id=old.movement_id for update;

  if target_feed_type=old.feed_type_id then
    perform pg_advisory_xact_lock(hashtextextended(b.farm_id::text||old.feed_type_id::text,0));
  elsif target_feed_type<old.feed_type_id then
    perform pg_advisory_xact_lock(hashtextextended(b.farm_id::text||target_feed_type::text,0));
    perform pg_advisory_xact_lock(hashtextextended(b.farm_id::text||old.feed_type_id::text,0));
  else
    perform pg_advisory_xact_lock(hashtextextended(b.farm_id::text||old.feed_type_id::text,0));
    perform pg_advisory_xact_lock(hashtextextended(b.farm_id::text||target_feed_type::text,0));
  end if;

  insert into public.feed_inventory_movements(
    id,farm_id,rearing_batch_id,feed_type_id,movement_date,movement_type,direction,quantity_kg,
    unit_cost_snapshot,total_cost_snapshot,source_type,source_id,notes,created_by
  ) values (
    reversal_id,b.farm_id,b.id,old.feed_type_id,old.consumption_date,'consumption_reversal','IN',
    old.quantity_kg,old_move.unit_cost_snapshot,old_move.total_cost_snapshot,
    'rearing_feed_reversal',old.id,'Correction reversal: '||trim(target_reason),auth.uid()
  );
  update public.rearing_feed_consumptions
    set active=false,reversed_by=reversal_id,correction_reason=trim(target_reason)
    where id=old.id;
  perform public.recalculate_feed_ledger(b.farm_id,old.feed_type_id);

  insert into public.feed_inventory_movements(
    id,farm_id,rearing_batch_id,feed_type_id,movement_date,movement_type,direction,quantity_kg,
    source_type,source_id,notes,created_by
  ) values (
    new_move,b.farm_id,b.id,target_feed_type,target_date,'consumption','OUT',
    round(target_quantity_kg,3),'rearing_feed_consumption',new_id,nullif(trim(target_notes),''),auth.uid()
  );
  perform public.recalculate_feed_ledger(b.farm_id,target_feed_type);
  insert into public.rearing_feed_consumptions(
    id,farm_id,rearing_batch_id,feed_type_id,daily_record_id,movement_id,consumption_date,quantity_kg,created_by
  ) values (
    new_id,b.farm_id,b.id,target_feed_type,
    case when target_date=old.consumption_date then old.daily_record_id else null end,
    new_move,target_date,round(target_quantity_kg,3),auth.uid()
  ) returning * into result;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
    values(
      b.farm_id,auth.uid(),'rearing.feed_consumption_corrected','rearing_feed_consumptions',old.id,
      'Rearing feed consumption corrected',
      jsonb_build_object(
        'reason',trim(target_reason),'replacement_id',new_id,
        'old_quantity_kg',old.quantity_kg,'new_quantity_kg',round(target_quantity_kg,3)
      )
    );
  return result;
end;
$$;
