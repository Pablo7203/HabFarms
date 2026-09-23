-- The un-clipped implementation is an internal helper for the guarded public
-- report wrapper; callers must not invoke it directly.
revoke all on function public.get_rearing_daily_report_all_dates(uuid,date,date) from public,anon,authenticated;
