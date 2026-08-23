create table public.flocks (
  id uuid primary key default gen_random_uuid(), farm_id uuid not null references public.farms(id) on delete cascade,
  flock_name text not null check (char_length(trim(flock_name)) between 2 and 120), batch_reference text, breed text, house_pen text,
  start_date date not null, initial_birds integer not null check (initial_birds > 0), age_at_arrival_weeks integer check (age_at_arrival_weeks >= 0),
  source text, status text not null default 'active' check (status in ('active','closed','sold','culled')), notes text,
  created_at timestamptz not null default now(), created_by uuid not null references public.profiles(id), updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id)
);
create table public.daily_production_records (
  id uuid primary key default gen_random_uuid(), farm_id uuid not null references public.farms(id) on delete cascade, flock_id uuid not null references public.flocks(id) on delete restrict,
  production_date date not null, eggs_collected integer not null default 0 check (eggs_collected >= 0), cracked_eggs integer not null default 0 check (cracked_eggs >= 0 and cracked_eggs <= eggs_collected),
  deaths integer not null default 0 check (deaths >= 0), culls integer not null default 0 check (culls >= 0), feed_consumed_kg numeric(14,3) not null default 0 check (feed_consumed_kg >= 0),
  transport_cost numeric(14,2) not null default 0 check (transport_cost >= 0), other_cost numeric(14,2) not null default 0 check (other_cost >= 0), notes text,
  created_at timestamptz not null default now(), created_by uuid not null references public.profiles(id), updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id),
  unique(farm_id,flock_id,production_date)
);
create table public.bird_movements (
  id uuid primary key default gen_random_uuid(), farm_id uuid not null references public.farms(id) on delete cascade, flock_id uuid not null references public.flocks(id) on delete restrict,
  movement_date date not null, movement_type text not null check (movement_type in ('addition','death','cull','bird_sale','transfer_in','transfer_out','adjustment')),
  quantity integer not null check (quantity > 0), direction text not null check (direction in ('IN','OUT')), source_type text, source_id uuid, notes text,
  created_at timestamptz not null default now(), created_by uuid not null references public.profiles(id),
  constraint valid_bird_movement_direction check ((movement_type in ('addition','transfer_in') and direction='IN') or (movement_type in ('death','cull','bird_sale','transfer_out') and direction='OUT') or movement_type='adjustment')
);
create table public.egg_inventory_movements (
  id uuid primary key default gen_random_uuid(), farm_id uuid not null references public.farms(id) on delete cascade, movement_date date not null,
  movement_type text not null check (movement_type in ('production','adjustment','sale','breakage','spoilage','giveaway','internal_use')),
  direction text not null check (direction in ('IN','OUT')), quantity_eggs integer not null check (quantity_eggs >= 0), source_type text, source_id uuid, notes text,
  created_at timestamptz not null default now(), created_by uuid not null references public.profiles(id),
  constraint valid_production_egg_direction check (movement_type <> 'production' or direction='IN')
);
create table public.feed_inventory_movements (
  id uuid primary key default gen_random_uuid(), farm_id uuid not null references public.farms(id) on delete cascade, flock_id uuid references public.flocks(id) on delete restrict,
  movement_date date not null, movement_type text not null check (movement_type in ('consumption')),
  direction text not null check (direction='OUT'), quantity_kg numeric(14,3) not null check (quantity_kg > 0), unit_cost_snapshot numeric(14,4), total_cost_snapshot numeric(14,2),
  source_type text, source_id uuid, notes text, created_at timestamptz not null default now(), created_by uuid not null references public.profiles(id)
);

create index flocks_farm_status_idx on public.flocks(farm_id,status);
create index bird_movements_flock_date_idx on public.bird_movements(flock_id,movement_date,created_at);
create index production_farm_date_idx on public.daily_production_records(farm_id,production_date desc);
create index egg_movements_farm_date_idx on public.egg_inventory_movements(farm_id,movement_date desc);
create index feed_movements_farm_date_idx on public.feed_inventory_movements(farm_id,movement_date desc);
create unique index egg_generated_source_uidx on public.egg_inventory_movements(source_type,source_id,movement_type) where source_id is not null;
create unique index feed_generated_source_uidx on public.feed_inventory_movements(source_type,source_id,movement_type) where source_id is not null;
create unique index bird_generated_source_uidx on public.bird_movements(source_type,source_id,movement_type) where source_id is not null;
create trigger flocks_updated_at before update on public.flocks for each row execute function public.set_updated_at();
create trigger production_updated_at before update on public.daily_production_records for each row execute function public.set_updated_at();

create function public.has_farm_role(target_farm_id uuid, allowed_roles text[]) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.farm_members where farm_id=target_farm_id and user_id=auth.uid() and active and role=any(allowed_roles));
$$;
create function public.flock_balance_at(target_flock_id uuid, as_of_date date default null) returns integer language sql stable security definer set search_path='' as $$
  select f.initial_birds + coalesce(sum(case when bm.direction='IN' then bm.quantity else -bm.quantity end) filter (where as_of_date is null or bm.movement_date<=as_of_date),0)::integer
  from public.flocks f left join public.bird_movements bm on bm.flock_id=f.id where f.id=target_flock_id group by f.id;
$$;
create function public.assert_nonnegative_flock_history(target_flock_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare minimum_balance integer;
begin
  select min(balance) into minimum_balance from (
    select f.initial_birds + sum(case when bm.direction='IN' then bm.quantity else -bm.quantity end) over(order by bm.movement_date,bm.created_at,bm.id) balance
    from public.flocks f join public.bird_movements bm on bm.flock_id=f.id where f.id=target_flock_id
  ) balances;
  if coalesce(minimum_balance,0)<0 then raise exception 'Bird movement would make flock population negative' using errcode='23514'; end if;
end; $$;

create function public.create_flock(flock_name text,batch_reference text,breed text,house_pen text,start_date date,initial_birds integer,age_at_arrival_weeks integer,source text,notes text) returns public.flocks language plpgsql security definer set search_path='' as $$
declare target_farm uuid; created public.flocks;
begin
  select farm_id into target_farm from public.farm_members where user_id=auth.uid() and active and role in ('admin','manager') order by created_at limit 1;
  if target_farm is null then raise exception 'Admin or manager access required' using errcode='42501'; end if;
  insert into public.flocks(farm_id,flock_name,batch_reference,breed,house_pen,start_date,initial_birds,age_at_arrival_weeks,source,notes,created_by)
  values(target_farm,trim(flock_name),nullif(trim(batch_reference),''),nullif(trim(breed),''),nullif(trim(house_pen),''),start_date,initial_birds,age_at_arrival_weeks,nullif(trim(source),''),nullif(trim(notes),''),auth.uid()) returning * into created;
  return created;
end; $$;
create function public.update_flock(target_flock_id uuid,flock_name text,batch_reference text,breed text,house_pen text,start_date date,age_at_arrival_weeks integer,source text,status text,notes text) returns public.flocks language plpgsql security definer set search_path='' as $$
declare target_farm uuid; updated public.flocks;
begin
  select farm_id into target_farm from public.flocks where id=target_flock_id for update;
  if target_farm is null or not public.has_farm_role(target_farm,array['admin','manager']) then raise exception 'Flock access denied' using errcode='42501'; end if;
  update public.flocks set flock_name=trim(update_flock.flock_name),batch_reference=nullif(trim(update_flock.batch_reference),''),breed=nullif(trim(update_flock.breed),''),house_pen=nullif(trim(update_flock.house_pen),''),start_date=update_flock.start_date,age_at_arrival_weeks=update_flock.age_at_arrival_weeks,source=nullif(trim(update_flock.source),''),status=update_flock.status,notes=nullif(trim(update_flock.notes),''),updated_by=auth.uid() where id=target_flock_id returning * into updated;
  return updated;
end; $$;
create function public.create_bird_movement(target_flock_id uuid,movement_date date,movement_type text,quantity integer,direction text,notes text default null) returns public.bird_movements language plpgsql security definer set search_path='' as $$
declare target_farm uuid; created public.bird_movements;
begin
  select farm_id into target_farm from public.flocks where id=target_flock_id for update;
  if target_farm is null or not public.has_farm_role(target_farm,array['admin','manager']) then raise exception 'Bird movement access denied' using errcode='42501'; end if;
  insert into public.bird_movements(farm_id,flock_id,movement_date,movement_type,quantity,direction,notes,created_by) values(target_farm,target_flock_id,movement_date,movement_type,quantity,upper(direction),nullif(trim(notes),''),auth.uid()) returning * into created;
  perform public.assert_nonnegative_flock_history(target_flock_id); return created;
end; $$;

create function public.create_daily_production(target_flock_id uuid,production_date date,eggs_collected integer,cracked_eggs integer,deaths integer,culls integer,feed_consumed_kg numeric,transport_cost numeric,other_cost numeric,notes text default null) returns public.daily_production_records language plpgsql security definer set search_path='' as $$
declare target_farm uuid; flock_status text; member_role text; farm_timezone text; available integer; created public.daily_production_records;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select f.farm_id,f.status,fa.timezone into target_farm,flock_status,farm_timezone from public.flocks f join public.farms fa on fa.id=f.farm_id where f.id=target_flock_id for update of f;
  select role into member_role from public.farm_members where farm_id=target_farm and user_id=auth.uid() and active;
  if member_role is null then raise exception 'Production access denied' using errcode='42501'; end if;
  if flock_status<>'active' then raise exception 'This flock is closed and cannot receive production records' using errcode='22023'; end if;
  if member_role='worker' and production_date<>(now() at time zone farm_timezone)::date then raise exception 'Workers may record production only for the current farm date' using errcode='42501'; end if;
  available:=public.flock_balance_at(target_flock_id,production_date);
  if deaths+culls>available then raise exception 'Deaths and culls cannot exceed available live birds' using errcode='23514'; end if;
  insert into public.daily_production_records(farm_id,flock_id,production_date,eggs_collected,cracked_eggs,deaths,culls,feed_consumed_kg,transport_cost,other_cost,notes,created_by)
  values(target_farm,target_flock_id,production_date,eggs_collected,cracked_eggs,deaths,culls,feed_consumed_kg,transport_cost,other_cost,nullif(trim(notes),''),auth.uid()) returning * into created;
  insert into public.egg_inventory_movements(farm_id,movement_date,movement_type,direction,quantity_eggs,source_type,source_id,created_by) values(target_farm,production_date,'production','IN',eggs_collected-cracked_eggs,'daily_production',created.id,auth.uid());
  if feed_consumed_kg>0 then insert into public.feed_inventory_movements(farm_id,flock_id,movement_date,movement_type,direction,quantity_kg,source_type,source_id,created_by) values(target_farm,target_flock_id,production_date,'consumption','OUT',feed_consumed_kg,'daily_production',created.id,auth.uid()); end if;
  if deaths>0 then insert into public.bird_movements(farm_id,flock_id,movement_date,movement_type,quantity,direction,source_type,source_id,created_by) values(target_farm,target_flock_id,production_date,'death',deaths,'OUT','daily_production',created.id,auth.uid()); end if;
  if culls>0 then insert into public.bird_movements(farm_id,flock_id,movement_date,movement_type,quantity,direction,source_type,source_id,created_by) values(target_farm,target_flock_id,production_date,'cull',culls,'OUT','daily_production',created.id,auth.uid()); end if;
  perform public.assert_nonnegative_flock_history(target_flock_id); return created;
exception when unique_violation then raise exception 'A production record already exists for this flock on this date' using errcode='23505';
end; $$;

create function public.update_daily_production(target_production_id uuid,eggs_collected integer,cracked_eggs integer,deaths integer,culls integer,feed_consumed_kg numeric,transport_cost numeric,other_cost numeric,notes text default null) returns public.daily_production_records language plpgsql security definer set search_path='' as $$
declare existing public.daily_production_records; updated public.daily_production_records;
begin
  select * into existing from public.daily_production_records where id=target_production_id for update;
  if existing.id is null or not public.has_farm_role(existing.farm_id,array['admin','manager']) then raise exception 'Production edit access denied' using errcode='42501'; end if;
  delete from public.bird_movements where source_type='daily_production' and source_id=existing.id and movement_type in ('death','cull');
  update public.daily_production_records set eggs_collected=update_daily_production.eggs_collected,cracked_eggs=update_daily_production.cracked_eggs,deaths=update_daily_production.deaths,culls=update_daily_production.culls,feed_consumed_kg=update_daily_production.feed_consumed_kg,transport_cost=update_daily_production.transport_cost,other_cost=update_daily_production.other_cost,notes=nullif(trim(update_daily_production.notes),''),updated_by=auth.uid() where id=existing.id returning * into updated;
  update public.egg_inventory_movements set quantity_eggs=eggs_collected-cracked_eggs,movement_date=existing.production_date where source_type='daily_production' and source_id=existing.id and movement_type='production';
  if feed_consumed_kg>0 then insert into public.feed_inventory_movements(farm_id,flock_id,movement_date,movement_type,direction,quantity_kg,source_type,source_id,created_by) values(existing.farm_id,existing.flock_id,existing.production_date,'consumption','OUT',feed_consumed_kg,'daily_production',existing.id,auth.uid()) on conflict(source_type,source_id,movement_type) where source_id is not null do update set quantity_kg=excluded.quantity_kg; else delete from public.feed_inventory_movements where source_type='daily_production' and source_id=existing.id and movement_type='consumption'; end if;
  if deaths>0 then insert into public.bird_movements(farm_id,flock_id,movement_date,movement_type,quantity,direction,source_type,source_id,created_by) values(existing.farm_id,existing.flock_id,existing.production_date,'death',deaths,'OUT','daily_production',existing.id,auth.uid()); end if;
  if culls>0 then insert into public.bird_movements(farm_id,flock_id,movement_date,movement_type,quantity,direction,source_type,source_id,created_by) values(existing.farm_id,existing.flock_id,existing.production_date,'cull',culls,'OUT','daily_production',existing.id,auth.uid()); end if;
  perform public.assert_nonnegative_flock_history(existing.flock_id); return updated;
end; $$;
create function public.delete_daily_production(target_production_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare existing public.daily_production_records;
begin
  select * into existing from public.daily_production_records where id=target_production_id for update;
  if existing.id is null or not public.has_farm_role(existing.farm_id,array['admin']) then raise exception 'Admin access required' using errcode='42501'; end if;
  delete from public.bird_movements where source_type='daily_production' and source_id=existing.id;
  delete from public.egg_inventory_movements where source_type='daily_production' and source_id=existing.id;
  delete from public.feed_inventory_movements where source_type='daily_production' and source_id=existing.id;
  delete from public.daily_production_records where id=existing.id;
end; $$;

create view public.v_current_flock_status with (security_invoker=true) as select f.id flock_id,f.farm_id,f.flock_name,f.initial_birds,coalesce(sum(b.quantity) filter(where b.direction='IN'),0)::integer total_in,coalesce(sum(b.quantity) filter(where b.direction='OUT'),0)::integer total_out,(f.initial_birds+coalesce(sum(case when b.direction='IN' then b.quantity else -b.quantity end),0))::integer current_live_birds,f.status from public.flocks f left join public.bird_movements b on b.flock_id=f.id group by f.id;
create view public.v_current_egg_inventory with (security_invoker=true) as select f.id farm_id,coalesce(sum(case when e.direction='IN' then e.quantity_eggs else -e.quantity_eggs end),0)::bigint current_eggs from public.farms f left join public.egg_inventory_movements e on e.farm_id=f.id group by f.id;
create view public.v_daily_production_metrics with (security_invoker=true) as select p.id production_id,p.farm_id,p.flock_id,p.production_date,p.eggs_collected,p.cracked_eggs,(p.eggs_collected-p.cracked_eggs) good_eggs,
  (f.initial_birds+coalesce((select sum(case when b.direction='IN' then b.quantity else -b.quantity end) from public.bird_movements b where b.flock_id=p.flock_id and b.movement_date<=p.production_date and not(b.source_type='daily_production' and b.source_id=p.id)),0))::integer live_birds,
  case when (f.initial_birds+coalesce((select sum(case when b.direction='IN' then b.quantity else -b.quantity end) from public.bird_movements b where b.flock_id=p.flock_id and b.movement_date<=p.production_date and not(b.source_type='daily_production' and b.source_id=p.id)),0))>0 then round(p.eggs_collected::numeric/(f.initial_birds+coalesce((select sum(case when b.direction='IN' then b.quantity else -b.quantity end) from public.bird_movements b where b.flock_id=p.flock_id and b.movement_date<=p.production_date and not(b.source_type='daily_production' and b.source_id=p.id)),0))*100,2) end hen_day_percentage,
  case when p.eggs_collected=0 then 0 else round(p.cracked_eggs::numeric/p.eggs_collected*100,2) end cracked_percentage,p.feed_consumed_kg,
  case when (f.initial_birds+coalesce((select sum(case when b.direction='IN' then b.quantity else -b.quantity end) from public.bird_movements b where b.flock_id=p.flock_id and b.movement_date<=p.production_date and not(b.source_type='daily_production' and b.source_id=p.id)),0))>0 then round(p.feed_consumed_kg/(f.initial_birds+coalesce((select sum(case when b.direction='IN' then b.quantity else -b.quantity end) from public.bird_movements b where b.flock_id=p.flock_id and b.movement_date<=p.production_date and not(b.source_type='daily_production' and b.source_id=p.id)),0)),6) end feed_per_bird,
  case when p.eggs_collected>0 then round(p.feed_consumed_kg/p.eggs_collected,6) end feed_per_egg,p.deaths,p.culls,p.transport_cost,p.other_cost,p.notes,p.created_at,p.updated_at
  from public.daily_production_records p join public.flocks f on f.id=p.flock_id;

alter table public.flocks enable row level security; alter table public.bird_movements enable row level security; alter table public.daily_production_records enable row level security; alter table public.egg_inventory_movements enable row level security; alter table public.feed_inventory_movements enable row level security;
create policy flocks_read_members on public.flocks for select to authenticated using(public.is_farm_member(farm_id));
create policy bird_movements_read_members on public.bird_movements for select to authenticated using(public.is_farm_member(farm_id));
create policy production_read_members on public.daily_production_records for select to authenticated using(public.is_farm_member(farm_id));
create policy egg_movements_read_members on public.egg_inventory_movements for select to authenticated using(public.is_farm_member(farm_id));
create policy feed_movements_read_members on public.feed_inventory_movements for select to authenticated using(public.is_farm_member(farm_id));
grant select on public.flocks,public.bird_movements,public.daily_production_records,public.egg_inventory_movements,public.feed_inventory_movements,public.v_current_flock_status,public.v_current_egg_inventory,public.v_daily_production_metrics to authenticated;
grant all on public.flocks,public.bird_movements,public.daily_production_records,public.egg_inventory_movements,public.feed_inventory_movements to service_role;
grant select on public.v_current_flock_status,public.v_current_egg_inventory,public.v_daily_production_metrics to service_role;
revoke all on function public.has_farm_role(uuid,text[]) from public; revoke all on function public.flock_balance_at(uuid,date) from public; revoke all on function public.assert_nonnegative_flock_history(uuid) from public;
revoke all on function public.create_flock(text,text,text,text,date,integer,integer,text,text) from public; grant execute on function public.create_flock(text,text,text,text,date,integer,integer,text,text) to authenticated;
revoke all on function public.update_flock(uuid,text,text,text,text,date,integer,text,text,text) from public; grant execute on function public.update_flock(uuid,text,text,text,text,date,integer,text,text,text) to authenticated;
revoke all on function public.create_bird_movement(uuid,date,text,integer,text,text) from public; grant execute on function public.create_bird_movement(uuid,date,text,integer,text,text) to authenticated;
revoke all on function public.create_daily_production(uuid,date,integer,integer,integer,integer,numeric,numeric,numeric,text) from public; grant execute on function public.create_daily_production(uuid,date,integer,integer,integer,integer,numeric,numeric,numeric,text) to authenticated;
revoke all on function public.update_daily_production(uuid,integer,integer,integer,integer,numeric,numeric,numeric,text) from public; grant execute on function public.update_daily_production(uuid,integer,integer,integer,integer,numeric,numeric,numeric,text) to authenticated;
revoke all on function public.delete_daily_production(uuid) from public; grant execute on function public.delete_daily_production(uuid) to authenticated;
comment on view public.v_daily_production_metrics is 'Hen-day and feed-per-bird use flock population on the production date before that record''s deaths and culls; cracked percentage is zero when no eggs are collected.';
