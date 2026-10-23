begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

select extensions.ok(to_regclass('public.desktop_sync_receipts') is not null,
  'desktop sync receipts exist');
select extensions.ok((select relrowsecurity from pg_class where oid='public.desktop_sync_receipts'::regclass),
  'desktop sync receipts have row-level security enabled');
select extensions.ok(not has_table_privilege('authenticated','public.desktop_sync_receipts','SELECT'),
  'authenticated users cannot read receipt storage directly');
select extensions.ok(not has_table_privilege('anon','public.desktop_sync_receipts','SELECT'),
  'anonymous users cannot read receipt storage');
select extensions.ok(has_table_privilege('service_role','public.desktop_sync_receipts','SELECT'),
  'server administration role can inspect receipts');
select extensions.ok(to_regprocedure('public.sync_desktop_operation_v1(jsonb)') is not null,
  'versioned desktop sync boundary exists');
select extensions.ok((select p.prosecdef and array_to_string(p.proconfig,',') like '%search_path=%'
  from pg_proc p where p.oid='public.sync_desktop_operation_v1(jsonb)'::regprocedure),
  'desktop sync boundary is security-definer with a controlled search path');
select extensions.ok(has_function_privilege('authenticated','public.sync_desktop_operation_v1(jsonb)','EXECUTE'),
  'authenticated users can submit through the validated sync boundary');
select extensions.ok(not has_function_privilege('anon','public.sync_desktop_operation_v1(jsonb)','EXECUTE'),
  'anonymous users cannot submit offline operations');

select * from extensions.finish();
rollback;
