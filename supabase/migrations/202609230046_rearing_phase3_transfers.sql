-- DOC Phase 3: auditable internal movement from rearing batches to layer flocks.
-- This is a population/cost-basis transfer only: it creates no cash, expense,
-- purchase, sale, receivable, payable, feed, or egg-ledger transaction.

alter table public.flocks add column population_is_transfer_only boolean not null default false;
alter table public.flocks drop constraint flocks_initial_birds_check;
alter table public.flocks add constraint flocks_initial_birds_check
  check (initial_birds >= 0 and (initial_birds > 0 or population_is_transfer_only));

-- Preserve the normal direct flock-creation contract after permitting zero only
-- for the transfer RPC's internal flock initialization.
create or replace function public.create_flock(
  flock_name text,batch_reference text,breed text,house_pen text,start_date date,
  initial_birds integer,age_at_arrival_weeks integer,source text,notes text
) returns public.flocks language plpgsql security definer set search_path='' as $$
declare target_farm uuid; created public.flocks;
begin
  if auth.uid() is null or initial_birds is null or initial_birds<=0 then
    raise exception 'A directly acquired flock must start with a positive bird count' using errcode='23514';
  end if;
  select farm_id into target_farm from public.farm_members
    where user_id=auth.uid() and active and role in ('admin','manager')
      and public.has_farm_role(farm_id,array['admin','manager'])
    order by created_at limit 1;
  if target_farm is null or not public.has_farm_role(target_farm,array['admin','manager']) then
    raise exception 'Admin or manager access required' using errcode='42501';
  end if;
  insert into public.flocks(farm_id,flock_name,batch_reference,breed,house_pen,start_date,initial_birds,age_at_arrival_weeks,source,notes,created_by)
  values(target_farm,trim(flock_name),nullif(trim(batch_reference),''),nullif(trim(breed),''),nullif(trim(house_pen),''),start_date,initial_birds,age_at_arrival_weeks,nullif(trim(source),''),nullif(trim(notes),''),auth.uid()) returning * into created;
  return created;
end; $$;

create or replace function public.change_rearing_batch_stage(target_batch uuid,new_stage text)
returns public.rearing_batches language plpgsql security definer set search_path='' as $$
declare b public.rearing_batches; result public.rearing_batches;
begin
  select * into b from public.rearing_batches where id=target_batch for update;
  if b.id is null or b.status not in('active','partially_transferred') or not public.has_farm_role(b.farm_id,array['admin','manager']) then
    raise exception 'Rearing stage access denied' using errcode='42501'; end if;
  if new_stage not in('brooding','growing','ready_for_transfer') then raise exception 'Invalid lifecycle stage' using errcode='23514'; end if;
  if new_stage is distinct from b.stage then
    update public.rearing_batches set stage=new_stage,updated_by=auth.uid() where id=b.id returning * into result;
    insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
      values(b.farm_id,auth.uid(),'rearing_batch.stage_changed','rearing_batches',b.id,'Rearing batch stage changed',
        jsonb_build_object('batch_code',b.batch_code,'previous_stage',b.stage,'new_stage',new_stage));
  else result:=b; end if;
  return result;
end; $$;

create or replace function public.save_rearing_daily_record(target_batch uuid,target_record_date date,target_deaths integer,target_observations text,target_record uuid default null)
returns public.rearing_daily_records language plpgsql security definer set search_path='' as $$
declare b public.rearing_batches; existing public.rearing_daily_records; r public.rearing_daily_records; member_role text; farm_timezone text; available integer; old_movement public.rearing_movements; new_movement public.rearing_movements;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into b from public.rearing_batches where id=target_batch for update;
  if b.id is null or b.status not in('active','partially_transferred') then raise exception 'Rearing batch is not open for daily operations' using errcode='23514'; end if;
  select role into member_role from public.farm_members where farm_id=b.farm_id and user_id=auth.uid() and active;
  select timezone into farm_timezone from public.farms where id=b.farm_id;
  if member_role is null then raise exception 'Rearing record access denied' using errcode='42501'; end if;
  if target_deaths is null or target_deaths<0 or char_length(coalesce(target_observations,''))>2000
    or target_record_date<b.arrival_date or target_record_date>(now() at time zone farm_timezone)::date then raise exception 'Invalid rearing daily record date or values' using errcode='23514'; end if;
  if member_role='worker' and target_record_date<>(now() at time zone farm_timezone)::date then raise exception 'Workers may record today only' using errcode='42501'; end if;
  if target_record is null then
    available:=public.rearing_balance_at(b.id,target_record_date);
    if target_deaths>available then raise exception 'Deaths exceed birds available on that date' using errcode='23514'; end if;
    insert into public.rearing_daily_records(farm_id,rearing_batch_id,record_date,deaths,observations,created_by,updated_by)
      values(b.farm_id,b.id,target_record_date,target_deaths,nullif(trim(target_observations),''),auth.uid(),auth.uid()) returning * into r;
    if target_deaths>0 then
      insert into public.rearing_movements(farm_id,rearing_batch_id,daily_record_id,movement_date,movement_type,direction,quantity,created_by)
        values(b.farm_id,b.id,r.id,target_record_date,'death','OUT',target_deaths,auth.uid()) returning * into new_movement;
      perform public.assert_nonnegative_rearing_history(b.id);
      insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
        values(b.farm_id,auth.uid(),'rearing_mortality.recorded','rearing_movements',new_movement.id,'Rearing mortality recorded',
          jsonb_build_object('batch_code',b.batch_code,'event_date',target_record_date,'quantity',target_deaths));
    end if;
    insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
      values(b.farm_id,auth.uid(),'rearing_daily_record.created','rearing_daily_records',r.id,'Rearing daily record created',
        jsonb_build_object('batch_code',b.batch_code,'record_date',target_record_date,'deaths',target_deaths));
    return r;
  end if;
  if member_role not in('admin','manager') then raise exception 'Only farm admins or managers may correct a posted daily record' using errcode='42501'; end if;
  select * into existing from public.rearing_daily_records where id=target_record and rearing_batch_id=b.id and farm_id=b.farm_id for update;
  if existing.id is null or existing.record_date is distinct from target_record_date then raise exception 'Daily record not found or date cannot be changed' using errcode='23503'; end if;
  if existing.deaths is distinct from target_deaths then
    select * into old_movement from public.rearing_movements m where m.daily_record_id=existing.id and m.movement_type='death'
      and not exists(select 1 from public.rearing_movements reversal where reversal.reversal_of=m.id)
      order by m.created_at desc limit 1 for update;
    if existing.deaths>0 and (old_movement.id is null or old_movement.quantity<>existing.deaths) then
      raise exception 'Daily mortality ledger integrity check failed; contact support before correcting this record' using errcode='23514'; end if;
    if old_movement.id is not null then
      insert into public.rearing_movements(farm_id,rearing_batch_id,daily_record_id,movement_date,movement_type,direction,quantity,reversal_of,created_by)
        values(b.farm_id,b.id,existing.id,existing.record_date,'reversal','IN',old_movement.quantity,old_movement.id,auth.uid());
      insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
        values(b.farm_id,auth.uid(),'rearing_mortality.reversed','rearing_movements',old_movement.id,'Rearing mortality reversed for correction',
          jsonb_build_object('batch_code',b.batch_code,'event_date',existing.record_date,'quantity',old_movement.quantity));
    end if;
    available:=public.rearing_balance_at(b.id,target_record_date);
    if target_deaths>available then raise exception 'Deaths exceed birds available on that date' using errcode='23514'; end if;
  end if;
  update public.rearing_daily_records set deaths=target_deaths,observations=nullif(trim(target_observations),''),updated_by=auth.uid()
    where id=existing.id returning * into r;
  if existing.deaths is distinct from target_deaths and target_deaths>0 then
    insert into public.rearing_movements(farm_id,rearing_batch_id,daily_record_id,movement_date,movement_type,direction,quantity,created_by)
      values(b.farm_id,b.id,r.id,r.record_date,'death','OUT',target_deaths,auth.uid()) returning * into new_movement;
  end if;
  if existing.deaths is distinct from target_deaths then perform public.assert_nonnegative_rearing_history(b.id); end if;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
    values(b.farm_id,auth.uid(),'rearing_daily_record.corrected','rearing_daily_records',r.id,'Rearing daily record corrected',
      jsonb_build_object('batch_code',b.batch_code,'record_date',r.record_date,'previous_deaths',existing.deaths,'new_deaths',target_deaths));
  return r;
exception when unique_violation then raise exception 'A daily record already exists for this batch and date' using errcode='23505';
end; $$;

create table public.rearing_transfers (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  source_batch_id uuid not null,
  destination_flock_id uuid not null,
  transfer_date date not null,
  quantity integer not null check(quantity>0),
  source_birds_before integer not null check(source_birds_before>=quantity),
  source_birds_after integer not null check(source_birds_after=source_birds_before-quantity),
  destination_birds_before integer not null check(destination_birds_before>=0),
  destination_birds_after integer not null check(destination_birds_after=destination_birds_before+quantity),
  source_cost_before numeric(14,2) not null check(source_cost_before>=0),
  unit_cost_snapshot numeric(14,4) not null check(unit_cost_snapshot>=0),
  total_cost_transferred numeric(14,2) not null check(total_cost_transferred>=0),
  remaining_cost_after numeric(14,2) not null check(remaining_cost_after>=0),
  cost_policy text not null default 'remaining-cost-per-available-bird-v1',
  cost_review_confirmed boolean not null,
  cost_reviewed_by uuid not null references public.profiles(id),
  cost_reviewed_at timestamptz not null default now(),
  source_movement_id uuid,
  destination_movement_id uuid,
  idempotency_key uuid not null,
  request_fingerprint text not null,
  status text not null default 'posting' check(status in('posting','posted','reversed')),
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references public.profiles(id),
  reversal_reason text,
  constraint rearing_transfer_source_batch_same_farm foreign key(source_batch_id,farm_id)
    references public.rearing_batches(id,farm_id) on delete restrict,
  constraint rearing_transfer_destination_flock_same_farm foreign key(destination_flock_id,farm_id)
    references public.flocks(id,farm_id) on delete restrict,
  constraint rearing_transfer_id_farm_batch_unique unique(id,farm_id,source_batch_id),
  constraint rearing_transfer_id_farm_flock_unique unique(id,farm_id,destination_flock_id),
  constraint rearing_transfer_source_movement_unique unique(source_movement_id),
  constraint rearing_transfer_destination_movement_unique unique(destination_movement_id),
  constraint rearing_transfer_idempotency_unique unique(farm_id,idempotency_key),
  constraint rearing_transfer_reversal_state check (
    (status in('posting','posted') and reversed_at is null and reversed_by is null and reversal_reason is null)
    or (status='reversed' and reversed_at is not null and reversed_by is not null and char_length(trim(reversal_reason))>=3)
  )
);
create index rearing_transfers_batch_date_idx on public.rearing_transfers(farm_id,source_batch_id,transfer_date,created_at);
create index rearing_transfers_destination_idx on public.rearing_transfers(farm_id,destination_flock_id,transfer_date);

alter table public.rearing_movements add column transfer_id uuid;
alter table public.rearing_movements drop constraint rearing_movements_movement_type_check;
alter table public.rearing_movements add constraint rearing_movements_movement_type_check
  check(movement_type in('arrival','death','reversal','transfer_out','transfer_reversal'));
-- Replace the old same-named check with a rule that permits transfer pairs.
alter table public.rearing_movements drop constraint rearing_movement_kind_direction;
alter table public.rearing_movements add constraint rearing_movement_kind_direction
  check (
    (movement_type='arrival' and direction='IN' and daily_record_id is null and reversal_of is null and transfer_id is null)
    or (movement_type='death' and direction='OUT' and daily_record_id is not null and reversal_of is null and transfer_id is null)
    or (movement_type='reversal' and direction='IN' and daily_record_id is not null and reversal_of is not null and transfer_id is null)
    or (movement_type='transfer_out' and direction='OUT' and daily_record_id is null and reversal_of is null and transfer_id is not null)
    or (movement_type='transfer_reversal' and direction='IN' and daily_record_id is null and reversal_of is not null and transfer_id is not null)
  );

alter table public.bird_movements add column rearing_transfer_id uuid;
alter table public.bird_movements add constraint bird_movement_id_farm_flock_unique unique(id,farm_id,flock_id);
alter table public.bird_movements add constraint bird_movement_rearing_transfer_invariant
  check(rearing_transfer_id is null or (source_type='rearing_transfer' and source_id=rearing_transfer_id and movement_type in('transfer_in','transfer_out')));
alter table public.rearing_transfers
  add constraint rearing_transfer_source_movement_same_batch foreign key(source_movement_id,farm_id,source_batch_id)
    references public.rearing_movements(id,farm_id,rearing_batch_id) on delete restrict,
  add constraint rearing_transfer_destination_movement_same_flock foreign key(destination_movement_id,farm_id,destination_flock_id)
    references public.bird_movements(id,farm_id,flock_id) on delete restrict;
alter table public.rearing_movements
  add constraint rearing_movement_transfer_same_batch foreign key(transfer_id,farm_id,rearing_batch_id)
    references public.rearing_transfers(id,farm_id,source_batch_id) on delete restrict;
alter table public.bird_movements
  add constraint bird_movement_transfer_same_flock foreign key(rearing_transfer_id,farm_id,flock_id)
    references public.rearing_transfers(id,farm_id,destination_flock_id) on delete restrict;
create unique index rearing_transfer_one_outbound_idx on public.rearing_movements(transfer_id) where movement_type='transfer_out';
create unique index rearing_transfer_one_inbound_idx on public.bird_movements(rearing_transfer_id) where rearing_transfer_id is not null and movement_type='transfer_in';
create unique index rearing_movements_one_transfer_reversal_idx on public.rearing_movements(reversal_of) where movement_type='transfer_reversal';
create unique index bird_movements_one_transfer_reversal_idx on public.bird_movements(rearing_transfer_id) where rearing_transfer_id is not null and movement_type='transfer_out';

alter table public.rearing_transfers enable row level security;
create policy rearing_transfers_financial_read on public.rearing_transfers for select to authenticated
  using(public.has_farm_role(farm_id,array['admin','manager']));
revoke all on public.rearing_transfers from public,anon,authenticated;
grant select on public.rearing_transfers to authenticated;
grant all on public.rearing_transfers to service_role;

create or replace function public.rearing_cost_total_at(target_batch uuid,target_date date)
returns numeric language sql stable security definer set search_path='' as $$
  select round(
    coalesce((select sum(m.total_cost_snapshot) from public.rearing_feed_consumptions c
      join public.feed_inventory_movements m on m.id=c.movement_id and m.farm_id=c.farm_id
      where c.rearing_batch_id=target_batch and c.active and c.consumption_date<=target_date),0)
    + coalesce((select sum(e.amount) from public.expenses e
      where e.rearing_batch_id=target_batch and e.status='active' and e.expense_date<=target_date),0),2)
$$;
revoke all on function public.rearing_cost_total_at(uuid,date) from public,anon,authenticated;

create or replace function public.get_rearing_cost_summary(target_batch uuid)
returns table(rearing_batch_id uuid,feed_consumed_kg numeric,feed_cost numeric,acquisition_cost numeric,health_cost numeric,
  other_direct_cost numeric,accumulated_rearing_cost numeric,cash_paid_against_linked_expenses numeric,
  outstanding_linked_expenses numeric,current_surviving_birds integer,cost_per_surviving_pullet numeric)
language plpgsql stable security definer set search_path='' as $$
declare f uuid;
begin
  select rb.farm_id into f from public.rearing_batches rb where rb.id=target_batch;
  if f is null or not public.has_farm_role(f,array['admin','manager']) then raise exception 'Financial access denied' using errcode='42501'; end if;
  return query with feed as(
    select coalesce(sum(c.quantity_kg),0)::numeric feed_kg,coalesce(sum(m.total_cost_snapshot),0)::numeric cost
    from public.rearing_feed_consumptions c join public.feed_inventory_movements m on m.id=c.movement_id
    where c.rearing_batch_id=target_batch and c.farm_id=f and c.active
  ), expenses_by_kind as(
    select coalesce(sum(e.amount) filter(where e.rearing_cost_kind='acquisition'),0)::numeric acquisition,
      coalesce(sum(e.amount) filter(where e.rearing_cost_kind='health'),0)::numeric health,
      coalesce(sum(e.amount) filter(where e.rearing_cost_kind='other_direct'),0)::numeric other_cost,
      coalesce(sum(p.paid),0)::numeric paid,coalesce(sum(e.amount-coalesce(p.paid,0)),0)::numeric outstanding
    from public.expenses e left join lateral(select sum(x.amount) paid from public.expense_payments x where x.expense_id=e.id and x.voided_at is null) p on true
    where e.rearing_batch_id=target_batch and e.farm_id=f and e.status='active'
  ), population as(select current_birds from public.v_rearing_population where batch_id=target_batch), transfers as(
    select coalesce(sum(t.total_cost_transferred),0)::numeric transferred from public.rearing_transfers t
    where t.source_batch_id=target_batch and t.farm_id=f and t.status='posted'
  ), totals as(select feed.*,expenses_by_kind.*,population.current_birds,transfers.transferred,
    feed.cost+expenses_by_kind.acquisition+expenses_by_kind.health+expenses_by_kind.other_cost total
    from feed cross join expenses_by_kind cross join population cross join transfers)
  select target_batch,totals.feed_kg,totals.cost,totals.acquisition,totals.health,totals.other_cost,totals.total,
    totals.paid,totals.outstanding,totals.current_birds,
    case when totals.current_birds>0 then round(greatest(totals.total-totals.transferred,0)/totals.current_birds,2) else null end
  from totals;
end; $$;

create or replace function public.guard_closed_rearing_batch_operations()
returns trigger language plpgsql security definer set search_path='' as $$
declare batch uuid;
begin
  batch:=coalesce(new.rearing_batch_id,old.rearing_batch_id);
  if batch is not null and exists(select 1 from public.rearing_batches b where b.id=batch and b.status in('transferred','closed')) then
    raise exception 'This rearing batch is closed to new operational records' using errcode='23514'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
create trigger rearing_feed_no_closed_write before insert on public.rearing_feed_consumptions
  for each row execute function public.guard_closed_rearing_batch_operations();
create trigger rearing_health_no_closed_write before insert on public.health_records
  for each row when(new.rearing_batch_id is not null) execute function public.guard_closed_rearing_batch_operations();
create trigger rearing_expense_no_closed_write before insert on public.expenses
  for each row when(new.rearing_batch_id is not null) execute function public.guard_closed_rearing_batch_operations();

create or replace function public.guard_rearing_cost_against_posted_transfer()
returns trigger language plpgsql security definer set search_path='' as $$
declare batch_id uuid; effective_date date; old_batch uuid; old_date date;
begin
  if tg_table_name='expenses' then
    batch_id:=coalesce(new.rearing_batch_id,old.rearing_batch_id); effective_date:=coalesce(new.expense_date,old.expense_date);
    old_batch:=old.rearing_batch_id; old_date:=old.expense_date;
    if tg_op='UPDATE' and new.rearing_batch_id is not distinct from old_batch and new.expense_date is not distinct from old_date
      and new.amount is not distinct from old.amount and new.status is not distinct from old.status and new.rearing_cost_kind is not distinct from old.rearing_cost_kind then return new; end if;
  else
    batch_id:=coalesce(new.rearing_batch_id,old.rearing_batch_id); effective_date:=coalesce(new.consumption_date,old.consumption_date);
    old_batch:=old.rearing_batch_id; old_date:=old.consumption_date;
    if tg_op='UPDATE' and new.rearing_batch_id is not distinct from old_batch and new.consumption_date is not distinct from old_date
      and new.active is not distinct from old.active and new.quantity_kg is not distinct from old.quantity_kg then return new; end if;
  end if;
  if batch_id is not null and exists(select 1 from public.rearing_transfers t where t.source_batch_id=batch_id and t.status='posted' and t.transfer_date>=effective_date) then
    raise exception 'This cost date is on/before a posted pullet transfer. Use the audited transfer correction workflow instead of changing its cost basis.' using errcode='23514'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
create trigger rearing_expense_transfer_cost_guard before update or delete on public.expenses
  for each row execute function public.guard_rearing_cost_against_posted_transfer();
create trigger rearing_feed_transfer_cost_guard before update or delete on public.rearing_feed_consumptions
  for each row execute function public.guard_rearing_cost_against_posted_transfer();

create or replace function public.guard_rearing_cost_insert_date()
returns trigger language plpgsql security definer set search_path='' as $$
declare batch_id uuid; effective_date date;
begin
  if tg_table_name='expenses' then batch_id:=new.rearing_batch_id; effective_date:=new.expense_date;
  else batch_id:=new.rearing_batch_id; effective_date:=new.consumption_date; end if;
  if batch_id is not null and exists(select 1 from public.rearing_transfers t where t.source_batch_id=batch_id and t.status='posted' and t.transfer_date>=effective_date) then
    raise exception 'This cost date is on/before a posted pullet transfer. Record new costs on their actual effective date; old transfer snapshots cannot be rewritten.' using errcode='23514';
  end if;
  return new;
end; $$;
create trigger rearing_expense_transfer_cost_insert_guard before insert on public.expenses
  for each row when(new.rearing_batch_id is not null) execute function public.guard_rearing_cost_insert_date();
create trigger rearing_feed_transfer_cost_insert_guard before insert on public.rearing_feed_consumptions
  for each row execute function public.guard_rearing_cost_insert_date();

create or replace function public.get_rearing_transfer_preview(target_batch uuid,target_date date)
returns table(available_birds integer,source_cost numeric,already_transferred_cost numeric,remaining_cost numeric,cost_complete boolean)
language plpgsql stable security definer set search_path='' as $$
declare f uuid; arrival date; tz text; today date;
begin
  select b.farm_id,b.arrival_date,fa.timezone into f,arrival,tz from public.rearing_batches b join public.farms fa on fa.id=b.farm_id where b.id=target_batch;
  if f is null or not public.has_farm_role(f,array['admin','manager']) then raise exception 'Rearing transfer preview access denied' using errcode='42501'; end if;
  today:=(now() at time zone tz)::date;
  if target_date is null or target_date<arrival or target_date>today then raise exception 'Choose a transfer date from arrival through today' using errcode='23514'; end if;
  return query select coalesce((select sum(case when m.direction='IN' then m.quantity else -m.quantity end)::integer from public.rearing_movements m where m.rearing_batch_id=target_batch and m.movement_date<=target_date),0),
    public.rearing_cost_total_at(target_batch,target_date),
    coalesce((select sum(t.total_cost_transferred) from public.rearing_transfers t where t.source_batch_id=target_batch and t.status='posted' and t.transfer_date<=target_date),0)::numeric,
    greatest(public.rearing_cost_total_at(target_batch,target_date)-coalesce((select sum(t.total_cost_transferred) from public.rearing_transfers t where t.source_batch_id=target_batch and t.status='posted' and t.transfer_date<=target_date),0),0)::numeric,
    not exists(select 1 from public.rearing_feed_consumptions c join public.feed_inventory_movements m on m.id=c.movement_id
      where c.rearing_batch_id=target_batch and c.active and c.consumption_date<=target_date and m.total_cost_snapshot is null);
end; $$;

create or replace function public.post_rearing_transfer(
  target_batch uuid,target_date date,target_quantity integer,target_destination_flock uuid,
  target_new_flock jsonb,target_notes text,target_cost_review_confirmed boolean,target_idempotency_key uuid
) returns public.rearing_transfers language plpgsql security definer set search_path='' as $$
declare
  b public.rearing_batches; f public.flocks; x public.rearing_transfers;
  actor uuid:=auth.uid(); tz text; available integer; flock_before integer;
  gross_cost numeric(14,2); already_transferred numeric(14,2); remaining_cost numeric(14,2);
  cost_transfer numeric(14,2); unit_cost numeric(14,4);
  source_move public.rearing_movements; destination_move public.bird_movements;
  flock_json jsonb; request_hash text;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into b from public.rearing_batches where id=target_batch for update;
  if b.id is null or not public.has_farm_role(b.farm_id,array['admin','manager']) then
    raise exception 'Rearing transfer access denied' using errcode='42501'; end if;
  select timezone into tz from public.farms where id=b.farm_id;
  if target_idempotency_key is null then raise exception 'Transfer request key is required' using errcode='23514'; end if;
  request_hash:=md5(jsonb_build_object('batch',target_batch,'date',target_date,'quantity',target_quantity,
    'destination',target_destination_flock,'new_flock',target_new_flock,'notes',coalesce(target_notes,''),
    'cost_review',target_cost_review_confirmed)::text);
  select * into x from public.rearing_transfers where farm_id=b.farm_id and idempotency_key=target_idempotency_key;
  if x.id is not null then
    if x.request_fingerprint<>request_hash then
      raise exception 'This request key was already used for different transfer details' using errcode='23505'; end if;
    return x;
  end if;
  if b.stage<>'ready_for_transfer' or b.status not in('active','partially_transferred') then
    raise exception 'Mark this active batch Ready for Transfer before transferring birds' using errcode='23514'; end if;
  if target_date is null or target_date<b.arrival_date or target_date>(now() at time zone tz)::date
    or target_quantity is null or target_quantity<=0 or char_length(coalesce(target_notes,''))>2000
    or target_cost_review_confirmed is not true then
    raise exception 'Check the transfer date, positive whole-bird quantity, notes, and cost review confirmation' using errcode='23514'; end if;
  if exists(select 1 from public.rearing_transfers t where t.source_batch_id=b.id and t.status='posted' and t.transfer_date>target_date) then
    raise exception 'A later transfer already exists. Transfers cannot be inserted before the existing transfer history.' using errcode='23514'; end if;
  select coalesce(sum(case when direction='IN' then quantity else -quantity end),0)::integer into available
    from public.rearing_movements where rearing_batch_id=b.id and farm_id=b.farm_id and movement_date<=target_date;
  if available<=0 or target_quantity>available then raise exception 'Transfer quantity exceeds birds available on that date' using errcode='23514'; end if;
  if target_destination_flock is not null and target_new_flock is not null then raise exception 'Select an existing flock or create a new flock, not both' using errcode='23514'; end if;
  if target_destination_flock is null and target_new_flock is null then raise exception 'A destination layer flock is required' using errcode='23514'; end if;

  if target_destination_flock is not null then
    select * into f from public.flocks where id=target_destination_flock and farm_id=b.farm_id for update;
    if f.id is null or f.status<>'active' or f.start_date>target_date then
      raise exception 'Choose an active layer flock in this farm that had started by the transfer date' using errcode='23514'; end if;
    flock_before:=public.flock_balance_at(f.id,target_date);
    if flock_before is null or flock_before<0 then raise exception 'Destination flock population is invalid on the transfer date' using errcode='23514'; end if;
  else
    flock_json:=target_new_flock;
    if jsonb_typeof(flock_json)<>'object' or char_length(trim(coalesce(flock_json->>'flock_name',''))) not between 2 and 120
      or char_length(coalesce(flock_json->>'batch_reference',''))>120 or char_length(coalesce(flock_json->>'breed',''))>120
      or char_length(coalesce(flock_json->>'house_pen',''))>120 or char_length(coalesce(flock_json->>'source',''))>120
      or char_length(coalesce(flock_json->>'notes',''))>2000
      or (flock_json ? 'start_date' and (flock_json->>'start_date')::date<>target_date)
      or (flock_json ? 'age_at_arrival_weeks' and (flock_json->>'age_at_arrival_weeks')::integer<0) then
      raise exception 'Enter valid new layer-flock details; its start date must equal the transfer date' using errcode='23514'; end if;
    insert into public.flocks(farm_id,flock_name,batch_reference,breed,house_pen,start_date,initial_birds,age_at_arrival_weeks,source,status,notes,created_by,population_is_transfer_only)
    values(b.farm_id,trim(flock_json->>'flock_name'),nullif(trim(flock_json->>'batch_reference'),''),
      nullif(trim(flock_json->>'breed'),''),nullif(trim(flock_json->>'house_pen'),''),target_date,0,
      nullif(flock_json->>'age_at_arrival_weeks','')::integer,'Internal DOC rearing transfer','active',
      nullif(trim(flock_json->>'notes'),''),actor,true) returning * into f;
    flock_before:=0;
  end if;

  gross_cost:=public.rearing_cost_total_at(b.id,target_date);
  if exists(select 1 from public.rearing_feed_consumptions c join public.feed_inventory_movements m on m.id=c.movement_id
    where c.rearing_batch_id=b.id and c.active and c.consumption_date<=target_date and m.total_cost_snapshot is null) then
    raise exception 'Feed-cost history is incomplete. Reconcile feed consumption costs before transferring this batch.' using errcode='23514'; end if;
  if gross_cost is null then raise exception 'Rearing cost could not be calculated. Reconcile its source records before transfer.' using errcode='23514'; end if;
  select coalesce(sum(total_cost_transferred),0) into already_transferred from public.rearing_transfers
    where source_batch_id=b.id and farm_id=b.farm_id and status='posted' and transfer_date<=target_date;
  remaining_cost:=round(gross_cost-already_transferred,2);
  if remaining_cost<0 then raise exception 'Historical rearing cost is below the amount already transferred. Reconcile the batch before continuing.' using errcode='23514'; end if;
  if remaining_cost>0 and gross_cost=0 then raise exception 'Rearing cost history is inconsistent; transfer is blocked.' using errcode='23514'; end if;
  if target_quantity=available then cost_transfer:=remaining_cost;
  elsif available>0 then cost_transfer:=round(remaining_cost*target_quantity/available,2);
  else cost_transfer:=0; end if;
  unit_cost:=case when target_quantity>0 then round(cost_transfer/target_quantity,4) else 0 end;

  insert into public.rearing_transfers(farm_id,source_batch_id,destination_flock_id,transfer_date,quantity,
    source_birds_before,source_birds_after,destination_birds_before,destination_birds_after,
    source_cost_before,unit_cost_snapshot,total_cost_transferred,remaining_cost_after,cost_review_confirmed,
    cost_reviewed_by,idempotency_key,request_fingerprint,notes,created_by)
  values(b.farm_id,b.id,f.id,target_date,target_quantity,available,available-target_quantity,flock_before,
    flock_before+target_quantity,gross_cost,unit_cost,cost_transfer,round(remaining_cost-cost_transfer,2),true,actor,
    target_idempotency_key,request_hash,nullif(trim(target_notes),''),actor) returning * into x;
  insert into public.rearing_movements(farm_id,rearing_batch_id,movement_date,movement_type,direction,quantity,transfer_id,notes,created_by)
  values(b.farm_id,b.id,target_date,'transfer_out','OUT',target_quantity,x.id,nullif(trim(target_notes),''),actor) returning * into source_move;
  insert into public.bird_movements(farm_id,flock_id,movement_date,movement_type,quantity,direction,source_type,source_id,rearing_transfer_id,notes,created_by)
  values(b.farm_id,f.id,target_date,'transfer_in',target_quantity,'IN','rearing_transfer',x.id,x.id,
    'Point-of-lay transfer from '||b.batch_code,actor) returning * into destination_move;
  update public.rearing_transfers set source_movement_id=source_move.id,destination_movement_id=destination_move.id,status='posted' where id=x.id returning * into x;
  perform public.assert_nonnegative_rearing_history(b.id);
  perform public.assert_nonnegative_flock_history(f.id);
  update public.rearing_batches set status=case when available-target_quantity=0 then 'transferred' else 'partially_transferred' end,updated_by=actor where id=b.id;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
  values(b.farm_id,actor,'rearing.transfer_posted','rearing_transfers',x.id,'Pullets transferred into a layer flock',
    jsonb_build_object('source_batch_id',b.id,'destination_flock_id',f.id,'source_movement_id',source_move.id,
      'destination_movement_id',destination_move.id,'quantity',target_quantity,'transfer_date',target_date,
      'total_cost_transferred',cost_transfer,'remaining_cost',round(remaining_cost-cost_transfer,2)));
  return x;
end; $$;

create or replace function public.reverse_rearing_transfer(target_transfer uuid,target_reason text)
returns public.rearing_transfers language plpgsql security definer set search_path='' as $$
declare t public.rearing_transfers; b public.rearing_batches; f public.flocks; actor uuid:=auth.uid(); rm public.rearing_movements; bm public.bird_movements;
begin
  select * into t from public.rearing_transfers where id=target_transfer for update;
  if t.id is null or not public.has_farm_role(t.farm_id,array['admin']) then raise exception 'Farm admin access required to reverse a transfer' using errcode='42501'; end if;
  if t.status<>'posted' or char_length(trim(coalesce(target_reason,'')))<3 then raise exception 'Only a posted transfer with a reason can be reversed' using errcode='23514'; end if;
  select * into b from public.rearing_batches where id=t.source_batch_id for update;
  select * into f from public.flocks where id=t.destination_flock_id for update;
  if exists(select 1 from public.rearing_transfers later where later.source_batch_id=b.id and later.status='posted' and
      (later.transfer_date>t.transfer_date or (later.transfer_date=t.transfer_date and later.created_at>t.created_at))) then
    raise exception 'Reverse later transfers from this batch first' using errcode='23514'; end if;
  if exists(select 1 from public.rearing_movements m where m.rearing_batch_id=b.id and m.id<>t.source_movement_id
      and m.movement_date>=t.transfer_date and m.movement_type in('death','transfer_out')) then
    raise exception 'Later rearing mortality or transfer depends on this population history; reversal is blocked' using errcode='23514'; end if;
  if exists(select 1 from public.bird_movements m where m.flock_id=f.id and m.id<>t.destination_movement_id
      and m.movement_date>=t.transfer_date) or exists(select 1 from public.daily_production_records p where p.flock_id=f.id and p.production_date>=t.transfer_date) then
    raise exception 'Layer-flock activity exists on or after this transfer; reversal is blocked to protect its population and production history' using errcode='23514'; end if;
  insert into public.rearing_movements(farm_id,rearing_batch_id,movement_date,movement_type,direction,quantity,reversal_of,transfer_id,notes,created_by)
  values(t.farm_id,b.id,t.transfer_date,'transfer_reversal','IN',t.quantity,t.source_movement_id,t.id,
    'Reversal: '||trim(target_reason),actor) returning * into rm;
  insert into public.bird_movements(farm_id,flock_id,movement_date,movement_type,quantity,direction,source_type,source_id,rearing_transfer_id,notes,created_by)
  values(t.farm_id,f.id,t.transfer_date,'transfer_out',t.quantity,'OUT','rearing_transfer',t.id,t.id,
    'Reversed point-of-lay transfer',actor) returning * into bm;
  perform public.assert_nonnegative_rearing_history(b.id);
  perform public.assert_nonnegative_flock_history(f.id);
  update public.rearing_transfers set status='reversed',reversed_at=now(),reversed_by=actor,reversal_reason=trim(target_reason) where id=t.id returning * into t;
  update public.rearing_batches set status=case when exists(select 1 from public.rearing_transfers x where x.source_batch_id=b.id and x.status='posted') then 'partially_transferred' else 'active' end,updated_by=actor where id=b.id;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
  values(t.farm_id,actor,'rearing.transfer_reversed','rearing_transfers',t.id,'Point-of-lay transfer reversed',
    jsonb_build_object('reason',trim(target_reason),'quantity',t.quantity,'total_cost_transferred',t.total_cost_transferred,
      'source_reversal_movement_id',rm.id,'destination_reversal_movement_id',bm.id));
  return t;
end; $$;

create or replace function public.get_rearing_transfer_history(target_batch uuid)
returns table(id uuid,transfer_date date,quantity integer,destination_flock_id uuid,destination_flock_name text,
  status text,total_cost_transferred numeric,unit_cost_snapshot numeric,remaining_cost_after numeric,created_by uuid,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare f uuid; show_cost boolean;
begin
  select farm_id into f from public.rearing_batches where id=target_batch;
  if f is null or not public.is_farm_member(f) then raise exception 'Rearing access denied' using errcode='42501'; end if;
  show_cost:=public.has_farm_role(f,array['admin','manager']);
  return query select t.id,t.transfer_date,t.quantity,t.destination_flock_id,fl.flock_name,t.status,
    case when show_cost then t.total_cost_transferred else null end,
    case when show_cost then t.unit_cost_snapshot else null end,
    case when show_cost then t.remaining_cost_after else null end,t.created_by,t.created_at
  from public.rearing_transfers t join public.flocks fl on fl.id=t.destination_flock_id and fl.farm_id=t.farm_id
  where t.source_batch_id=target_batch and t.farm_id=f and t.status in('posted','reversed') order by t.transfer_date desc,t.created_at desc;
end; $$;

create or replace function public.get_rearing_transfer_detail(target_transfer uuid)
returns table(id uuid,farm_id uuid,source_batch_id uuid,source_batch_code text,destination_flock_id uuid,destination_flock_name text,
  transfer_date date,quantity integer,source_birds_before integer,source_birds_after integer,destination_birds_before integer,
  destination_birds_after integer,total_cost_transferred numeric,unit_cost_snapshot numeric,source_cost_before numeric,
  remaining_cost_after numeric,status text,created_by uuid,created_at timestamptz,reversed_by uuid,reversed_at timestamptz,reversal_reason text)
language plpgsql stable security definer set search_path='' as $$
declare f uuid; show_cost boolean;
begin
  select t.farm_id into f from public.rearing_transfers t where t.id=target_transfer;
  if f is null or not public.is_farm_member(f) then raise exception 'Transfer access denied' using errcode='42501'; end if;
  show_cost:=public.has_farm_role(f,array['admin','manager']);
  return query select t.id,t.farm_id,t.source_batch_id,b.batch_code,t.destination_flock_id,fl.flock_name,t.transfer_date,
    t.quantity,t.source_birds_before,t.source_birds_after,t.destination_birds_before,t.destination_birds_after,
    case when show_cost then t.total_cost_transferred else null end,case when show_cost then t.unit_cost_snapshot else null end,
    case when show_cost then t.source_cost_before else null end,case when show_cost then t.remaining_cost_after else null end,
    t.status,t.created_by,t.created_at,t.reversed_by,t.reversed_at,t.reversal_reason
  from public.rearing_transfers t join public.rearing_batches b on b.id=t.source_batch_id and b.farm_id=t.farm_id
    join public.flocks fl on fl.id=t.destination_flock_id and fl.farm_id=t.farm_id where t.id=target_transfer;
end; $$;

create or replace function public.get_flock_rearing_lineage(target_flock uuid)
returns table(transfer_id uuid,source_batch_id uuid,batch_code text,transfer_date date,quantity integer,
  transferred_cost numeric,status text)
language plpgsql stable security definer set search_path='' as $$
declare f uuid; show_cost boolean;
begin
  select farm_id into f from public.flocks where id=target_flock;
  if f is null or not public.is_farm_member(f) then raise exception 'Flock access denied' using errcode='42501'; end if;
  show_cost:=public.has_farm_role(f,array['admin','manager']);
  return query select t.id,t.source_batch_id,b.batch_code,t.transfer_date,t.quantity,
    case when show_cost and t.status='posted' then t.total_cost_transferred else null end,t.status
  from public.rearing_transfers t join public.rearing_batches b on b.id=t.source_batch_id and b.farm_id=t.farm_id
  where t.destination_flock_id=target_flock and t.farm_id=f order by t.transfer_date,t.created_at;
end; $$;

revoke all on function public.post_rearing_transfer(uuid,date,integer,uuid,jsonb,text,boolean,uuid),
  public.reverse_rearing_transfer(uuid,text),public.get_rearing_transfer_preview(uuid,date) from public,anon;
grant execute on function public.post_rearing_transfer(uuid,date,integer,uuid,jsonb,text,boolean,uuid),
  public.reverse_rearing_transfer(uuid,text),public.get_rearing_transfer_preview(uuid,date) to authenticated;
revoke all on function public.get_rearing_transfer_history(uuid),public.get_rearing_transfer_detail(uuid),public.get_flock_rearing_lineage(uuid) from public,anon;
grant execute on function public.get_rearing_transfer_history(uuid),public.get_rearing_transfer_detail(uuid),public.get_flock_rearing_lineage(uuid) to authenticated;

create or replace view public.v_rearing_transfer_reconciliation with (security_invoker=true) as
select t.id transfer_id,t.farm_id,t.source_batch_id,t.destination_flock_id,t.status,
  t.quantity transfer_quantity,sm.quantity source_quantity,dm.quantity destination_quantity,
  t.total_cost_transferred transfer_cost,t.remaining_cost_after,
  (t.status='posted' and sm.id is not null and dm.id is not null and sm.quantity=t.quantity and dm.quantity=t.quantity
    and sm.direction='OUT' and dm.direction='IN' and sm.transfer_id=t.id and dm.rearing_transfer_id=t.id) reconciles
from public.rearing_transfers t
left join public.rearing_movements sm on sm.id=t.source_movement_id and sm.farm_id=t.farm_id and sm.rearing_batch_id=t.source_batch_id
left join public.bird_movements dm on dm.id=t.destination_movement_id and dm.farm_id=t.farm_id and dm.flock_id=t.destination_flock_id;
grant select on public.v_rearing_transfer_reconciliation to authenticated;
