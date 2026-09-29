create table public.flock_feed_consumptions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  flock_id uuid not null references public.flocks(id) on delete restrict,
  feed_type_id uuid not null references public.feed_types(id) on delete restrict,
  movement_id uuid not null unique references public.feed_inventory_movements(id) on delete restrict,
  consumption_date date not null,
  quantity_kg numeric(14,3) not null check (quantity_kg > 0),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  unique (farm_id, flock_id, consumption_date)
);

create index flock_feed_consumptions_farm_date_idx
  on public.flock_feed_consumptions(farm_id, consumption_date desc);

alter table public.flock_feed_consumptions enable row level security;
create policy flock_feed_consumptions_read_members on public.flock_feed_consumptions
  for select to authenticated using (public.is_farm_member(farm_id));
grant select on public.flock_feed_consumptions to authenticated;
grant all on public.flock_feed_consumptions to service_role;

create or replace function public.guard_daily_flock_feed_consumption()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.movement_type <> 'consumption' or new.direction <> 'OUT' or new.flock_id is null then
    return new;
  end if;

  -- Serialize feed writes for this flock before checking the cross-path invariant.
  perform 1 from public.flocks where id = new.flock_id and farm_id = new.farm_id for update;
  if not found then
    raise exception 'Flock does not belong to this farm' using errcode='23503';
  end if;

  if exists (
    select 1 from public.feed_inventory_movements m
    where m.farm_id = new.farm_id and m.flock_id = new.flock_id
      and m.movement_date = new.movement_date
      and m.movement_type = 'consumption' and m.direction = 'OUT'
      and m.id <> new.id
  ) then
    raise exception 'Feed has already been recorded for this flock on this date. Update the existing entry instead.'
      using errcode='23505', constraint='one_flock_feed_consumption_per_day';
  end if;
  return new;
end;
$$;

create trigger feed_movement_one_daily_flock_consumption
  before insert or update of farm_id, flock_id, movement_date, movement_type, direction
  on public.feed_inventory_movements
  for each row execute function public.guard_daily_flock_feed_consumption();

create or replace function public.create_flock_feed_consumption(
  target_flock uuid, target_feed_type uuid, target_date date, target_quantity_kg numeric, target_notes text default null
) returns public.flock_feed_consumptions
language plpgsql security definer set search_path=''
as $$
declare f uuid; role_name text; today date; record_id uuid := gen_random_uuid(); movement_id uuid := gen_random_uuid(); result public.flock_feed_consumptions; unit_cost numeric;
begin
  f := public.resolve_selected_farm(array['admin','manager','worker']);
  select fm.role, (now() at time zone fa.timezone)::date into role_name, today
    from public.farm_members fm join public.farms fa on fa.id=fm.farm_id
    where fm.farm_id=f and fm.user_id=auth.uid() and fm.active;
  if target_date > today or (role_name='worker' and target_date <> today) then
    raise exception 'Workers can record feed use for today only; managers may backdate entries.' using errcode='42501';
  end if;
  if target_quantity_kg is null or target_quantity_kg <= 0 then
    raise exception 'Feed quantity must be greater than zero' using errcode='22023';
  end if;
  if not exists(select 1 from public.flocks where id=target_flock and farm_id=f and status='active') then
    raise exception 'Choose an active flock from this farm' using errcode='23503';
  end if;
  if not exists(select 1 from public.feed_types where id=target_feed_type and farm_id=f and active) then
    raise exception 'Choose an active feed type from this farm' using errcode='23503';
  end if;
  select weighted_average_cost into unit_cost from public.feed_inventory_balances where farm_id=f and feed_type_id=target_feed_type;
  insert into public.feed_inventory_movements(id,farm_id,flock_id,feed_type_id,movement_date,movement_type,direction,quantity_kg,unit_cost_snapshot,total_cost_snapshot,source_type,source_id,notes,created_by)
    values(movement_id,f,target_flock,target_feed_type,target_date,'consumption','OUT',round(target_quantity_kg,3),coalesce(unit_cost,0),round(round(target_quantity_kg,3)*coalesce(unit_cost,0),2),'flock_feed_consumption',record_id,nullif(trim(target_notes),''),auth.uid());
  insert into public.flock_feed_consumptions(id,farm_id,flock_id,feed_type_id,movement_id,consumption_date,quantity_kg,notes,created_by)
    values(record_id,f,target_flock,target_feed_type,movement_id,target_date,round(target_quantity_kg,3),nullif(trim(target_notes),''),auth.uid()) returning * into result;
  perform public.recalculate_feed_ledger(f,target_feed_type);
  return result;
end;
$$;

create or replace function public.update_flock_feed_consumption(
  target_consumption uuid, target_feed_type uuid, target_quantity_kg numeric, target_notes text default null
) returns public.flock_feed_consumptions
language plpgsql security definer set search_path=''
as $$
declare f uuid; old public.flock_feed_consumptions; unit_cost numeric; result public.flock_feed_consumptions;
begin
  f := public.resolve_selected_farm(array['admin','manager']);
  select * into old from public.flock_feed_consumptions where id=target_consumption and farm_id=f for update;
  if old.id is null then raise exception 'Feed-use entry not found' using errcode='P0002'; end if;
  if target_quantity_kg is null or target_quantity_kg <= 0 then raise exception 'Feed quantity must be greater than zero' using errcode='22023'; end if;
  if not exists(select 1 from public.feed_types where id=target_feed_type and farm_id=f and active) then raise exception 'Choose an active feed type from this farm' using errcode='23503'; end if;
  select weighted_average_cost into unit_cost from public.feed_inventory_balances where farm_id=f and feed_type_id=target_feed_type;
  update public.feed_inventory_movements set feed_type_id=target_feed_type,quantity_kg=round(target_quantity_kg,3),unit_cost_snapshot=coalesce(unit_cost,0),total_cost_snapshot=round(round(target_quantity_kg,3)*coalesce(unit_cost,0),2),notes=nullif(trim(target_notes),''),created_by=auth.uid()
    where id=old.movement_id and farm_id=f;
  update public.flock_feed_consumptions set feed_type_id=target_feed_type,quantity_kg=round(target_quantity_kg,3),notes=nullif(trim(target_notes),''),updated_at=now(),updated_by=auth.uid()
    where id=old.id returning * into result;
  perform public.recalculate_feed_ledger(f,old.feed_type_id);
  if target_feed_type <> old.feed_type_id then perform public.recalculate_feed_ledger(f,target_feed_type); end if;
  return result;
end;
$$;

revoke all on function public.guard_daily_flock_feed_consumption() from public, anon, authenticated;
revoke all on function public.create_flock_feed_consumption(uuid,uuid,date,numeric,text) from public, anon;
revoke all on function public.update_flock_feed_consumption(uuid,uuid,numeric,text) from public, anon;
grant execute on function public.create_flock_feed_consumption(uuid,uuid,date,numeric,text) to authenticated;
grant execute on function public.update_flock_feed_consumption(uuid,uuid,numeric,text) to authenticated;
