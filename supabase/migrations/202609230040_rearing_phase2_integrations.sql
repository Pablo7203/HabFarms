-- DOC Phase 2: connect rearing to the farm's authoritative feed, health,
-- expense, payment, and planning systems. No second stock or cash ledger.

-- Feed remains in feed_inventory_movements/feed_inventory_balances. A rearing
-- batch is an optional operational target, mutually exclusive with a layer flock.
alter table public.feed_types add constraint feed_type_id_farm_unique unique(id,farm_id);
alter table public.flocks add constraint flock_id_farm_unique unique(id,farm_id);
alter table public.feed_inventory_movements
  add column rearing_batch_id uuid,
  add constraint feed_movement_scope_unique unique(id,farm_id,rearing_batch_id),
  add constraint feed_movement_rearing_batch_same_farm foreign key(rearing_batch_id,farm_id)
    references public.rearing_batches(id,farm_id) on delete restrict;
alter table public.feed_inventory_movements drop constraint feed_movement_type_check;
alter table public.feed_inventory_movements add constraint feed_movement_type_check
  check(movement_type in('opening_stock','purchase','consumption','consumption_reversal','wastage','adjustment','purchase_reversal','production','mixing_input','mixing_output'));
alter table public.feed_inventory_movements drop constraint feed_movement_direction_check;
alter table public.feed_inventory_movements add constraint feed_movement_direction_check check(
  (movement_type in('opening_stock','purchase','production','mixing_output','consumption_reversal') and direction='IN') or
  (movement_type in('consumption','wastage','purchase_reversal','mixing_input') and direction='OUT') or movement_type='adjustment');
alter table public.feed_inventory_movements add constraint feed_movement_rearing_target_check
  check(rearing_batch_id is null or (flock_id is null and feed_type_id is not null and movement_type in('consumption','consumption_reversal')));
create index feed_movements_rearing_batch_idx on public.feed_inventory_movements(farm_id,rearing_batch_id,movement_date desc)
  where rearing_batch_id is not null;

create table public.rearing_feed_consumptions(
  id uuid primary key,
  farm_id uuid not null,
  rearing_batch_id uuid not null,
  feed_type_id uuid not null,
  daily_record_id uuid,
  movement_id uuid not null,
  consumption_date date not null,
  quantity_kg numeric(14,3) not null check(quantity_kg>0),
  active boolean not null default true,
  reversed_by uuid,
  correction_reason text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  constraint rearing_feed_batch_same_farm foreign key(rearing_batch_id,farm_id) references public.rearing_batches(id,farm_id) on delete restrict,
  constraint rearing_feed_type_same_farm foreign key(feed_type_id,farm_id) references public.feed_types(id,farm_id) on delete restrict,
  constraint rearing_feed_daily_same_batch foreign key(daily_record_id,farm_id,rearing_batch_id) references public.rearing_daily_records(id,farm_id,rearing_batch_id) on delete restrict,
  constraint rearing_feed_movement_same_scope foreign key(movement_id,farm_id,rearing_batch_id) references public.feed_inventory_movements(id,farm_id,rearing_batch_id) on delete restrict,
  constraint rearing_feed_reversal_same_scope foreign key(reversed_by,farm_id,rearing_batch_id) references public.feed_inventory_movements(id,farm_id,rearing_batch_id) on delete restrict,
  constraint rearing_feed_record_id_scope_unique unique(id,farm_id,rearing_batch_id),
  constraint rearing_feed_movement_unique unique(movement_id),
  check((active and reversed_by is null) or (not active and reversed_by is not null))
);
create index rearing_feed_batch_date_idx on public.rearing_feed_consumptions(farm_id,rearing_batch_id,consumption_date desc,id);
alter table public.rearing_batches add column feeding_stage text not null default 'starter'
  check(char_length(trim(feeding_stage)) between 2 and 60);

-- Extend the farm's existing effective-dated feed planning convention.
create table public.rearing_feed_plans(
  id uuid primary key default gen_random_uuid(),farm_id uuid not null,rearing_batch_id uuid not null,
  feed_type_id uuid not null,feeding_stage text not null check(char_length(trim(feeding_stage)) between 2 and 60),
  grams_per_bird_per_day numeric(10,3) not null check(grams_per_bird_per_day>0 and grams_per_bird_per_day<=1000),
  effective_from date not null,effective_to date,notes text,
  created_at timestamptz not null default now(),created_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),updated_by uuid references public.profiles(id),
  foreign key(rearing_batch_id,farm_id) references public.rearing_batches(id,farm_id) on delete cascade,
  foreign key(feed_type_id,farm_id) references public.feed_types(id,farm_id) on delete restrict,
  check(effective_to is null or effective_to>=effective_from),unique(rearing_batch_id,effective_from)
);
create index rearing_feed_plans_lookup_idx on public.rearing_feed_plans(farm_id,rearing_batch_id,effective_from desc);

-- Existing health records/reminders gain a properly constrained alternative
-- subject. Exactly one flock or rearing batch must be selected.
alter table public.health_records drop constraint health_records_flock_id_fkey;
alter table public.health_records alter column flock_id drop not null;
alter table public.health_records add column rearing_batch_id uuid;
alter table public.health_records add constraint health_record_flock_same_farm foreign key(flock_id,farm_id)
  references public.flocks(id,farm_id) on delete restrict;
alter table public.health_records add constraint health_record_rearing_same_farm foreign key(rearing_batch_id,farm_id)
  references public.rearing_batches(id,farm_id) on delete restrict;
alter table public.health_records add constraint health_record_one_subject check((flock_id is null)<>(rearing_batch_id is null));
create index health_records_rearing_date_idx on public.health_records(farm_id,rearing_batch_id,record_date desc) where rearing_batch_id is not null;

alter table public.health_reminders drop constraint health_reminders_flock_id_fkey;
alter table public.health_reminders alter column flock_id drop not null;
alter table public.health_reminders add column rearing_batch_id uuid;
alter table public.health_reminders add constraint health_reminder_flock_same_farm foreign key(flock_id,farm_id)
  references public.flocks(id,farm_id) on delete restrict;
alter table public.health_reminders add constraint health_reminder_rearing_same_farm foreign key(rearing_batch_id,farm_id)
  references public.rearing_batches(id,farm_id) on delete restrict;
alter table public.health_reminders add constraint health_reminder_one_subject check((flock_id is null)<>(rearing_batch_id is null));
create index health_reminders_rearing_due_idx on public.health_reminders(farm_id,rearing_batch_id,due_date) where rearing_batch_id is not null;

-- Direct costs (including chick acquisition and health service expenses) stay
-- in expenses/expense_payments, with an explicit source classification.
alter table public.expenses add column rearing_batch_id uuid,
  add column rearing_cost_kind text;
alter table public.expenses add constraint expense_rearing_batch_same_farm foreign key(rearing_batch_id,farm_id)
  references public.rearing_batches(id,farm_id) on delete restrict;
alter table public.expenses add constraint expense_rearing_cost_kind_check
  check(rearing_cost_kind is null or rearing_cost_kind in('acquisition','health','other_direct'));
alter table public.expenses add constraint expense_rearing_attribution_pair_check
  check((rearing_batch_id is null)=(rearing_cost_kind is null));
create index expenses_rearing_batch_date_idx on public.expenses(farm_id,rearing_batch_id,expense_date desc)
  where rearing_batch_id is not null and status='active';
create unique index expenses_rearing_one_acquisition_idx on public.expenses(rearing_batch_id)
  where rearing_batch_id is not null and rearing_cost_kind='acquisition' and status='active';

-- Preserve feed movement history and recompute all stock balances/cost snapshots
-- under the existing per-farm/feed advisory lock. Reversals restore the original
-- consumed value before any same-day replacement consumption is costed.
create or replace function public.recalculate_feed_ledger(target_farm uuid,target_feed_type uuid)
returns void language plpgsql security definer set search_path='' as $$
declare m record;q numeric:=0;v numeric:=0;w numeric:=0;c numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_farm::text||target_feed_type::text,0));
  for m in select * from public.feed_inventory_movements where farm_id=target_farm and feed_type_id=target_feed_type
    order by movement_date,
      case when movement_type='opening_stock' then 1 when movement_type in('purchase','production','mixing_output') then 2
        when movement_type='adjustment' and direction='IN' then 3 when movement_type='consumption_reversal' then 4
        when movement_type in('consumption','mixing_input') then 5 when movement_type='wastage' then 6 else 7 end,
      created_at,id loop
    if m.direction='IN' then
      c:=coalesce(m.unit_cost_snapshot,0);q:=q+m.quantity_kg;v:=round(v+m.quantity_kg*c,2);w:=case when q=0 then 0 else round(v/q,4) end;
      update public.feed_inventory_movements set unit_cost_snapshot=c,total_cost_snapshot=round(m.quantity_kg*c,2) where id=m.id;
    else
      if m.quantity_kg>q then raise exception 'Only % kg feed is available on %',q,m.movement_date using errcode='23514';end if;
      c:=w;q:=q-m.quantity_kg;v:=case when q=0 then 0 else round(v-m.quantity_kg*c,2) end;w:=case when q=0 then 0 else round(v/q,4) end;
      update public.feed_inventory_movements set unit_cost_snapshot=c,total_cost_snapshot=round(m.quantity_kg*c,2) where id=m.id;
    end if;
  end loop;
  insert into public.feed_inventory_balances(farm_id,feed_type_id,quantity_kg,inventory_value,weighted_average_cost,updated_at)
    values(target_farm,target_feed_type,q,v,w,now()) on conflict(farm_id,feed_type_id) do update
    set quantity_kg=excluded.quantity_kg,inventory_value=excluded.inventory_value,weighted_average_cost=excluded.weighted_average_cost,updated_at=now();
end;$$;

create function public.record_rearing_feed_consumption(target_batch uuid,target_feed_type uuid,target_date date,
  target_quantity_kg numeric,target_daily_record uuid default null,target_stage text default null,target_notes text default null)
returns public.rearing_feed_consumptions language plpgsql security definer set search_path='' as $$
declare b public.rearing_batches;f uuid;ro text;today date;cid uuid:=gen_random_uuid();mid uuid;result public.rearing_feed_consumptions;
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
  if target_stage is not null then
    if char_length(trim(target_stage)) not between 2 and 60 then raise exception 'Invalid feeding stage' using errcode='22023';end if;
    update public.rearing_batches set feeding_stage=trim(target_stage),updated_by=auth.uid() where id=b.id;
  end if;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
    values(b.farm_id,auth.uid(),'rearing.feed_consumed','feed_inventory_movements',mid,'Feed consumed by rearing batch',jsonb_build_object('batch_id',b.id,'feed_type_id',target_feed_type,'date',target_date,'quantity_kg',round(target_quantity_kg,3)));
  return result;
end;$$;

create function public.correct_rearing_feed_consumption(target_consumption uuid,target_feed_type uuid,target_date date,
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
  select * into old_move from public.feed_inventory_movements where id=old.movement_id for update;
  perform pg_advisory_xact_lock(hashtextextended(b.farm_id::text||old.feed_type_id::text,0));
  if target_feed_type<>old.feed_type_id then
    if target_feed_type<old.feed_type_id then
      perform pg_advisory_xact_lock(hashtextextended(b.farm_id::text||target_feed_type::text,0));
      perform pg_advisory_xact_lock(hashtextextended(b.farm_id::text||old.feed_type_id::text,0));
    else
      perform pg_advisory_xact_lock(hashtextextended(b.farm_id::text||old.feed_type_id::text,0));
      perform pg_advisory_xact_lock(hashtextextended(b.farm_id::text||target_feed_type::text,0));
    end if;
  else perform pg_advisory_xact_lock(hashtextextended(b.farm_id::text||old.feed_type_id::text,0));end if;
  insert into public.feed_inventory_movements(id,farm_id,rearing_batch_id,feed_type_id,movement_date,movement_type,direction,quantity_kg,unit_cost_snapshot,total_cost_snapshot,source_type,source_id,notes,created_by)
    values(reversal_id,b.farm_id,b.id,old.feed_type_id,old.consumption_date,'consumption_reversal','IN',old.quantity_kg,old_move.unit_cost_snapshot,old_move.total_cost_snapshot,'rearing_feed_reversal',old.id,'Correction reversal: '||trim(target_reason),auth.uid());
  update public.rearing_feed_consumptions set active=false,reversed_by=reversal_id,correction_reason=trim(target_reason) where id=old.id;
  perform public.recalculate_feed_ledger(b.farm_id,old.feed_type_id);
  insert into public.feed_inventory_movements(id,farm_id,rearing_batch_id,feed_type_id,movement_date,movement_type,direction,quantity_kg,source_type,source_id,notes,created_by)
    values(new_move,b.farm_id,b.id,target_feed_type,target_date,'consumption','OUT',round(target_quantity_kg,3),'rearing_feed_consumption',new_id,nullif(trim(target_notes),''),auth.uid());
  perform public.recalculate_feed_ledger(b.farm_id,target_feed_type);
  insert into public.rearing_feed_consumptions(id,farm_id,rearing_batch_id,feed_type_id,daily_record_id,movement_id,consumption_date,quantity_kg,created_by)
    values(new_id,b.farm_id,b.id,target_feed_type,old.daily_record_id,new_move,target_date,round(target_quantity_kg,3),auth.uid()) returning * into result;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
    values(b.farm_id,auth.uid(),'rearing.feed_consumption_corrected','rearing_feed_consumptions',old.id,'Rearing feed consumption corrected',jsonb_build_object('reason',trim(target_reason),'replacement_id',new_id,'old_quantity_kg',old.quantity_kg,'new_quantity_kg',round(target_quantity_kg,3)));
  return result;
end;$$;

create function public.save_rearing_feed_plan(target_batch uuid,target_feed_type uuid,target_stage text,target_grams numeric,target_effective_from date,target_notes text default null)
returns public.rearing_feed_plans language plpgsql security definer set search_path='' as $$
declare b public.rearing_batches;f uuid;result public.rearing_feed_plans;
begin
  select * into b from public.rearing_batches where id=target_batch for update;
  select farm_id into f from public.farm_members where user_id=auth.uid() and active and farm_id=b.farm_id and role in('admin','manager');
  if b.id is null or f is null or not exists(select 1 from public.feed_types where id=target_feed_type and farm_id=f and active) then raise exception 'Rearing feed plan access denied' using errcode='42501';end if;
  if target_grams<=0 or target_grams>1000 or char_length(trim(target_stage)) not between 2 and 60 then raise exception 'Invalid rearing feed target' using errcode='23514';end if;
  update public.rearing_feed_plans set effective_to=target_effective_from-1,updated_at=now(),updated_by=auth.uid()
    where rearing_batch_id=b.id and effective_to is null and effective_from<target_effective_from;
  insert into public.rearing_feed_plans(farm_id,rearing_batch_id,feed_type_id,feeding_stage,grams_per_bird_per_day,effective_from,notes,created_by)
    values(f,b.id,target_feed_type,trim(target_stage),target_grams,target_effective_from,nullif(trim(target_notes),''),auth.uid())
    on conflict(rearing_batch_id,effective_from) do update set feed_type_id=excluded.feed_type_id,feeding_stage=excluded.feeding_stage,
      grams_per_bird_per_day=excluded.grams_per_bird_per_day,notes=excluded.notes,updated_at=now(),updated_by=auth.uid() returning * into result;
  update public.rearing_batches set feeding_stage=trim(target_stage),updated_by=auth.uid() where id=b.id;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
    values(f,auth.uid(),'rearing.feed_plan_changed','rearing_feed_plans',result.id,'Rearing feed plan changed',jsonb_build_object('batch_id',b.id,'feed_type_id',target_feed_type,'stage',trim(target_stage),'grams_per_bird_per_day',target_grams,'effective_from',target_effective_from));
  return result;
end;$$;

create view public.v_rearing_feed_history with(security_invoker=true) as
  select c.id,c.farm_id,c.rearing_batch_id,c.feed_type_id,ft.name feed_name,c.daily_record_id,c.movement_id,c.consumption_date,c.quantity_kg,c.active,c.reversed_by,c.correction_reason,c.created_by,c.created_at
  from public.rearing_feed_consumptions c join public.feed_types ft on ft.id=c.feed_type_id;
create view public.v_rearing_feed_plan_daily with(security_invoker=true) as
  select p.*,b.batch_code,ft.name feed_name,coalesce(pop.current_birds,0) live_birds,
    round(coalesce(pop.current_birds,0)*p.grams_per_bird_per_day/1000,3) target_kg_per_day
  from public.rearing_feed_plans p join public.rearing_batches b on b.id=p.rearing_batch_id
  join public.feed_types ft on ft.id=p.feed_type_id left join public.v_rearing_population pop on pop.batch_id=p.rearing_batch_id;

-- Extend existing health schedule status with readable rearing-batch names.
create or replace view public.v_health_reminder_status with(security_invoker=true) as
select h.id,h.farm_id,h.flock_id,h.activity_type,h.title,h.due_date,h.notes,h.status,h.completed_health_record_id,
  h.completed_at,h.created_at,h.created_by,h.updated_at,h.updated_by,
  coalesce(f.flock_name,b.batch_code) flock_name,
  case when h.status='completed' then 'completed' when h.status='cancelled' then 'cancelled'
    when h.due_date<(now() at time zone fa.timezone)::date then 'overdue'
    when h.due_date=(now() at time zone fa.timezone)::date then 'due_today' else 'upcoming' end reminder_status,
  h.rearing_batch_id
from public.health_reminders h left join public.flocks f on f.id=h.flock_id
left join public.rearing_batches b on b.id=h.rearing_batch_id join public.farms fa on fa.id=h.farm_id;

create or replace view public.v_upcoming_health_actions with(security_invoker=true) as
select h.id,h.farm_id,h.flock_id,h.record_date,h.health_type,h.product_name,h.reason,h.dose,h.route,h.duration,
  h.quantity,h.quantity_unit,h.veterinary_provider,h.cost,h.next_due_date,h.notes,h.status,h.voided_at,h.voided_by,
  h.void_reason,h.created_at,h.created_by,h.updated_at,h.updated_by,
  coalesce(f.flock_name,b.batch_code) flock_name,h.rearing_batch_id,b.batch_code rearing_batch_code
from public.health_records h left join public.flocks f on f.id=h.flock_id
left join public.rearing_batches b on b.id=h.rearing_batch_id
where h.status='active' and h.next_due_date is not null;

create or replace function public.complete_health_reminder(target_reminder uuid,target_health_record uuid default null)
returns public.health_reminders language plpgsql security definer set search_path='' as $$
declare result public.health_reminders;
begin
  update public.health_reminders set status='completed',completed_at=now(),completed_health_record_id=target_health_record,updated_at=now(),updated_by=auth.uid()
  where id=target_reminder and status='active' and public.has_farm_role(farm_id,array['admin','manager'])
    and (target_health_record is null or exists(select 1 from public.health_records h where h.id=target_health_record and h.farm_id=health_reminders.farm_id
      and h.flock_id is not distinct from health_reminders.flock_id and h.rearing_batch_id is not distinct from health_reminders.rearing_batch_id)) returning * into result;
  if result.id is null then raise exception 'Health reminder completion denied' using errcode='42501';end if;return result;
end;$$;

create function public.link_rearing_health_expense()
returns trigger language plpgsql security definer set search_path='' as $$
declare batch uuid;
begin
  if new.source_type='health_record' and new.source_key='health_cost' and new.source_id is not null then
    select rearing_batch_id into batch from public.health_records where id=new.source_id and farm_id=new.farm_id;
    if batch is not null then new.rearing_batch_id:=batch;new.rearing_cost_kind:='health';end if;
  end if;
  return new;
end;$$;
create trigger expenses_link_rearing_health before insert on public.expenses for each row execute function public.link_rearing_health_expense();

create function public.create_rearing_health_record(target_batch uuid,record_date date,health_type text,product_name text,
  reason text default null,dose text default null,route text default null,duration text default null,quantity numeric default null,
  quantity_unit text default null,veterinary_provider text default null,cost numeric default 0,next_due_date date default null,
  notes text default null,initial_payment numeric default 0,payment_method text default 'cash',reference text default null)
returns public.health_records language plpgsql security definer set search_path='' as $$
declare b public.rearing_batches;ro text;tz text;r public.health_records;e public.expenses;
begin
  select * into b from public.rearing_batches where id=target_batch for update;
  select role into ro from public.farm_members where farm_id=b.farm_id and user_id=auth.uid() and active;
  if b.id is null or ro is null then raise exception 'Health access denied' using errcode='42501';end if;
  if ro='worker' and (cost<>0 or initial_payment<>0) then raise exception 'Workers cannot enter health costs' using errcode='42501';end if;
  if cost<0 or coalesce(quantity,0)<0 or initial_payment<0 or initial_payment>cost or (next_due_date is not null and next_due_date<record_date) or record_date<b.arrival_date then raise exception 'Invalid health values' using errcode='23514';end if;
  select timezone into tz from public.farms where id=b.farm_id;
  if ro='worker' and record_date<>(now() at time zone tz)::date then raise exception 'Workers may record current date only' using errcode='42501';end if;
  insert into public.health_records(farm_id,flock_id,rearing_batch_id,record_date,health_type,product_name,reason,dose,route,duration,quantity,quantity_unit,veterinary_provider,cost,next_due_date,notes,created_by)
    values(b.farm_id,null,b.id,record_date,health_type,trim(product_name),nullif(trim(reason),''),nullif(trim(dose),''),nullif(trim(route),''),nullif(trim(duration),''),quantity,nullif(trim(quantity_unit),''),nullif(trim(veterinary_provider),''),cost,next_due_date,nullif(trim(notes),''),auth.uid()) returning * into r;
  if cost>0 then
    e:=public.insert_generated_expense(b.farm_id,record_date,case when health_type='veterinary_service' then 'veterinary' else 'medicine_vaccine' end,
      'Rearing health: '||trim(product_name),cost,'health_record',r.id,'health_cost',auth.uid());
    update public.expenses set rearing_batch_id=b.id,rearing_cost_kind='health' where id=e.id;
    if initial_payment>0 then insert into public.expense_payments(farm_id,expense_id,payment_date,amount,payment_method,reference,created_by)
      values(b.farm_id,e.id,record_date,initial_payment,payment_method,nullif(trim(reference),''),auth.uid());end if;
  end if;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
    values(b.farm_id,auth.uid(),'rearing.health_recorded','health_records',r.id,'Health activity recorded for rearing batch',jsonb_build_object('batch_id',b.id,'type',health_type,'record_date',record_date,'cost',case when ro='worker' then null else cost end));
  return r;
end;$$;

create function public.create_rearing_health_reminder(target_batch uuid,target_activity_type text,target_title text,target_due_date date,target_notes text default null)
returns public.health_reminders language plpgsql security definer set search_path='' as $$
declare b public.rearing_batches;r public.health_reminders;
begin
  select * into b from public.rearing_batches where id=target_batch;
  if b.id is null or not public.has_farm_role(b.farm_id,array['admin','manager']) then raise exception 'Health reminder access denied' using errcode='42501';end if;
  insert into public.health_reminders(farm_id,flock_id,rearing_batch_id,activity_type,title,due_date,notes,created_by)
    values(b.farm_id,null,b.id,target_activity_type,trim(target_title),target_due_date,nullif(trim(target_notes),''),auth.uid()) returning * into r;
  return r;
end;$$;

-- Link a manually incurred expense to a batch. Existing payment rows remain the
-- sole source of cash paid; supplier balances continue to come from existing views.
create function public.create_rearing_cost_expense(target_batch uuid,target_cost_kind text,target_date date,target_category uuid,
  target_description text,target_supplier uuid,target_payee text,target_amount numeric,target_initial_payment numeric default 0,
  target_payment_method text default 'cash',target_reference text default null,target_notes text default null)
returns public.expenses language plpgsql security definer set search_path='' as $$
declare b public.rearing_batches;result public.expenses;today date;
begin
  select * into b from public.rearing_batches where id=target_batch for update;
  if b.id is null or not public.has_farm_role(b.farm_id,array['admin','manager']) then raise exception 'Rearing expense access denied' using errcode='42501';end if;
  select (now() at time zone timezone)::date into today from public.farms where id=b.farm_id;
  if target_cost_kind not in('acquisition','other_direct') or target_date<b.arrival_date or target_date>today or target_amount<=0 or target_initial_payment<0 or target_initial_payment>target_amount then raise exception 'Invalid rearing expense' using errcode='23514';end if;
  if not exists(select 1 from public.expense_categories where id=target_category and farm_id=b.farm_id and active)
    or (target_supplier is not null and not exists(select 1 from public.suppliers where id=target_supplier and farm_id=b.farm_id and active)) then raise exception 'Invalid category or supplier' using errcode='42501';end if;
  if target_cost_kind='acquisition' and exists(select 1 from public.expenses where rearing_batch_id=b.id and rearing_cost_kind='acquisition' and status='active') then raise exception 'An active acquisition expense already exists for this batch' using errcode='23505';end if;
  insert into public.expenses(farm_id,expense_number,expense_date,category_id,description,supplier_id,payee_name,amount,source_type,source_key,rearing_batch_id,rearing_cost_kind,notes,created_by)
    values(b.farm_id,public.next_expense_number(b.farm_id,target_date),target_date,target_category,trim(target_description),target_supplier,nullif(trim(target_payee),''),target_amount,'manual','manual',b.id,target_cost_kind,nullif(trim(target_notes),''),auth.uid()) returning * into result;
  if target_initial_payment>0 then insert into public.expense_payments(farm_id,expense_id,payment_date,amount,payment_method,reference,created_by)
    values(b.farm_id,result.id,target_date,target_initial_payment,target_payment_method,nullif(trim(target_reference),''),auth.uid());end if;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
    values(b.farm_id,auth.uid(),case when target_cost_kind='acquisition' then 'rearing.acquisition_cost_linked' else 'rearing.expense_attributed' end,'expenses',result.id,'Cost attributed to rearing batch',jsonb_build_object('batch_id',b.id,'cost_kind',target_cost_kind,'amount',target_amount));
  return result;
end;$$;

-- One controlled, role-gated source-derived costing result. Feed costs come only
-- from active consumption movement snapshots; never feed purchases or payments.
create function public.get_rearing_cost_summary(target_batch uuid)
returns table(rearing_batch_id uuid,feed_consumed_kg numeric,feed_cost numeric,acquisition_cost numeric,health_cost numeric,
  other_direct_cost numeric,accumulated_rearing_cost numeric,cash_paid_against_linked_expenses numeric,
  outstanding_linked_expenses numeric,current_surviving_birds integer,cost_per_surviving_pullet numeric)
language plpgsql stable security definer set search_path='' as $$
declare f uuid;
begin
  select farm_id into f from public.rearing_batches where id=target_batch;
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
  ),population as(select current_birds from public.v_rearing_population where batch_id=target_batch)
  select target_batch,feed.feed_kg,feed.cost,expenses_by_kind.acquisition,expenses_by_kind.health,expenses_by_kind.other_cost,
    feed.cost+expenses_by_kind.acquisition+expenses_by_kind.health+expenses_by_kind.other_cost,
    expenses_by_kind.paid,expenses_by_kind.outstanding,population.current_birds,
    case when population.current_birds>0 then round((feed.cost+expenses_by_kind.acquisition+expenses_by_kind.health+expenses_by_kind.other_cost)/population.current_birds,2) else null end
  from feed cross join expenses_by_kind cross join population;
end;$$;

create function public.get_rearing_feed_cost_history(target_batch uuid)
returns table(id uuid,feed_type_id uuid,feed_name text,consumption_date date,quantity_kg numeric,unit_cost numeric,total_cost numeric,active boolean,created_by uuid)
language plpgsql stable security definer set search_path='' as $$
declare f uuid;
begin select rb.farm_id into f from public.rearing_batches rb where rb.id=target_batch;
  if f is null or not public.has_farm_role(f,array['admin','manager']) then raise exception 'Financial access denied' using errcode='42501';end if;
  return query select c.id,c.feed_type_id,ft.name,c.consumption_date,c.quantity_kg,m.unit_cost_snapshot,m.total_cost_snapshot,c.active,c.created_by
  from public.rearing_feed_consumptions c join public.feed_types ft on ft.id=c.feed_type_id join public.feed_inventory_movements m on m.id=c.movement_id
  where c.rearing_batch_id=target_batch and c.farm_id=f order by c.consumption_date desc,c.created_at desc;
end;$$;

-- Daily plan versus actual stays per product, per rearing batch.
create function public.get_rearing_feed_plan_variance(target_batch uuid,target_from date,target_to date)
returns table(report_date date,feed_type_id uuid,feed_name text,planned_kg numeric,actual_kg numeric,variance_kg numeric)
language plpgsql stable security definer set search_path='' as $$
declare f uuid;
begin select farm_id into f from public.rearing_batches where id=target_batch;
  if f is null or target_from>target_to or target_to-target_from>366 or not public.is_farm_member(f) then raise exception 'Invalid rearing feed report request' using errcode='42501';end if;
  return query with dates as(select generate_series(target_from,target_to,interval '1 day')::date d),pop as(
    select d.d,coalesce((select sum(case when m.direction='IN' then m.quantity else -m.quantity end)::integer from public.rearing_movements m where m.rearing_batch_id=target_batch and m.farm_id=f and m.movement_date<=d.d),0) birds
    from dates d),planned as(
    select p.d,pn.feed_type_id,ft.name,round(p.birds*pn.grams_per_bird_per_day/1000,3) qty
    from pop p join public.rearing_feed_plans pn on pn.rearing_batch_id=target_batch and pn.farm_id=f and pn.effective_from<=p.d and (pn.effective_to is null or pn.effective_to>=p.d)
    join public.feed_types ft on ft.id=pn.feed_type_id),actual as(
    select c.consumption_date d,c.feed_type_id,ft.name,sum(c.quantity_kg)::numeric qty from public.rearing_feed_consumptions c join public.feed_types ft on ft.id=c.feed_type_id
    where c.farm_id=f and c.rearing_batch_id=target_batch and c.active and c.consumption_date between target_from and target_to group by c.consumption_date,c.feed_type_id,ft.name),joined as(
    select coalesce(p.d,a.d) d,coalesce(p.feed_type_id,a.feed_type_id) id,coalesce(p.name,a.name) name,coalesce(p.qty,0)::numeric planned,coalesce(a.qty,0)::numeric actual
    from planned p full join actual a on a.d=p.d and a.feed_type_id=p.feed_type_id)
  select j.d,j.id,j.name,j.planned,j.actual,j.actual-j.planned from joined j order by j.d,j.name;
end;$$;

alter table public.rearing_feed_consumptions enable row level security;
alter table public.rearing_feed_plans enable row level security;
create policy rearing_feed_consumptions_member_read on public.rearing_feed_consumptions for select to authenticated using(public.is_farm_member(farm_id));
create policy rearing_feed_plans_member_read on public.rearing_feed_plans for select to authenticated using(public.is_farm_member(farm_id));
revoke all on public.rearing_feed_consumptions,public.rearing_feed_plans from public,anon,authenticated;
grant select on public.rearing_feed_consumptions,public.rearing_feed_plans,public.v_rearing_feed_history,public.v_rearing_feed_plan_daily to authenticated;
grant all on public.rearing_feed_consumptions,public.rearing_feed_plans to service_role;
grant select on public.v_rearing_feed_history,public.v_rearing_feed_plan_daily to service_role;

revoke all on function public.record_rearing_feed_consumption(uuid,uuid,date,numeric,uuid,text,text),public.correct_rearing_feed_consumption(uuid,uuid,date,numeric,text,text),public.save_rearing_feed_plan(uuid,uuid,text,numeric,date,text),public.create_rearing_health_record(uuid,date,text,text,text,text,text,text,numeric,text,text,numeric,date,text,numeric,text,text),public.create_rearing_health_reminder(uuid,text,text,date,text),public.create_rearing_cost_expense(uuid,text,date,uuid,text,uuid,text,numeric,numeric,text,text,text),public.get_rearing_cost_summary(uuid),public.get_rearing_feed_cost_history(uuid),public.get_rearing_feed_plan_variance(uuid,date,date) from public,anon;
grant execute on function public.record_rearing_feed_consumption(uuid,uuid,date,numeric,uuid,text,text),public.correct_rearing_feed_consumption(uuid,uuid,date,numeric,text,text),public.save_rearing_feed_plan(uuid,uuid,text,numeric,date,text),public.create_rearing_health_record(uuid,date,text,text,text,text,text,text,numeric,text,text,numeric,date,text,numeric,text,text),public.create_rearing_health_reminder(uuid,text,text,date,text),public.create_rearing_cost_expense(uuid,text,date,uuid,text,uuid,text,numeric,numeric,text,text,text),public.get_rearing_cost_summary(uuid),public.get_rearing_feed_cost_history(uuid),public.get_rearing_feed_plan_variance(uuid,date,date) to authenticated;

comment on table public.rearing_feed_consumptions is 'Batch-specific references to authoritative farm feed inventory consumption movements; never a second stock ledger.';
comment on column public.expenses.rearing_cost_kind is 'Optional management-cost attribution. Cash and obligations remain exclusively in expense_payments and the existing payable views.';
comment on function public.get_rearing_cost_summary(uuid) is 'Source-derived management rearing costs, not statutory biological-asset accounting; excludes feed purchases and supplier payments from incurred cost.';
