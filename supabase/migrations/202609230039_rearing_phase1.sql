-- DOC/Pullet rearing foundation. This stays separate from layer flocks and bird_movements.
create unique index if not exists suppliers_id_farm_uidx on public.suppliers(id, farm_id);

create table public.rearing_batches (
  id uuid primary key default gen_random_uuid(), farm_id uuid not null references public.farms(id) on delete cascade,
  batch_code text not null check (char_length(trim(batch_code)) between 2 and 40),
  breed_or_strain text not null check (char_length(trim(breed_or_strain)) between 1 and 120), supplier_id uuid,
  arrival_date date not null, hatch_date date, initial_quantity integer not null check (initial_quantity > 0),
  stage text not null default 'brooding' check (stage in ('brooding','growing','ready_for_transfer')),
  status text not null default 'active' check (status in ('active','partially_transferred','transferred','closed')), notes text,
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id), updated_at timestamptz not null default now(),
  constraint rearing_batch_dates_valid check (hatch_date is null or hatch_date <= arrival_date),
  constraint rearing_batch_id_farm_unique unique (id,farm_id),
  constraint rearing_batch_supplier_same_farm foreign key (supplier_id,farm_id) references public.suppliers(id,farm_id) on delete restrict
);
create unique index rearing_batches_farm_code_uidx on public.rearing_batches(farm_id,lower(batch_code));
create index rearing_batches_farm_status_stage_idx on public.rearing_batches(farm_id,status,stage,arrival_date desc,id);
create trigger rearing_batches_updated_at before update on public.rearing_batches for each row execute function public.set_updated_at();

create table public.rearing_daily_records (
  id uuid primary key default gen_random_uuid(), farm_id uuid not null, rearing_batch_id uuid not null,
  record_date date not null, deaths integer not null default 0 check (deaths >= 0), observations text,
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id), updated_at timestamptz not null default now(),
  constraint rearing_daily_batch_same_farm foreign key (rearing_batch_id,farm_id) references public.rearing_batches(id,farm_id) on delete cascade,
  constraint rearing_daily_id_farm_batch_unique unique(id,farm_id,rearing_batch_id),
  constraint rearing_daily_batch_date_unique unique(farm_id,rearing_batch_id,record_date)
);
create index rearing_daily_farm_date_idx on public.rearing_daily_records(farm_id,rearing_batch_id,record_date desc,id);
create trigger rearing_daily_updated_at before update on public.rearing_daily_records for each row execute function public.set_updated_at();

create table public.rearing_movements (
  id uuid primary key default gen_random_uuid(), farm_id uuid not null, rearing_batch_id uuid not null, daily_record_id uuid,
  movement_date date not null, movement_type text not null check (movement_type in ('arrival','death','reversal')),
  direction text not null check (direction in ('IN','OUT')), quantity integer not null check (quantity > 0),
  reversal_of uuid, notes text, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  constraint rearing_movement_batch_same_farm foreign key (rearing_batch_id,farm_id) references public.rearing_batches(id,farm_id) on delete cascade,
  constraint rearing_movement_daily_same_batch foreign key (daily_record_id,farm_id,rearing_batch_id) references public.rearing_daily_records(id,farm_id,rearing_batch_id) on delete restrict,
  constraint rearing_movement_id_farm_batch_unique unique(id,farm_id,rearing_batch_id),
  constraint rearing_movement_reversal_same_batch foreign key (reversal_of,farm_id,rearing_batch_id) references public.rearing_movements(id,farm_id,rearing_batch_id) on delete restrict,
  constraint rearing_movement_kind_direction check (
    (movement_type='arrival' and direction='IN' and daily_record_id is null and reversal_of is null)
    or (movement_type='death' and direction='OUT' and daily_record_id is not null and reversal_of is null)
    or (movement_type='reversal' and direction='IN' and daily_record_id is not null and reversal_of is not null)
  )
);
create unique index rearing_movements_one_arrival_idx on public.rearing_movements(rearing_batch_id) where movement_type='arrival';
create unique index rearing_movements_one_reversal_idx on public.rearing_movements(reversal_of) where reversal_of is not null;
create index rearing_movements_timeline_idx on public.rearing_movements(rearing_batch_id,movement_date,created_at,id);
create index rearing_movements_daily_idx on public.rearing_movements(daily_record_id) where daily_record_id is not null;

alter table public.rearing_batches enable row level security;
alter table public.rearing_daily_records enable row level security;
alter table public.rearing_movements enable row level security;
create policy rearing_batches_member_read on public.rearing_batches for select to authenticated using (public.is_farm_member(farm_id));
create policy rearing_daily_member_read on public.rearing_daily_records for select to authenticated using (public.is_farm_member(farm_id));
create policy rearing_movements_member_read on public.rearing_movements for select to authenticated using (public.is_farm_member(farm_id));
revoke all on public.rearing_batches,public.rearing_daily_records,public.rearing_movements from public,anon,authenticated;
grant select on public.rearing_batches,public.rearing_daily_records,public.rearing_movements to authenticated;
grant all on public.rearing_batches,public.rearing_daily_records,public.rearing_movements to service_role;

create view public.v_rearing_population with (security_invoker=true) as
select b.id batch_id,b.farm_id,b.batch_code,b.breed_or_strain,b.supplier_id,b.arrival_date,b.hatch_date,b.initial_quantity,b.stage,b.status,b.notes,b.created_at,
  coalesce(sum(case when m.direction='IN' then m.quantity else -m.quantity end),0)::integer current_birds,
  coalesce(sum(case when m.movement_type='death' then m.quantity when m.movement_type='reversal' then -m.quantity else 0 end),0)::integer cumulative_deaths
from public.rearing_batches b left join public.rearing_movements m on m.rearing_batch_id=b.id and m.farm_id=b.farm_id
group by b.id;
grant select on public.v_rearing_population to authenticated;

create view public.v_rearing_population_history with (security_invoker=true) as
select m.id movement_id,m.farm_id,m.rearing_batch_id,m.daily_record_id,m.movement_date,m.movement_type,m.direction,m.quantity,m.reversal_of,m.notes,m.created_by,m.created_at,
  sum(case when m.direction='IN' then m.quantity else -m.quantity end) over(partition by m.rearing_batch_id order by m.movement_date,case when m.movement_type='arrival' then 0 else 1 end,m.created_at,m.id)::integer running_birds
from public.rearing_movements m;
grant select on public.v_rearing_population_history to authenticated;

create view public.v_rearing_portfolio_summary with (security_invoker=true) as
select farm_id,count(*) filter(where status in ('active','partially_transferred'))::integer active_batches,
  coalesce(sum(initial_quantity) filter(where status in ('active','partially_transferred')),0)::bigint initial_chicks,
  coalesce(sum(current_birds) filter(where status in ('active','partially_transferred')),0)::bigint current_birds,
  coalesce(sum(cumulative_deaths) filter(where status in ('active','partially_transferred')),0)::bigint cumulative_deaths,
  count(*) filter(where status in ('active','partially_transferred') and stage='ready_for_transfer')::integer ready_for_transfer
from public.v_rearing_population group by farm_id;
grant select on public.v_rearing_portfolio_summary to authenticated;

create function public.rearing_balance_at(target_batch uuid,target_date date)
returns integer language plpgsql stable security definer set search_path='' as $$
declare f uuid; result integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select farm_id into f from public.rearing_batches where id=target_batch;
  if f is null or not public.is_farm_member(f) then raise exception 'Rearing access denied' using errcode='42501'; end if;
  select coalesce(sum(case when m.direction='IN' then m.quantity else -m.quantity end),0)::integer into result
  from public.rearing_movements m where m.rearing_batch_id=target_batch and (m.movement_date<target_date or (m.movement_date=target_date and m.movement_type='arrival'));
  return result;
end;$$;

create function public.assert_nonnegative_rearing_history(target_batch uuid)
returns void language plpgsql security definer set search_path='' as $$
declare balance bigint:=0; m record;
begin
  for m in select movement_type,direction,quantity from public.rearing_movements where rearing_batch_id=target_batch
    order by movement_date,case when movement_type='arrival' then 0 else 1 end,created_at,id loop
    balance:=balance+case when m.direction='IN' then m.quantity else -m.quantity end;
    if balance<0 then raise exception 'Rearing mortality would make the batch population negative' using errcode='23514'; end if;
  end loop;
end;$$;

create function public.create_rearing_batch(target_farm uuid,target_batch_code text,target_breed text,target_supplier uuid,target_arrival_date date,target_hatch_date date,target_initial_quantity integer,target_notes text default null)
returns public.rearing_batches language plpgsql security definer set search_path='' as $$
declare farm_timezone text; code text; created public.rearing_batches;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.has_farm_role(target_farm,array['admin','manager']) then raise exception 'Rearing batch access denied' using errcode='42501'; end if;
  select timezone into farm_timezone from public.farms where id=target_farm for update;
  if farm_timezone is null then raise exception 'Invalid farm' using errcode='23503'; end if;
  if target_initial_quantity is null or target_initial_quantity<=0 or target_arrival_date is null
    or target_arrival_date>(now() at time zone farm_timezone)::date
    or (target_hatch_date is not null and target_hatch_date>target_arrival_date)
    or char_length(trim(coalesce(target_breed,''))) not between 1 and 120
    or char_length(coalesce(target_notes,''))>2000 then raise exception 'Invalid rearing batch details' using errcode='23514'; end if;
  if target_supplier is not null and not exists(select 1 from public.suppliers where id=target_supplier and farm_id=target_farm and active) then raise exception 'Invalid supplier for this farm' using errcode='23503'; end if;
  code:=nullif(trim(target_batch_code),'');
  if code is null then
    select 'DOC-'||to_char(target_arrival_date,'YYYY')||'-'||lpad((coalesce(max(substring(batch_code from 10)::integer),0)+1)::text,3,'0') into code
    from public.rearing_batches where farm_id=target_farm and batch_code ~ ('^DOC-'||to_char(target_arrival_date,'YYYY')||'-[0-9]+$');
  end if;
  if char_length(code) not between 2 and 40 then raise exception 'Batch code must be 2 to 40 characters' using errcode='23514'; end if;
  insert into public.rearing_batches(farm_id,batch_code,breed_or_strain,supplier_id,arrival_date,hatch_date,initial_quantity,notes,created_by,updated_by)
  values(target_farm,trim(code),trim(target_breed),target_supplier,target_arrival_date,target_hatch_date,target_initial_quantity,nullif(trim(target_notes),''),auth.uid(),auth.uid()) returning * into created;
  insert into public.rearing_movements(farm_id,rearing_batch_id,movement_date,movement_type,direction,quantity,created_by)
  values(target_farm,created.id,target_arrival_date,'arrival','IN',target_initial_quantity,auth.uid());
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
  values(target_farm,auth.uid(),'rearing_batch.created','rearing_batches',created.id,'Rearing batch created',jsonb_build_object('batch_code',created.batch_code,'initial_quantity',created.initial_quantity,'arrival_date',created.arrival_date,'breed_or_strain',created.breed_or_strain));
  return created;
exception when unique_violation then raise exception 'A rearing batch with this code already exists for this farm' using errcode='23505';
end;$$;

create function public.update_rearing_batch(target_batch uuid,target_breed text,target_supplier uuid,target_arrival_date date,target_hatch_date date,target_notes text default null)
returns public.rearing_batches language plpgsql security definer set search_path='' as $$
declare b public.rearing_batches; farm_timezone text; result public.rearing_batches;
begin
  select * into b from public.rearing_batches where id=target_batch for update;
  if b.id is null or not public.has_farm_role(b.farm_id,array['admin','manager']) then raise exception 'Rearing batch access denied' using errcode='42501'; end if;
  select timezone into farm_timezone from public.farms where id=b.farm_id;
  if b.status<>'active' or char_length(trim(coalesce(target_breed,''))) not between 1 and 120 or target_arrival_date>(now() at time zone farm_timezone)::date
    or (target_hatch_date is not null and target_hatch_date>target_arrival_date) or char_length(coalesce(target_notes,''))>2000 then raise exception 'Invalid rearing batch details' using errcode='23514'; end if;
  if target_supplier is not null and not exists(select 1 from public.suppliers where id=target_supplier and farm_id=b.farm_id and active) then raise exception 'Invalid supplier for this farm' using errcode='23503'; end if;
  if target_arrival_date is distinct from b.arrival_date then raise exception 'Arrival date is part of the population ledger and cannot be changed after batch creation' using errcode='23514'; end if;
  update public.rearing_batches set breed_or_strain=trim(target_breed),supplier_id=target_supplier,hatch_date=target_hatch_date,notes=nullif(trim(target_notes),''),updated_by=auth.uid() where id=b.id returning * into result;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
  values(b.farm_id,auth.uid(),'rearing_batch.updated','rearing_batches',b.id,'Rearing batch details updated',jsonb_build_object('batch_code',b.batch_code,'previous_breed_or_strain',b.breed_or_strain,'new_breed_or_strain',result.breed_or_strain,'previous_supplier_id',b.supplier_id,'new_supplier_id',result.supplier_id,'previous_hatch_date',b.hatch_date,'new_hatch_date',result.hatch_date));
  return result;
end;$$;

create function public.change_rearing_batch_stage(target_batch uuid,new_stage text)
returns public.rearing_batches language plpgsql security definer set search_path='' as $$
declare b public.rearing_batches; result public.rearing_batches;
begin
  select * into b from public.rearing_batches where id=target_batch for update;
  if b.id is null or not public.has_farm_role(b.farm_id,array['admin','manager']) then raise exception 'Rearing stage access denied' using errcode='42501'; end if;
  if b.status<>'active' or new_stage not in ('brooding','growing','ready_for_transfer') then raise exception 'Invalid lifecycle stage' using errcode='23514'; end if;
  if new_stage is distinct from b.stage then
    update public.rearing_batches set stage=new_stage,updated_by=auth.uid() where id=b.id returning * into result;
    insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
    values(b.farm_id,auth.uid(),'rearing_batch.stage_changed','rearing_batches',b.id,'Rearing batch stage changed',jsonb_build_object('batch_code',b.batch_code,'previous_stage',b.stage,'new_stage',new_stage));
  else result:=b; end if;
  return result;
end;$$;

create function public.save_rearing_daily_record(target_batch uuid,target_record_date date,target_deaths integer,target_observations text,target_record uuid default null)
returns public.rearing_daily_records language plpgsql security definer set search_path='' as $$
declare b public.rearing_batches; existing public.rearing_daily_records; r public.rearing_daily_records; member_role text; farm_timezone text; available integer; old_movement public.rearing_movements; new_movement public.rearing_movements;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into b from public.rearing_batches where id=target_batch for update;
  if b.id is null or b.status<>'active' then raise exception 'Active rearing batch required' using errcode='23514'; end if;
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
      values(b.farm_id,auth.uid(),'rearing_mortality.recorded','rearing_movements',new_movement.id,'Rearing mortality recorded',jsonb_build_object('batch_code',b.batch_code,'event_date',target_record_date,'quantity',target_deaths));
    end if;
    insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
    values(b.farm_id,auth.uid(),'rearing_daily_record.created','rearing_daily_records',r.id,'Rearing daily record created',jsonb_build_object('batch_code',b.batch_code,'record_date',target_record_date,'deaths',target_deaths));
    return r;
  end if;
  if member_role not in ('admin','manager') then raise exception 'Only farm admins or managers may correct a posted daily record' using errcode='42501'; end if;
  select * into existing from public.rearing_daily_records where id=target_record and rearing_batch_id=b.id and farm_id=b.farm_id for update;
  if existing.id is null or existing.record_date is distinct from target_record_date then raise exception 'Daily record not found or date cannot be changed' using errcode='23503'; end if;
  if existing.deaths is distinct from target_deaths then
    select * into old_movement from public.rearing_movements m where m.daily_record_id=existing.id and m.movement_type='death'
      and not exists(select 1 from public.rearing_movements reversal where reversal.reversal_of=m.id) order by m.created_at desc limit 1 for update;
    if existing.deaths>0 and (old_movement.id is null or old_movement.quantity<>existing.deaths) then raise exception 'Daily mortality ledger integrity check failed; contact support before correcting this record' using errcode='23514'; end if;
    if old_movement.id is not null then
      insert into public.rearing_movements(farm_id,rearing_batch_id,daily_record_id,movement_date,movement_type,direction,quantity,reversal_of,created_by)
      values(b.farm_id,b.id,existing.id,existing.record_date,'reversal','IN',old_movement.quantity,old_movement.id,auth.uid());
      insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
      values(b.farm_id,auth.uid(),'rearing_mortality.reversed','rearing_movements',old_movement.id,'Rearing mortality reversed for correction',jsonb_build_object('batch_code',b.batch_code,'event_date',existing.record_date,'quantity',old_movement.quantity));
    end if;
    available:=public.rearing_balance_at(b.id,target_record_date);
    if target_deaths>available then raise exception 'Deaths exceed birds available on that date' using errcode='23514'; end if;
  end if;
  update public.rearing_daily_records set deaths=target_deaths,observations=nullif(trim(target_observations),''),updated_by=auth.uid() where id=existing.id returning * into r;
  if existing.deaths is distinct from target_deaths and target_deaths>0 then
    insert into public.rearing_movements(farm_id,rearing_batch_id,daily_record_id,movement_date,movement_type,direction,quantity,created_by)
    values(b.farm_id,b.id,r.id,r.record_date,'death','OUT',target_deaths,auth.uid()) returning * into new_movement;
  end if;
  if existing.deaths is distinct from target_deaths then perform public.assert_nonnegative_rearing_history(b.id); end if;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
  values(b.farm_id,auth.uid(),'rearing_daily_record.corrected','rearing_daily_records',r.id,'Rearing daily record corrected',jsonb_build_object('batch_code',b.batch_code,'record_date',r.record_date,'previous_deaths',existing.deaths,'new_deaths',target_deaths));
  return r;
exception when unique_violation then raise exception 'A daily record already exists for this batch and date' using errcode='23505';
end;$$;

revoke all on function public.rearing_balance_at(uuid,date),public.assert_nonnegative_rearing_history(uuid) from public,anon,authenticated;
revoke all on function public.create_rearing_batch(uuid,text,text,uuid,date,date,integer,text),public.update_rearing_batch(uuid,text,uuid,date,date,text),public.change_rearing_batch_stage(uuid,text),public.save_rearing_daily_record(uuid,date,integer,text,uuid) from public,anon;
grant execute on function public.rearing_balance_at(uuid,date) to authenticated;
grant execute on function public.create_rearing_batch(uuid,text,text,uuid,date,date,integer,text),public.update_rearing_batch(uuid,text,uuid,date,date,text),public.change_rearing_batch_stage(uuid,text),public.save_rearing_daily_record(uuid,date,integer,text,uuid) to authenticated;
revoke all on function public.rearing_balance_at(uuid,date),public.assert_nonnegative_rearing_history(uuid),public.create_rearing_batch(uuid,text,text,uuid,date,date,integer,text),public.update_rearing_batch(uuid,text,uuid,date,date,text),public.change_rearing_batch_stage(uuid,text),public.save_rearing_daily_record(uuid,date,integer,text,uuid) from service_role;
grant execute on function public.rearing_balance_at(uuid,date),public.create_rearing_batch(uuid,text,text,uuid,date,date,integer,text),public.update_rearing_batch(uuid,text,uuid,date,date,text),public.change_rearing_batch_stage(uuid,text),public.save_rearing_daily_record(uuid,date,integer,text,uuid) to service_role;

comment on table public.rearing_batches is 'DOC/pullet cohorts remain separate from layer flocks until a future point-of-lay transfer release.';
comment on table public.rearing_movements is 'Authoritative rearing population ledger; opening quantity is posted once as an arrival and corrections use linked reversal movements.';
comment on column public.rearing_batches.stage is 'Farmer-designated operational stage; Ready for Transfer is not veterinary certification and never performs a transfer.';
