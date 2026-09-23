-- A batch has no daily reporting obligation before its recorded arrival.
-- Keep the underlying ledger routine private to authenticated callers, and
-- expose the same contract with its visible period clipped to batch arrival.
alter function public.get_rearing_daily_report(uuid,date,date) rename to get_rearing_daily_report_all_dates;

create function public.get_rearing_daily_report(target_batch uuid,target_from date,target_to date)
returns table(
  report_date date,opening_birds integer,inbound_birds integer,deaths integer,
  transfers_out integer,other_outbound integer,closing_birds integer,
  daily_record_status text,observations text,feed_consumed_kg numeric,
  feed_cost numeric,feed_products jsonb,completed_health_activities integer,
  scheduled_health_activities integer,attributable_cost numeric
) language sql stable security definer set search_path='' as $$
  select r.* from public.get_rearing_daily_report_all_dates(target_batch,target_from,target_to) r
  where r.report_date >= (select b.arrival_date from public.rearing_batches b where b.id=target_batch)
$$;

revoke all on function public.get_rearing_daily_report_all_dates(uuid,date,date),
  public.get_rearing_daily_report(uuid,date,date) from public,anon;
grant execute on function public.get_rearing_daily_report_all_dates(uuid,date,date),
  public.get_rearing_daily_report(uuid,date,date) to authenticated;
