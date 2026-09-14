-- Date-correct configured feed targets for daily and weekly summaries.
create or replace function public.get_feed_plan_summary(start_date date,end_date date,target_flock uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f uuid; result jsonb; begin
  select farm_id into f from public.farm_members where user_id=auth.uid() and active order by created_at limit 1;
  if f is null or start_date is null or end_date is null or start_date>end_date or (target_flock is not null and not exists(select 1 from public.flocks where id=target_flock and farm_id=f)) then raise exception 'Feed plan summary access denied' using errcode='42501'; end if;
  with days as(select generate_series(start_date,end_date,'1 day'::interval)::date report_day), planned as(
    select d.report_day,fl.id flock_id,round(public.flock_balance_at(fl.id,d.report_day-1)*fp.grams_per_bird_per_day/1000,3) target_kg
    from days d join public.flocks fl on fl.farm_id=f and fl.start_date<=d.report_day and (target_flock is null or fl.id=target_flock)
    join lateral(select p.* from public.flock_feeding_plans p where p.flock_id=fl.id and p.effective_from<=d.report_day and (p.effective_to is null or p.effective_to>=d.report_day) order by p.effective_from desc limit 1) fp on true
  ), actual as(select movement_date report_day,sum(quantity_kg) actual_kg from public.feed_inventory_movements where farm_id=f and movement_type='consumption' and movement_date between start_date and end_date and (target_flock is null or flock_id=target_flock) group by movement_date)
  select jsonb_build_object('configured',exists(select 1 from planned),'target_kg',coalesce((select sum(target_kg) from planned),0),'actual_kg',coalesce((select sum(actual_kg) from actual),0),'variance_kg',coalesce((select sum(actual_kg) from actual),0)-coalesce((select sum(target_kg) from planned),0),'variance_percentage',case when coalesce((select sum(target_kg) from planned),0)=0 then null else round((coalesce((select sum(actual_kg) from actual),0)-coalesce((select sum(target_kg) from planned),0))/nullif((select sum(target_kg) from planned),0)*100,2) end) into result;
  return result;
end; $$;
revoke all on function public.get_feed_plan_summary(date,date,uuid) from public,anon;
grant execute on function public.get_feed_plan_summary(date,date,uuid) to authenticated;
