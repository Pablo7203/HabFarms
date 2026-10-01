begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(11);

select extensions.ok(not has_column_privilege('authenticated','public.feed_inventory_movements','unit_cost_snapshot','select'),
  'authenticated users cannot directly select feed unit costs');
select extensions.ok(not has_column_privilege('authenticated','public.feed_inventory_movements','total_cost_snapshot','select'),
  'authenticated users cannot directly select feed total costs');
select extensions.ok(has_column_privilege('authenticated','public.feed_inventory_movements','quantity_kg','select'),
  'farm members retain direct access to operational feed quantities');
select extensions.ok(not has_column_privilege('authenticated','public.feed_inventory_balances','inventory_value','select'),
  'authenticated users cannot directly select feed inventory valuation');
select extensions.ok(not has_column_privilege('authenticated','public.feed_inventory_balances','weighted_average_cost','select'),
  'authenticated users cannot directly select weighted feed costs');
select extensions.ok(has_column_privilege('authenticated','public.feed_inventory_balances','quantity_kg','select'),
  'farm members retain direct access to current feed balances');
select extensions.ok(has_function_privilege('authenticated','public.get_feed_movement_cost_snapshots(uuid[])','execute'),
  'authenticated users can invoke the guarded cost-snapshot reader');
select extensions.ok(not has_function_privilege('anon','public.get_feed_movement_cost_snapshots(uuid[])','execute'),
  'anonymous users cannot invoke the guarded cost-snapshot reader');
select extensions.ok(position('is_farm_member' in pg_get_viewdef('public.v_feed_forecast'::regclass))>0,
  'the owner-executed forecast view explicitly scopes rows to farm members');
select extensions.ok(position('has_farm_role' in pg_get_viewdef('public.v_feed_forecast'::regclass))>0,
  'the forecast view conditionally exposes valuation only to management roles');
select extensions.ok(position('feed_access_farm' in pg_get_functiondef('public.get_feed_movement_cost_snapshots(uuid[])'::regprocedure))>0,
  'the cost snapshot reader validates the caller role and selected farm');

select * from extensions.finish();
rollback;
