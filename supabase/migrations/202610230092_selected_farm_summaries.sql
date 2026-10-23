-- Preserve the existing summary calculations while replacing their unsafe
-- "first membership" choice with the farm selected and authorized by the
-- same helper used for stock-changing operations. Abort if either function
-- differs from the reviewed version rather than silently editing the wrong SQL.
do $migration$
declare
  definition text;
  old_sql text;
  new_sql text;
begin
  definition := pg_get_functiondef('public.get_daily_farm_summary(date,uuid)'::regprocedure);
  old_sql := 'select farm_id,role into f,member_role from public.farm_members where user_id=auth.uid() and active order by created_at limit 1;';
  new_sql := 'f := public.resolve_selected_farm(array[''admin'',''manager'',''worker'']); select fm.role into member_role from public.farm_members fm where fm.farm_id=f and fm.user_id=auth.uid() and fm.active;';
  if position(old_sql in definition) > 0 then
    execute replace(definition, old_sql, new_sql);
  elsif position('resolve_selected_farm' in definition) = 0 or position('farm_id=f' in definition) = 0 then
    raise exception 'Daily summary definition changed; review selected-farm migration';
  end if;

  definition := pg_get_functiondef('public.get_weekly_farm_summary(date)'::regprocedure);
  old_sql := 'select fm.farm_id,fm.role,fa.timezone,fa.crate_size,fs.reporting_week_start into f,role,tz,crate,ws from public.farm_members fm join public.farms fa on fa.id=fm.farm_id join public.farm_settings fs on fs.farm_id=fm.farm_id where fm.user_id=auth.uid() and fm.active order by fm.created_at limit 1;';
  new_sql := 'f := public.resolve_selected_farm(array[''admin'',''manager'',''worker'']); select fm.role,fa.timezone,fa.crate_size,fs.reporting_week_start into role,tz,crate,ws from public.farm_members fm join public.farms fa on fa.id=fm.farm_id join public.farm_settings fs on fs.farm_id=fm.farm_id where fm.farm_id=f and fm.user_id=auth.uid() and fm.active;';
  if position(old_sql in definition) > 0 then
    execute replace(definition, old_sql, new_sql);
  elsif position('resolve_selected_farm' in definition) = 0 or position('fm.farm_id=f' in definition) = 0 then
    raise exception 'Weekly summary definition changed; review selected-farm migration';
  end if;
end;
$migration$;
