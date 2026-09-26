-- New layer plans accept the daily amount the farm feeds the whole flock.
-- The old RPC remains available during rollout and converts its per-bird input
-- to a total using the flock population on the plan's effective date.
create or replace function public.save_flock_daily_feeding_plan(
  target_flock uuid,
  target_feed_type uuid,
  target_daily_kg numeric,
  target_effective_from date,
  target_notes text default null
) returns public.flock_feeding_plans
language plpgsql security definer set search_path='' as $$
declare
  f uuid;
  result public.flock_feeding_plans;
  v_live_birds numeric;
begin
  f := public.assert_flock_plan_scope(target_flock,target_feed_type);
  if target_daily_kg is null or target_daily_kg<=0 or target_daily_kg>100000 or target_effective_from is null then
    raise exception 'Enter a positive daily feed target and effective date' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_flock::text||':layer-feed-plan',0));
  select fl.initial_birds+coalesce(sum(case when bm.direction='IN' then bm.quantity else -bm.quantity end),0)
  into v_live_birds
  from public.flocks fl
  left join public.bird_movements bm on bm.flock_id=fl.id
    and bm.movement_date<=greatest(target_effective_from,fl.start_date)
  where fl.id=target_flock
  group by fl.id;
  if coalesce(v_live_birds,0)<=0 then
    raise exception 'The flock must have birds on the plan effective date' using errcode='23514';
  end if;

  update public.flock_feeding_plans
  set effective_to=target_effective_from-1,updated_at=now(),updated_by=auth.uid()
  where flock_id=target_flock and effective_to is null and effective_from<target_effective_from;

  insert into public.flock_feeding_plans(
    farm_id,flock_id,feed_type_id,grams_per_bird_per_day,daily_feed_kg,
    effective_from,notes,created_by
  ) values(
    f,target_flock,target_feed_type,
    round(least(target_daily_kg*1000/v_live_birds,99999999.999),3),
    round(target_daily_kg,3),target_effective_from,nullif(trim(target_notes),''),auth.uid()
  )
  on conflict(flock_id,effective_from) do update set
    feed_type_id=excluded.feed_type_id,
    grams_per_bird_per_day=excluded.grams_per_bird_per_day,
    daily_feed_kg=excluded.daily_feed_kg,
    notes=excluded.notes,updated_at=now(),updated_by=auth.uid()
  returning * into result;
  return result;
end; $$;

create or replace function public.save_flock_feeding_plan(
  target_flock uuid,target_feed_type uuid,target_grams numeric,target_effective_from date,target_notes text default null
) returns public.flock_feeding_plans
language plpgsql security definer set search_path='' as $$
declare
  v_live_birds numeric;
  v_daily_kg numeric;
begin
  perform public.assert_flock_plan_scope(target_flock,target_feed_type);
  if target_grams is null or target_grams<=0 or target_grams>1000 or target_effective_from is null then
    raise exception 'Invalid legacy per-bird feed target' using errcode='22023';
  end if;
  select fl.initial_birds+coalesce(sum(case when bm.direction='IN' then bm.quantity else -bm.quantity end),0)
  into v_live_birds
  from public.flocks fl
  left join public.bird_movements bm on bm.flock_id=fl.id
    and bm.movement_date<=greatest(target_effective_from,fl.start_date)
  where fl.id=target_flock
  group by fl.id;
  v_daily_kg:=round(target_grams*v_live_birds/1000,3);
  return public.save_flock_daily_feeding_plan(target_flock,target_feed_type,v_daily_kg,target_effective_from,target_notes);
end; $$;

revoke all on function public.save_flock_daily_feeding_plan(uuid,uuid,numeric,date,text) from public,anon;
grant execute on function public.save_flock_daily_feeding_plan(uuid,uuid,numeric,date,text) to authenticated;
revoke all on function public.save_flock_feeding_plan(uuid,uuid,numeric,date,text) from public,anon;
grant execute on function public.save_flock_feeding_plan(uuid,uuid,numeric,date,text) to authenticated;
