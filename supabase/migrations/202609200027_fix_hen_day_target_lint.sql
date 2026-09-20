-- Keep the P1 reporting function lint-clean without changing its public contract.
create or replace function public.get_hen_day_target_summary(start_date date,end_date date,target_flock uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f uuid; actual_eggs numeric; all_bird_days numeric; covered_bird_days numeric; expected_eggs numeric;
begin
  select farm_id into f from public.farm_members where user_id=auth.uid() and active order by created_at limit 1;
  if f is null or start_date is null or end_date is null or start_date>end_date or (target_flock is not null and not exists(select 1 from public.flocks where id=target_flock and farm_id=f)) then raise exception 'Hen-Day target access denied' using errcode='42501'; end if;
  with rows as (
    select p.id,p.flock_id,p.production_date,p.eggs_collected,m.live_birds,t.target_percentage
    from public.daily_production_records p join public.v_daily_production_metrics m on m.production_id=p.id
    left join lateral(select target_percentage from public.flock_hen_day_targets t where t.farm_id=f and t.flock_id=p.flock_id and p.production_date between t.effective_from and coalesce(t.effective_to,'infinity'::date) order by t.effective_from desc limit 1)t on true
    where p.farm_id=f and p.production_date between start_date and end_date and (target_flock is null or p.flock_id=target_flock)
  ) select coalesce(sum(eggs_collected),0),coalesce(sum(live_birds),0),coalesce(sum(live_birds) filter(where target_percentage is not null),0),coalesce(sum(live_birds*target_percentage/100) filter(where target_percentage is not null),0)
    into actual_eggs,all_bird_days,covered_bird_days,expected_eggs from rows;
  return jsonb_build_object('actual_hen_day_percentage',case when all_bird_days=0 then null else round(actual_eggs/all_bird_days*100,2) end,'target_hen_day_percentage',case when covered_bird_days=0 then null else round(expected_eggs/covered_bird_days*100,2) end,'variance_points',case when covered_bird_days=0 or all_bird_days=0 then null else round(actual_eggs/all_bird_days*100-expected_eggs/covered_bird_days*100,2) end,'target_coverage_percentage',case when all_bird_days=0 then 0 else round(covered_bird_days/all_bird_days*100,2) end,'covered_bird_days',covered_bird_days,'eligible_bird_days',all_bird_days,'status',case when covered_bird_days=0 then 'not_configured' when actual_eggs/all_bird_days*100>=expected_eggs/covered_bird_days*100 then 'at_or_above_target' else 'below_target' end);
end;$$;
