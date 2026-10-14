-- Extend DOC rearing to support both layer pullets and broilers while keeping
-- every population change in the existing rearing movement ledger.

alter table public.rearing_batches
  add column bird_purpose text not null default 'layer_pullet'
    check (bird_purpose in ('layer_pullet','broiler'));

alter table public.rearing_batches drop constraint rearing_batches_stage_check;
alter table public.rearing_batches add constraint rearing_batches_stage_check
  check (stage in ('brooding','growing','finishing','ready_for_transfer','ready_for_market'));

alter table public.rearing_daily_records
  add column feed_check text check(feed_check is null or feed_check in ('normal','reduced','not_checked')),
  add column water_check text check(water_check is null or water_check in ('normal','reduced','not_checked')),
  add column brooder_temperature_c numeric(5,2) check(brooder_temperature_c is null or brooder_temperature_c between -10 and 60);

create table public.rearing_weight_samples (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null,
  rearing_batch_id uuid not null,
  sample_date date not null,
  sample_size integer not null check(sample_size > 0),
  average_weight_kg numeric(8,4) not null check(average_weight_kg > 0 and average_weight_kg <= 50),
  uniformity_percentage numeric(5,2) check(uniformity_percentage is null or uniformity_percentage between 0 and 100),
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint rearing_weight_batch_same_farm foreign key(rearing_batch_id,farm_id)
    references public.rearing_batches(id,farm_id) on delete cascade,
  constraint rearing_weight_notes_length check(char_length(coalesce(notes,'')) <= 2000)
);
create index rearing_weight_batch_date_idx on public.rearing_weight_samples(farm_id,rearing_batch_id,sample_date desc,id);
alter table public.rearing_weight_samples enable row level security;
create policy rearing_weight_member_read on public.rearing_weight_samples for select to authenticated
  using(public.is_farm_member(farm_id));
revoke all on public.rearing_weight_samples from public,anon,authenticated;
grant select on public.rearing_weight_samples to authenticated;
grant all on public.rearing_weight_samples to service_role;

-- A broiler sale/dispatch is an operational outbound movement, not an egg sale.
-- Amounts are retained with the dispatch and do not enter egg receivables.
create table public.rearing_broiler_dispatches (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null,
  rearing_batch_id uuid not null,
  dispatch_date date not null,
  quantity integer not null check(quantity > 0),
  buyer_name text,
  total_amount numeric(14,2) not null default 0 check(total_amount >= 0),
  notes text,
  status text not null default 'posting' check(status in ('posting','posted','reversed')),
  source_movement_id uuid,
  reversal_movement_id uuid,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  void_reason text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint rearing_dispatch_id_farm_batch_unique unique(id,farm_id,rearing_batch_id),
  constraint rearing_dispatch_batch_same_farm foreign key(rearing_batch_id,farm_id)
    references public.rearing_batches(id,farm_id) on delete restrict,
  constraint rearing_dispatch_buyer_length check(char_length(coalesce(buyer_name,'')) <= 160),
  constraint rearing_dispatch_notes_length check(char_length(coalesce(notes,'')) <= 2000),
  constraint rearing_dispatch_reversal_state check(
    (status in ('posting','posted') and voided_at is null and voided_by is null and void_reason is null)
    or (status='reversed' and voided_at is not null and voided_by is not null and char_length(trim(void_reason)) >= 3)
  )
);
create index rearing_dispatch_batch_date_idx on public.rearing_broiler_dispatches(farm_id,rearing_batch_id,dispatch_date desc);
alter table public.rearing_movements add column dispatch_id uuid;
alter table public.rearing_movements drop constraint rearing_movements_movement_type_check;
alter table public.rearing_movements add constraint rearing_movements_movement_type_check
  check(movement_type in('arrival','death','reversal','transfer_out','transfer_reversal','broiler_dispatch','broiler_dispatch_reversal'));
alter table public.rearing_movements drop constraint rearing_movement_kind_direction;
alter table public.rearing_movements add constraint rearing_movement_kind_direction check (
  (movement_type='arrival' and direction='IN' and daily_record_id is null and reversal_of is null and transfer_id is null and dispatch_id is null)
  or (movement_type='death' and direction='OUT' and daily_record_id is not null and reversal_of is null and transfer_id is null and dispatch_id is null)
  or (movement_type='reversal' and direction='IN' and daily_record_id is not null and reversal_of is not null and transfer_id is null and dispatch_id is null)
  or (movement_type='transfer_out' and direction='OUT' and daily_record_id is null and reversal_of is null and transfer_id is not null and dispatch_id is null)
  or (movement_type='transfer_reversal' and direction='IN' and daily_record_id is null and reversal_of is not null and transfer_id is not null and dispatch_id is null)
  or (movement_type='broiler_dispatch' and direction='OUT' and daily_record_id is null and reversal_of is null and transfer_id is null and dispatch_id is not null)
  or (movement_type='broiler_dispatch_reversal' and direction='IN' and daily_record_id is null and reversal_of is not null and transfer_id is null and dispatch_id is not null)
);
alter table public.rearing_broiler_dispatches
  add constraint rearing_dispatch_source_movement_same_batch foreign key(source_movement_id,farm_id,rearing_batch_id)
    references public.rearing_movements(id,farm_id,rearing_batch_id) on delete restrict,
  add constraint rearing_dispatch_reversal_movement_same_batch foreign key(reversal_movement_id,farm_id,rearing_batch_id)
    references public.rearing_movements(id,farm_id,rearing_batch_id) on delete restrict;
alter table public.rearing_movements
  add constraint rearing_movement_dispatch_same_batch foreign key(dispatch_id,farm_id,rearing_batch_id)
    references public.rearing_broiler_dispatches(id,farm_id,rearing_batch_id) on delete restrict;
create unique index rearing_dispatch_one_outbound_idx on public.rearing_movements(dispatch_id) where movement_type='broiler_dispatch';
create unique index rearing_dispatch_one_reversal_idx on public.rearing_movements(reversal_of) where movement_type='broiler_dispatch_reversal';
alter table public.rearing_broiler_dispatches enable row level security;
create policy rearing_dispatch_financial_read on public.rearing_broiler_dispatches for select to authenticated
  using(public.has_farm_role(farm_id,array['admin','manager']));
revoke all on public.rearing_broiler_dispatches from public,anon,authenticated;
grant select on public.rearing_broiler_dispatches to authenticated;
grant all on public.rearing_broiler_dispatches to service_role;

create or replace view public.v_rearing_population with (security_invoker=true) as
select b.id batch_id,b.farm_id,b.batch_code,b.breed_or_strain,b.supplier_id,b.arrival_date,b.hatch_date,b.initial_quantity,b.stage,b.status,b.notes,b.created_at,
  coalesce(sum(case when m.direction='IN' then m.quantity else -m.quantity end),0)::integer current_birds,
  coalesce(sum(case when m.movement_type='death' then m.quantity when m.movement_type='reversal' then -m.quantity else 0 end),0)::integer cumulative_deaths,
  b.bird_purpose,b.feeding_stage
from public.rearing_batches b left join public.rearing_movements m on m.rearing_batch_id=b.id and m.farm_id=b.farm_id
group by b.id;

create or replace function public.create_rearing_batch_for_purpose(
  target_farm uuid,target_batch_code text,target_breed text,target_supplier uuid,target_arrival_date date,
  target_hatch_date date,target_initial_quantity integer,target_notes text,target_bird_purpose text
) returns public.rearing_batches language plpgsql security definer set search_path='' as $$
declare farm_timezone text; code text; created public.rearing_batches;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.has_farm_role(target_farm,array['admin','manager']) then raise exception 'Rearing batch access denied' using errcode='42501'; end if;
  select timezone into farm_timezone from public.farms where id=target_farm for update;
  if farm_timezone is null then raise exception 'Invalid farm' using errcode='23503'; end if;
  if target_bird_purpose not in ('layer_pullet','broiler') or target_initial_quantity is null or target_initial_quantity<=0
    or target_arrival_date is null or target_arrival_date>(now() at time zone farm_timezone)::date
    or (target_hatch_date is not null and target_hatch_date>target_arrival_date)
    or char_length(trim(coalesce(target_breed,''))) not between 1 and 120 or char_length(coalesce(target_notes,''))>2000 then
    raise exception 'Invalid rearing batch details' using errcode='23514';
  end if;
  if target_supplier is not null and not exists(select 1 from public.suppliers where id=target_supplier and farm_id=target_farm and active) then
    raise exception 'Invalid supplier for this farm' using errcode='23503';
  end if;
  code:=nullif(trim(target_batch_code),'');
  if code is null then
    select case when target_bird_purpose='broiler' then 'BR-' else 'DOC-' end||to_char(target_arrival_date,'YYYY')||'-'||
      lpad((coalesce(max(regexp_replace(batch_code,'.*-','')::integer),0)+1)::text,3,'0') into code
    from public.rearing_batches where farm_id=target_farm
      and batch_code ~ ('^(DOC|BR)-'||to_char(target_arrival_date,'YYYY')||'-[0-9]+$');
  end if;
  if char_length(code) not between 2 and 40 then raise exception 'Batch code must be 2 to 40 characters' using errcode='23514'; end if;
  insert into public.rearing_batches(farm_id,batch_code,breed_or_strain,supplier_id,arrival_date,hatch_date,initial_quantity,notes,bird_purpose,created_by,updated_by)
  values(target_farm,trim(code),trim(target_breed),target_supplier,target_arrival_date,target_hatch_date,target_initial_quantity,
    nullif(trim(target_notes),''),target_bird_purpose,auth.uid(),auth.uid()) returning * into created;
  insert into public.rearing_movements(farm_id,rearing_batch_id,movement_date,movement_type,direction,quantity,created_by)
  values(target_farm,created.id,target_arrival_date,'arrival','IN',target_initial_quantity,auth.uid());
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
  values(target_farm,auth.uid(),'rearing_batch.created','rearing_batches',created.id,'Rearing batch created',
    jsonb_build_object('batch_code',created.batch_code,'initial_quantity',created.initial_quantity,'arrival_date',created.arrival_date,
      'breed_or_strain',created.breed_or_strain,'bird_purpose',created.bird_purpose));
  return created;
exception when unique_violation then raise exception 'A rearing batch with this code already exists for this farm' using errcode='23505';
end; $$;

create or replace function public.change_rearing_batch_stage(target_batch uuid,new_stage text)
returns public.rearing_batches language plpgsql security definer set search_path='' as $$
declare b public.rearing_batches; result public.rearing_batches; valid_stage boolean;
begin
  select * into b from public.rearing_batches where id=target_batch for update;
  if b.id is null or not public.has_farm_role(b.farm_id,array['admin','manager']) then raise exception 'Rearing stage access denied' using errcode='42501'; end if;
  valid_stage:=case when b.bird_purpose='broiler' then new_stage in('brooding','growing','finishing','ready_for_market')
    else new_stage in('brooding','growing','ready_for_transfer') end;
  if b.status not in('active','partially_transferred') or not valid_stage then raise exception 'Invalid lifecycle stage for this batch type' using errcode='23514'; end if;
  if new_stage is distinct from b.stage then
    update public.rearing_batches set stage=new_stage,updated_by=auth.uid() where id=b.id returning * into result;
    insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
    values(b.farm_id,auth.uid(),'rearing_batch.stage_changed','rearing_batches',b.id,'Rearing batch stage changed',
      jsonb_build_object('batch_code',b.batch_code,'bird_purpose',b.bird_purpose,'previous_stage',b.stage,'new_stage',new_stage));
  else result:=b; end if;
  return result;
end; $$;

create or replace function public.guard_rearing_transfer_is_layer_pullet()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.rearing_batches where id=new.source_batch_id and farm_id=new.farm_id and bird_purpose<>'layer_pullet') then
    raise exception 'Only layer-pullet batches can be transferred into a layer flock' using errcode='23514';
  end if;
  return new;
end; $$;
create trigger rearing_transfer_layer_pullet_only before insert or update of source_batch_id on public.rearing_transfers
  for each row execute function public.guard_rearing_transfer_is_layer_pullet();

create or replace function public.save_rearing_daily_record_v2(
  target_batch uuid,target_record_date date,target_deaths integer,target_observations text,target_record uuid,
  target_feed_check text,target_water_check text,target_brooder_temperature_c numeric
) returns public.rearing_daily_records language plpgsql security definer set search_path='' as $$
declare r public.rearing_daily_records; b public.rearing_batches;
begin
  if target_feed_check is not null and target_feed_check not in('normal','reduced','not_checked')
    or target_water_check is not null and target_water_check not in('normal','reduced','not_checked')
    or target_brooder_temperature_c is not null and target_brooder_temperature_c not between -10 and 60 then
    raise exception 'Check the optional feed, water, and brooder temperature values' using errcode='22023';
  end if;
  select * into b from public.rearing_batches where id=target_batch;
  if b.id is null then raise exception 'Rearing batch not found' using errcode='23503'; end if;
  if target_brooder_temperature_c is not null and b.bird_purpose<>'broiler' then
    raise exception 'Brooder temperature is only available for broiler batches' using errcode='23514';
  end if;
  r:=public.save_rearing_daily_record(target_batch,target_record_date,target_deaths,target_observations,target_record);
  update public.rearing_daily_records set feed_check=target_feed_check,water_check=target_water_check,
    brooder_temperature_c=target_brooder_temperature_c,updated_by=auth.uid()
  where id=r.id returning * into r;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
  values(r.farm_id,auth.uid(),'rearing_daily_checkin.updated','rearing_daily_records',r.id,'Optional daily check-in saved',
    jsonb_build_object('feed_check',r.feed_check,'water_check',r.water_check,'brooder_temperature_c',r.brooder_temperature_c));
  return r;
end; $$;

create or replace function public.record_rearing_weight_sample(
  target_batch uuid,target_date date,target_sample_size integer,target_average_weight_kg numeric,
  target_uniformity_percentage numeric,target_notes text default null
) returns public.rearing_weight_samples language plpgsql security definer set search_path='' as $$
declare b public.rearing_batches; f_today date; created public.rearing_weight_samples; available integer;
begin
  select rb, (now() at time zone fa.timezone)::date into b,f_today
  from public.rearing_batches rb join public.farms fa on fa.id=rb.farm_id where rb.id=target_batch for update of rb;
  if b.id is null or not public.has_farm_role(b.farm_id,array['admin','manager','worker']) then raise exception 'Rearing weight sample access denied' using errcode='42501'; end if;
  if target_date is null or target_date<b.arrival_date or target_date>f_today or target_sample_size is null or target_sample_size<=0
    or target_average_weight_kg is null or target_average_weight_kg<=0 or target_average_weight_kg>50
    or target_uniformity_percentage is not null and target_uniformity_percentage not between 0 and 100
    or char_length(coalesce(target_notes,''))>2000 then raise exception 'Check the sample date, sample size, average weight, and uniformity' using errcode='23514'; end if;
  available:=public.rearing_balance_at(b.id,target_date);
  if target_sample_size>available then raise exception 'Sample size exceeds birds available on that date' using errcode='23514'; end if;
  insert into public.rearing_weight_samples(farm_id,rearing_batch_id,sample_date,sample_size,average_weight_kg,uniformity_percentage,notes,created_by)
  values(b.farm_id,b.id,target_date,target_sample_size,target_average_weight_kg,target_uniformity_percentage,nullif(trim(target_notes),''),auth.uid()) returning * into created;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
  values(b.farm_id,auth.uid(),'rearing_weight_sample.created','rearing_weight_samples',created.id,'Rearing weight sample recorded',
    jsonb_build_object('batch_code',b.batch_code,'sample_date',target_date,'sample_size',target_sample_size,
      'average_weight_kg',target_average_weight_kg,'uniformity_percentage',target_uniformity_percentage));
  return created;
end; $$;

create or replace function public.post_rearing_broiler_dispatch(
  target_batch uuid,target_date date,target_quantity integer,target_buyer text,target_total_amount numeric,target_notes text
) returns public.rearing_broiler_dispatches language plpgsql security definer set search_path='' as $$
declare b public.rearing_batches; tz text; today date; available integer; x public.rearing_broiler_dispatches; m public.rearing_movements;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into b from public.rearing_batches where id=target_batch for update;
  if b.id is null or not public.has_farm_role(b.farm_id,array['admin','manager']) then raise exception 'Broiler dispatch access denied' using errcode='42501'; end if;
  if b.bird_purpose<>'broiler' or b.status not in('active','partially_transferred') or b.stage<>'ready_for_market' then
    raise exception 'Only an active broiler batch marked Ready for market can be sold or dispatched' using errcode='23514';
  end if;
  select timezone into tz from public.farms where id=b.farm_id; today:=(now() at time zone tz)::date;
  if target_date is null or target_date<b.arrival_date or target_date>today or target_quantity is null or target_quantity<=0
    or target_total_amount is null or target_total_amount<0 or char_length(coalesce(target_buyer,''))>160
    or char_length(coalesce(target_notes,''))>2000 then raise exception 'Check the dispatch date, bird quantity, buyer, and sale value' using errcode='23514'; end if;
  if exists(select 1 from public.rearing_broiler_dispatches where rearing_batch_id=b.id and status='posted' and dispatch_date>target_date) then
    raise exception 'A later broiler dispatch exists; record dispatches in date order' using errcode='23514';
  end if;
  select coalesce(sum(case when direction='IN' then quantity else -quantity end),0)::integer into available
    from public.rearing_movements where rearing_batch_id=b.id and farm_id=b.farm_id and movement_date<=target_date;
  if target_quantity>available then raise exception 'Dispatch quantity exceeds birds available on that date' using errcode='23514'; end if;
  insert into public.rearing_broiler_dispatches(farm_id,rearing_batch_id,dispatch_date,quantity,buyer_name,total_amount,notes,created_by)
  values(b.farm_id,b.id,target_date,target_quantity,nullif(trim(target_buyer),''),target_total_amount,nullif(trim(target_notes),''),auth.uid()) returning * into x;
  insert into public.rearing_movements(farm_id,rearing_batch_id,movement_date,movement_type,direction,quantity,dispatch_id,notes,created_by)
  values(b.farm_id,b.id,target_date,'broiler_dispatch','OUT',target_quantity,x.id,'Broiler sale/dispatch',auth.uid()) returning * into m;
  update public.rearing_broiler_dispatches set source_movement_id=m.id,status='posted' where id=x.id returning * into x;
  perform public.assert_nonnegative_rearing_history(b.id);
  if available-target_quantity=0 then update public.rearing_batches set status='closed',updated_by=auth.uid() where id=b.id; end if;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
  values(b.farm_id,auth.uid(),'rearing.broiler_dispatch_posted','rearing_broiler_dispatches',x.id,'Broiler sale/dispatch recorded',
    jsonb_build_object('batch_code',b.batch_code,'dispatch_date',target_date,'quantity',target_quantity,
      'buyer_name',x.buyer_name,'total_amount',target_total_amount,'movement_id',m.id));
  return x;
end; $$;

create or replace function public.reverse_rearing_broiler_dispatch(target_dispatch uuid,target_reason text)
returns public.rearing_broiler_dispatches language plpgsql security definer set search_path='' as $$
declare x public.rearing_broiler_dispatches; b public.rearing_batches; source public.rearing_movements; reversal public.rearing_movements;
begin
  select * into x from public.rearing_broiler_dispatches where id=target_dispatch for update;
  if x.id is null or not public.has_farm_role(x.farm_id,array['admin']) then raise exception 'Only a farm admin may reverse a broiler dispatch' using errcode='42501'; end if;
  if x.status<>'posted' or char_length(trim(coalesce(target_reason,'')))<3 then raise exception 'Only a posted dispatch and a reason of at least 3 characters can be reversed' using errcode='23514'; end if;
  select * into b from public.rearing_batches where id=x.rearing_batch_id for update;
  if exists(select 1 from public.rearing_movements m where m.rearing_batch_id=b.id and m.movement_date>x.dispatch_date and m.movement_type not in('broiler_dispatch_reversal')) then
    raise exception 'A later population movement exists; reconcile it before reversing this dispatch' using errcode='23514'; end if;
  select * into source from public.rearing_movements where id=x.source_movement_id and dispatch_id=x.id for update;
  if source.id is null then raise exception 'Dispatch population movement is missing; contact support' using errcode='23514'; end if;
  insert into public.rearing_movements(farm_id,rearing_batch_id,movement_date,movement_type,direction,quantity,reversal_of,dispatch_id,notes,created_by)
  values(x.farm_id,x.rearing_batch_id,x.dispatch_date,'broiler_dispatch_reversal','IN',source.quantity,source.id,x.id,trim(target_reason),auth.uid()) returning * into reversal;
  update public.rearing_broiler_dispatches set status='reversed',reversal_movement_id=reversal.id,voided_at=now(),voided_by=auth.uid(),void_reason=trim(target_reason) where id=x.id returning * into x;
  update public.rearing_batches set status='active',updated_by=auth.uid() where id=b.id and status='closed';
  perform public.assert_nonnegative_rearing_history(b.id);
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
  values(x.farm_id,auth.uid(),'rearing.broiler_dispatch_reversed','rearing_broiler_dispatches',x.id,'Broiler dispatch reversed',
    jsonb_build_object('reversal_reason',trim(target_reason),'movement_id',reversal.id));
  return x;
end; $$;

-- Keep the existing reconciliation contract correct when broiler outbound
-- movements are present; they are not layer transfers or mortality.
create or replace function public.get_rearing_reconciliation(target_batch uuid)
returns table(category text, expected_value numeric, actual_value numeric, difference numeric,
  reconciliation_status text, source_references jsonb)
language plpgsql stable security definer set search_path='' as $$
declare f uuid; financial boolean;
begin
  select farm_id into f from public.rearing_batches where id=target_batch;
  if f is null or not public.has_farm_role(f,array['admin','manager','worker']) then
    raise exception 'Rearing reconciliation access denied' using errcode='42501';
  end if;
  financial:=public.has_farm_role(f,array['admin','manager']);
  return query
  with batch as (
    select b.initial_quantity,p.current_birds,p.cumulative_deaths
    from public.rearing_batches b join public.v_rearing_population p on p.batch_id=b.id and p.farm_id=b.farm_id
    where b.id=target_batch and b.farm_id=f
  ), movement as (
    select coalesce(sum(case when direction='IN' then quantity else -quantity end),0)::numeric current_value,
      coalesce(sum(quantity) filter(where movement_type='death'),0)::numeric gross_deaths,
      coalesce(sum(quantity) filter(where movement_type='reversal'),0)::numeric death_reversals,
      bool_and(running_birds>=0) nonnegative
    from public.v_rearing_population_history where rearing_batch_id=target_batch and farm_id=f
  ), transfer as (
    select coalesce(sum(transfer_quantity) filter(where status='posted'),0)::numeric valid_birds,
      count(*) filter(where status='posted' and not coalesce(reconciles,false)) bad_count,
      coalesce(jsonb_agg(transfer_id) filter(where status='posted' and not coalesce(reconciles,false)),'[]'::jsonb) bad_ids
    from public.v_rearing_transfer_reconciliation where source_batch_id=target_batch and farm_id=f
  ), dispatch as (
    select coalesce(sum(quantity) filter(where status='posted'),0)::numeric valid_birds,
      count(*) filter(where status='posted' and source_movement_id is null)::integer bad_count,
      coalesce(jsonb_agg(id) filter(where status='posted' and source_movement_id is null),'[]'::jsonb) bad_ids
    from public.rearing_broiler_dispatches where rearing_batch_id=target_batch and farm_id=f
  ), dispatch_movements as (
    select coalesce(sum(case when movement_type='broiler_dispatch' then quantity else -quantity end),0)::numeric ledger_birds
    from public.rearing_movements where rearing_batch_id=target_batch and farm_id=f
      and movement_type in('broiler_dispatch','broiler_dispatch_reversal')
  ), daily_mortality as (
    select coalesce(sum(deaths),0)::numeric quantity from public.rearing_daily_records
    where farm_id=f and rearing_batch_id=target_batch
  ), feed as (
    select coalesce(sum(c.quantity_kg),0)::numeric qty,
      coalesce(sum(m.quantity_kg) filter(where m.movement_type='consumption' and m.direction='OUT'),0)::numeric ledger_qty,
      coalesce(sum(m.total_cost_snapshot),0)::numeric cost,
      count(*) filter(where m.total_cost_snapshot is null)::integer missing_costs
    from public.rearing_feed_consumptions c join public.feed_inventory_movements m on m.id=c.movement_id and m.farm_id=c.farm_id
    where c.farm_id=f and c.rearing_batch_id=target_batch and c.active
  ), costs as (
    select public.rearing_cost_total_at(target_batch,(now() at time zone fa.timezone)::date)::numeric historical,
      coalesce((select sum(t.total_cost_transferred) from public.rearing_transfers t where t.farm_id=f and t.source_batch_id=target_batch and t.status='posted'),0)::numeric transferred
    from public.farms fa where fa.id=f
  ), checks as (
    select 'population'::text cat,b.initial_quantity::numeric exp,
      (b.current_birds+b.cumulative_deaths+t.valid_birds+d.valid_birds)::numeric act,
      case when m.nonnegative and b.current_birds=m.current_value then 'RECONCILED' else 'DISCREPANCY' end st,
      jsonb_build_array(target_batch) refs from batch b cross join movement m cross join transfer t cross join dispatch d
    union all
    select 'mortality',m.gross_deaths-m.death_reversals,dm.quantity,
      case when m.gross_deaths-m.death_reversals=dm.quantity and (select cumulative_deaths from batch)=dm.quantity then 'RECONCILED' else 'DISCREPANCY' end,
      jsonb_build_array(target_batch) from movement m cross join daily_mortality dm
    union all
    select 'point_of_lay_transfers',t.valid_birds,t.valid_birds,
      case when t.bad_count=0 then 'RECONCILED' else 'DISCREPANCY' end,t.bad_ids from transfer t
    union all
    select 'broiler_dispatches',d.valid_birds,dm.ledger_birds,
      case when d.bad_count=0 and d.valid_birds=dm.ledger_birds then 'RECONCILED' else 'DISCREPANCY' end,
      case when d.bad_count=0 then jsonb_build_array(target_batch) else d.bad_ids end from dispatch d cross join dispatch_movements dm
    union all
    select 'feed_quantity',feed.qty,feed.ledger_qty,
      case when feed.qty=feed.ledger_qty then 'RECONCILED' else 'DISCREPANCY' end,jsonb_build_array(target_batch) from feed
    union all
    select 'feed_cost',case when financial then feed.cost else null end,case when financial then feed.cost else null end,
      case when not financial then 'NOT APPLICABLE' when feed.missing_costs>0 then 'INSUFFICIENT SOURCE DATA' else 'RECONCILED' end,
      jsonb_build_object('missing_cost_snapshots',feed.missing_costs) from feed
    union all
    select 'remaining_rearing_cost',case when financial then costs.historical-costs.transferred else null end,
      case when financial then costs.historical-costs.transferred else null end,
      case when not financial then 'NOT APPLICABLE' when costs.historical<costs.transferred then 'DISCREPANCY' else 'RECONCILED' end,
      jsonb_build_array(target_batch) from costs
  )
  select cat,exp,act,case when exp is null or act is null then null else act-exp end,st,refs from checks;
end; $$;

-- Purchase edits are date-effective stock changes. Block future dates in the
-- database as well as in the form; keep payment entries as their own ledger.
create or replace function public.update_feed_purchase(
  target_purchase uuid,supplier_id uuid,purchase_date date,bags numeric,bag_size_kg numeric,cost_per_bag numeric,notes text default null
) returns public.feed_purchases language plpgsql security definer set search_path='' as $$
declare p public.feed_purchases; r public.feed_purchases; paid numeric; kg numeric; total numeric; farm_timezone text;
begin
  select * into p from public.feed_purchases where id=target_purchase for update;
  if p.id is null or p.status<>'completed' or not public.has_farm_role(p.farm_id,array['admin','manager']) then
    raise exception 'Purchase edit denied' using errcode='42501';
  end if;
  select timezone into farm_timezone from public.farms where id=p.farm_id;
  if purchase_date is null or purchase_date>(now() at time zone farm_timezone)::date then
    raise exception 'Purchase date cannot be in the future' using errcode='23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p.farm_id::text||p.feed_type_id::text,0));
  if $2 is not null and not exists(select 1 from public.suppliers where id=$2 and farm_id=p.farm_id) then
    raise exception 'Invalid supplier' using errcode='42501';
  end if;
  kg:=round(bags*bag_size_kg,3); total:=round(bags*cost_per_bag,2);
  select coalesce(sum(amount),0) into paid from public.feed_purchase_payments where feed_purchase_id=p.id and voided_at is null;
  if bags is null or bag_size_kg is null or cost_per_bag is null or bags<=0 or bag_size_kg<=0 or cost_per_bag<0 or total<paid then
    raise exception 'Invalid purchase edit or total below payments' using errcode='23514';
  end if;
  update public.feed_purchases set supplier_id=$2,purchase_date=$3,bags=$4,bag_size_kg=$5,
    total_kg=kg,cost_per_bag=$6,cost_per_kg=round(total/kg,4),total_cost=total,
    notes=nullif(trim($7),''),updated_by=auth.uid() where id=p.id returning * into r;
  update public.feed_inventory_movements set movement_date=$3,quantity_kg=kg,
    unit_cost_snapshot=round(total/kg,4),total_cost_snapshot=total
    where source_type='feed_purchase' and source_id=p.id and movement_type='purchase';
  perform public.recalculate_feed_ledger(p.farm_id,p.feed_type_id);
  return r;
end; $$;

revoke all on function public.create_rearing_batch_for_purpose(uuid,text,text,uuid,date,date,integer,text,text),
  public.change_rearing_batch_stage(uuid,text),public.guard_rearing_transfer_is_layer_pullet(),
  public.save_rearing_daily_record_v2(uuid,date,integer,text,uuid,text,text,numeric),
  public.record_rearing_weight_sample(uuid,date,integer,numeric,numeric,text),
  public.post_rearing_broiler_dispatch(uuid,date,integer,text,numeric,text),
  public.reverse_rearing_broiler_dispatch(uuid,text),public.get_rearing_reconciliation(uuid) from public,anon;
grant execute on function public.create_rearing_batch_for_purpose(uuid,text,text,uuid,date,date,integer,text,text),
  public.change_rearing_batch_stage(uuid,text),public.save_rearing_daily_record_v2(uuid,date,integer,text,uuid,text,text,numeric),
  public.record_rearing_weight_sample(uuid,date,integer,numeric,numeric,text),
  public.post_rearing_broiler_dispatch(uuid,date,integer,text,numeric,text),
  public.reverse_rearing_broiler_dispatch(uuid,text),public.get_rearing_reconciliation(uuid) to authenticated;
revoke all on function public.guard_rearing_transfer_is_layer_pullet() from public,anon,authenticated;
grant execute on function public.create_rearing_batch_for_purpose(uuid,text,text,uuid,date,date,integer,text,text),
  public.change_rearing_batch_stage(uuid,text),public.save_rearing_daily_record_v2(uuid,date,integer,text,uuid,text,text,numeric),
  public.record_rearing_weight_sample(uuid,date,integer,numeric,numeric,text),
  public.post_rearing_broiler_dispatch(uuid,date,integer,text,numeric,text),
  public.reverse_rearing_broiler_dispatch(uuid,text) to service_role;

comment on column public.rearing_batches.bird_purpose is 'Layer pullets may transfer into a layer flock; broilers use a separate dispatch ledger.';
comment on table public.rearing_broiler_dispatches is 'Broiler sales/dispatch records; bird quantities post to rearing_movements. This is separate from egg sales and customer receivables.';
comment on table public.rearing_weight_samples is 'Sampled average live weights and uniformity for growth review; not a veterinary diagnosis.';
