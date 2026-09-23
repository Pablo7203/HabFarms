-- Forecast stock runway from the current farm-configured demand for both layer
-- flocks and active DOC batches. Fall back to a calendar-day average of actual
-- consumption only when no usable plan exists for that feed type.
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
cross join lateral (
  select (now() at time zone f.timezone)::date as today
) farm_day
left join lateral (
  select round(coalesce(sum(m.quantity_kg),0)/greatest(coalesce(fs.average_feed_days_window,7),1),3) as average_daily_consumption
  from public.feed_inventory_movements m
  where m.farm_id=ft.farm_id and m.feed_type_id=ft.id
    and m.movement_type='consumption' and m.direction='OUT'
    and m.movement_date between farm_day.today-greatest(coalesce(fs.average_feed_days_window,7),1)+1 and farm_day.today
) actual on true
left join lateral (
  select round(coalesce(sum(plan_rows.daily_kg),0),3) as planned_daily_demand
  from (
    select current_flock.current_live_birds * fp.grams_per_bird_per_day / 1000 as daily_kg
    from (
      select distinct on (p.flock_id) p.flock_id,p.feed_type_id,p.grams_per_bird_per_day
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
