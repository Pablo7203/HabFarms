-- All existing plan rows now have their prior target backfilled. New plans use
-- an explicit daily total; retain the per-bird column only for old clients.
alter table public.flock_feeding_plans
  alter column daily_feed_kg set not null;
alter table public.flock_feeding_plans
  add constraint flock_feeding_plans_daily_feed_kg_check
  check (daily_feed_kg>=0 and daily_feed_kg<=100000) not valid;
alter table public.flock_feeding_plans
  validate constraint flock_feeding_plans_daily_feed_kg_check;
alter table public.flock_feeding_plans
  drop constraint if exists flock_feeding_plans_grams_per_bird_per_day_check;

create or replace view public.v_flock_feed_plan_daily with(security_invoker=true) as
select p.farm_id,p.flock_id,p.feed_type_id,p.effective_from,p.effective_to,p.grams_per_bird_per_day,
  (fl.initial_birds+coalesce((select sum(case when bm.direction='IN' then bm.quantity else -bm.quantity end) from public.bird_movements bm where bm.flock_id=fl.id and bm.movement_date<=greatest(p.effective_from,fl.start_date)),0))::integer live_birds_at_effective_from,
  round(p.daily_feed_kg,3) target_kg_per_day
from public.flock_feeding_plans p join public.flocks fl on fl.id=p.flock_id;

create or replace function public.get_feed_plan_summary(start_date date,end_date date,target_flock uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f uuid; result jsonb;
begin
  select farm_id into f from public.farm_members where user_id=auth.uid() and active order by created_at limit 1;
  if f is null or start_date is null or end_date is null or start_date>end_date
    or (target_flock is not null and not exists(select 1 from public.flocks where id=target_flock and farm_id=f)) then
    raise exception 'Feed plan summary access denied' using errcode='42501';
  end if;
  with days as(
    select generate_series(start_date,end_date,'1 day'::interval)::date report_day
  ), planned as(
    select d.report_day,fl.id flock_id,fp.daily_feed_kg target_kg
    from days d join public.flocks fl on fl.farm_id=f and fl.start_date<=d.report_day
      and (target_flock is null or fl.id=target_flock)
    join lateral(
      select p.* from public.flock_feeding_plans p
      where p.flock_id=fl.id and p.effective_from<=d.report_day
        and (p.effective_to is null or p.effective_to>=d.report_day)
      order by p.effective_from desc limit 1
    ) fp on true
  ), actual as(
    select movement_date report_day,sum(quantity_kg) actual_kg
    from public.feed_inventory_movements
    where farm_id=f and movement_type='consumption' and movement_date between start_date and end_date
      and (target_flock is null or flock_id=target_flock)
    group by movement_date
  )
  select jsonb_build_object(
    'configured',exists(select 1 from planned),
    'target_kg',coalesce((select sum(target_kg) from planned),0),
    'actual_kg',coalesce((select sum(actual_kg) from actual),0),
    'variance_kg',coalesce((select sum(actual_kg) from actual),0)-coalesce((select sum(target_kg) from planned),0),
    'variance_percentage',case when coalesce((select sum(target_kg) from planned),0)=0 then null
      else round((coalesce((select sum(actual_kg) from actual),0)-coalesce((select sum(target_kg) from planned),0))
        /nullif((select sum(target_kg) from planned),0)*100,2) end
  ) into result;
  return result;
end; $$;
revoke all on function public.get_feed_plan_summary(date,date,uuid) from public,anon;
grant execute on function public.get_feed_plan_summary(date,date,uuid) to authenticated;

-- Use the configured total kg/day for layer flocks. Rearing batches continue
-- using their separate age-based grams-per-bird plans.
create or replace view public.v_feed_forecast with (security_invoker=true) as
select
  ft.farm_id,
  ft.id as feed_type_id,
  ft.name as feed_type_name,
  coalesce(b.quantity_kg,0) as quantity_kg,
  round(coalesce(b.quantity_kg,0)/ft.default_bag_size_kg,3) as bag_equivalent,
  coalesce(b.inventory_value,0) as inventory_value,
  coalesce(b.weighted_average_cost,0) as weighted_average_cost,
  coalesce(actual.average_daily_consumption,0) as average_daily_consumption,
  case when coalesce(demand.planned_daily_demand,0)>0
    then round(coalesce(b.quantity_kg,0)/demand.planned_daily_demand,2)
    when coalesce(actual.average_daily_consumption,0)>0
    then round(coalesce(b.quantity_kg,0)/actual.average_daily_consumption,2)
  end as days_remaining,
  case when coalesce(demand.planned_daily_demand,0)>0
    then (farm_day.today + floor(coalesce(b.quantity_kg,0)/demand.planned_daily_demand)::integer)
    when coalesce(actual.average_daily_consumption,0)>0
    then (farm_day.today + floor(coalesce(b.quantity_kg,0)/actual.average_daily_consumption)::integer)
  end as estimated_finish_date,
  case
    when coalesce(b.quantity_kg,0)<=0 then 'out_of_stock'
    when coalesce(demand.planned_daily_demand,0)>0 and coalesce(b.quantity_kg,0)/demand.planned_daily_demand<=fs.feed_alert_critical_days then 'critical'
    when coalesce(demand.planned_daily_demand,0)>0 and coalesce(b.quantity_kg,0)/demand.planned_daily_demand<=fs.feed_alert_warning_days then 'warning'
    when coalesce(demand.planned_daily_demand,0)>0 then 'healthy'
    when coalesce(actual.average_daily_consumption,0)=0 then 'unknown'
    when coalesce(b.quantity_kg,0)/actual.average_daily_consumption<=fs.feed_alert_critical_days then 'critical'
    when coalesce(b.quantity_kg,0)/actual.average_daily_consumption<=fs.feed_alert_warning_days then 'warning'
    else 'healthy'
  end as alert_level,
  coalesce(demand.planned_daily_demand,0) as planned_daily_demand,
  case
    when coalesce(demand.planned_daily_demand,0)>0 then 'configured_plan'
    when coalesce(actual.average_daily_consumption,0)>0 then 'recent_actual'
    else 'not_configured'
  end as forecast_basis
from public.feed_types ft
join public.farms f on f.id=ft.farm_id
join public.farm_settings fs on fs.farm_id=ft.farm_id
left join public.feed_inventory_balances b on b.feed_type_id=ft.id
cross join lateral (select (now() at time zone f.timezone)::date as today) farm_day
left join lateral (
  select round(coalesce(sum(case when m.direction='OUT' then m.quantity_kg else -m.quantity_kg end),0)
    /greatest(coalesce(fs.average_feed_days_window,7),1),3) as average_daily_consumption
  from public.feed_inventory_movements m
  where m.farm_id=ft.farm_id and m.feed_type_id=ft.id
    and m.movement_type in ('consumption','consumption_reversal')
    and m.movement_date between farm_day.today-greatest(coalesce(fs.average_feed_days_window,7),1)+1 and farm_day.today
) actual on true
left join lateral (
  select round(coalesce(sum(plan_rows.daily_kg),0),3) as planned_daily_demand
  from (
    select fp.daily_feed_kg as daily_kg
    from (
      select distinct on (p.flock_id) p.flock_id,p.feed_type_id,p.daily_feed_kg
      from public.flock_feeding_plans p
      where p.farm_id=ft.farm_id and p.feed_type_id=ft.id
        and p.effective_from<=farm_day.today and (p.effective_to is null or p.effective_to>=farm_day.today)
      order by p.flock_id,p.effective_from desc
    ) fp
    join public.v_current_flock_status current_flock on current_flock.flock_id=fp.flock_id
      and current_flock.farm_id=ft.farm_id and current_flock.status='active' and current_flock.current_live_birds>0
    union all
    select current_batch.current_birds * rp.grams_per_bird_per_day / 1000 as daily_kg
    from (
      select distinct on (p.rearing_batch_id) p.rearing_batch_id,p.feed_type_id,p.grams_per_bird_per_day
      from public.rearing_feed_plans p
      where p.farm_id=ft.farm_id and p.feed_type_id=ft.id
        and p.effective_from<=farm_day.today and (p.effective_to is null or p.effective_to>=farm_day.today)
      order by p.rearing_batch_id,p.effective_from desc
    ) rp
    join public.v_rearing_population current_batch on current_batch.batch_id=rp.rearing_batch_id
      and current_batch.farm_id=ft.farm_id and current_batch.status in ('active','partially_transferred')
      and current_batch.current_birds>0
  ) plan_rows
) demand on true
where ft.active;

grant select on public.v_feed_forecast to authenticated,service_role;
