begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(15);

select extensions.ok(
  to_regprocedure('public.get_rearing_lifecycle_as_of(uuid,date)') is not null,
  'as-of lifecycle RPC exists'
);
select extensions.ok(
  (select p.prosecdef and p.provolatile='s' and array_to_string(p.proconfig,',') like '%search_path=%'
   from pg_proc p where p.oid='public.get_rearing_lifecycle_as_of(uuid,date)'::regprocedure),
  'as-of RPC is stable, security definer, and has a controlled search_path'
);
select extensions.ok(
  has_function_privilege('authenticated','public.get_rearing_lifecycle_as_of(uuid,date)','EXECUTE'),
  'authenticated callers can use the guarded as-of RPC'
);
select extensions.ok(
  not has_function_privilege('anon','public.get_rearing_lifecycle_as_of(uuid,date)','EXECUTE'),
  'anonymous callers cannot use the as-of RPC'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.rearing_cost_total_at(uuid,date)','EXECUTE'),
  'the raw cost helper is not directly executable by authenticated clients'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.get_rearing_daily_report_all_dates(uuid,date,date)','EXECUTE'),
  'the pre-arrival raw daily report helper is private'
);
select extensions.ok(
  has_function_privilege('authenticated','public.get_rearing_reconciliation(uuid)','EXECUTE'),
  'authenticated callers can use guarded reconciliation'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.rearing_batches'::regclass),
  'rearing batches enforce row-level security'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.rearing_movements'::regclass),
  'rearing movements enforce row-level security'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.rearing_feed_consumptions'::regclass),
  'rearing feed consumption enforces row-level security'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.rearing_transfers'::regclass),
  'rearing transfers enforce row-level security'
);
select extensions.ok(
  position('if not financial then' in lower(pg_get_functiondef('public.get_rearing_cost_source_status(uuid)'::regprocedure)))>0,
  'cost-source status returns a non-financial result for workers'
);
select extensions.ok(
  position('case when j.planned is null then null' in lower(pg_get_functiondef('public.get_rearing_feed_plan_variance(uuid,date,date)'::regprocedure)))>0,
  'feed variance stays unavailable when no effective plan exists'
);
select extensions.ok(
  (select count(*)=2 from pg_trigger t where t.tgname in('rearing_feed_plan_no_closed_write','rearing_reminder_no_closed_write') and t.tgenabled<>'D'),
  'closed batches reject new feed plans and health reminders'
);
select extensions.ok(
  position('for update' in lower(pg_get_functiondef('public.guard_closed_rearing_batch_operations()'::regprocedure)))>0,
  'closed-batch operational guard locks the batch row before allowing writes'
);

select * from extensions.finish();
rollback;
