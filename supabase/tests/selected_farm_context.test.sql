begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(31);

select extensions.ok(to_regprocedure('public.resolve_selected_farm(text[])') is not null,
  'selected-farm resolver exists');
select extensions.ok((select p.prosecdef and array_to_string(p.proconfig,',') like '%search_path=%'
  from pg_proc p where p.oid='public.resolve_selected_farm(text[])'::regprocedure),
  'selected-farm resolver is security-definer with a controlled search path');
select extensions.ok(has_function_privilege('authenticated','public.resolve_selected_farm(text[])','EXECUTE'),
  'authenticated callers can resolve only a role-authorized selected farm');
select extensions.ok(not has_function_privilege('anon','public.resolve_selected_farm(text[])','EXECUTE'),
  'anonymous callers cannot resolve farm context');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('00000000-0000-0000-0000-000000000000','a3000000-0000-4000-8000-000000000001','authenticated','authenticated','selected-farm-admin@example.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','a3000000-0000-4000-8000-000000000002','authenticated','authenticated','selected-farm-manager@example.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','a3000000-0000-4000-8000-000000000003','authenticated','authenticated','selected-farm-worker@example.test','',now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','a3000000-0000-4000-8000-000000000004','authenticated','authenticated','selected-farm-outsider@example.test','',now(),'{}','{}',now(),now());

insert into public.farms(id,name) values
 ('a4000000-0000-4000-8000-000000000001','Selected Farm A1'),
 ('a4000000-0000-4000-8000-000000000002','Selected Farm A2'),
 ('a4000000-0000-4000-8000-000000000003','Selected Farm B');
insert into public.farm_settings(farm_id) values
 ('a4000000-0000-4000-8000-000000000001'),
 ('a4000000-0000-4000-8000-000000000002'),
 ('a4000000-0000-4000-8000-000000000003');
select public.provision_default_egg_grades('a4000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001');
insert into public.farm_members(farm_id,user_id,role,active) values
 ('a4000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','admin',true),
 ('a4000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001','admin',true),
 ('a4000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000002','manager',true),
 ('a4000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000003','worker',true);

set local role authenticated;
select set_config('request.jwt.claim.sub','a3000000-0000-4000-8000-000000000001',true);
select set_config('request.headers','{"x-habfarms-active-farm":"a4000000-0000-4000-8000-000000000002"}',true);

select extensions.is(public.resolve_selected_farm(array['admin','manager']), 'a4000000-0000-4000-8000-000000000002'::uuid,
  'selected Farm A2 is resolved rather than the earliest membership');
select extensions.is((select farm_id from public.create_feed_type('Route regression feed',50,null)),
  'a4000000-0000-4000-8000-000000000002'::uuid,'feed write follows the selected farm');
select extensions.is((select farm_id from public.create_expense_category('Route Regression Category')),
  'a4000000-0000-4000-8000-000000000002'::uuid,'expense category write follows the selected farm');
select extensions.is((select farm_id from public.create_customer('Route regression customer',null,null,null,'retail',null,30)),
  'a4000000-0000-4000-8000-000000000002'::uuid,'customer write follows the selected farm');
select extensions.is((select farm_id from public.create_farm_invitation('route-regression@example.test','worker')),
  'a4000000-0000-4000-8000-000000000002'::uuid,'farm invitation follows the selected farm');
select extensions.is((select farm_id from public.create_flock(
  'a4000000-0000-4000-8000-000000000002','Selected farm routing flock',null,null,null,current_date,100,null,null,null)),
  'a4000000-0000-4000-8000-000000000002'::uuid,'explicit flock creation is scoped to the selected farm');
select extensions.is((select farm_id from public.create_health_reminder(
  (select id from public.flocks where flock_name='Selected farm routing flock'),
  'vaccination','Selected farm health reminder',current_date+7,null)),
  'a4000000-0000-4000-8000-000000000002'::uuid,'health reminder writes to the selected flock farm');
select extensions.is((select farm_id from public.set_opening_egg_stock(
  (select id from public.egg_grades where farm_id='a4000000-0000-4000-8000-000000000002' and is_unsorted),current_date,100,'routing context test stock')),
  'a4000000-0000-4000-8000-000000000002'::uuid,'opening egg stock fixture is farm-scoped');
select extensions.is((select farm_id from public.post_egg_grading(
  current_date,1,jsonb_build_array(jsonb_build_object(
   'egg_grade_id',(select id from public.egg_grades where farm_id='a4000000-0000-4000-8000-000000000002' and not is_unsorted and is_active order by sort_order limit 1),
   'quantity_eggs',1)),'routing context test grading')),
  'a4000000-0000-4000-8000-000000000002'::uuid,'egg grading transaction follows the selected farm');
select extensions.is((select farm_id from public.post_egg_sale(
  null,current_date,1,100,0,0,0,100,'cash',null,null)),
  'a4000000-0000-4000-8000-000000000002'::uuid,'egg sale transaction follows the selected farm');
select extensions.is((select farm_id from public.post_bird_sale(
  (select id from public.customers where name='Route regression customer'),
  (select id from public.flocks where flock_name='Selected farm routing flock'),current_date,
  'live_bird',2,10,20,'cash',null,null)),
  'a4000000-0000-4000-8000-000000000002'::uuid,'bird sale and population transaction follow the selected farm');
select extensions.ok(public.get_feed_plan_summary(current_date,current_date,null) is not null,
  'feed-plan reporting resolves the selected farm');
select extensions.ok(public.get_hen_day_target_summary(current_date,current_date,null) is not null,
  'hen-day reporting resolves the selected farm');
select extensions.is((public.get_daily_farm_summary(current_date,null)->>'date')::date,current_date,
  'daily summary resolves the selected farm and returns its date');
select extensions.is((public.get_weekly_farm_summary(current_date)->>'financial_access')::boolean,true,
  'weekly summary resolves the selected admin farm');

select set_config('request.headers','{"x-habfarms-active-farm":"a4000000-0000-4000-8000-000000000001"}',true);
select extensions.is(public.resolve_selected_farm(array['admin','manager']), 'a4000000-0000-4000-8000-000000000001'::uuid,
  'switching header to Farm A1 resolves Farm A1');
select extensions.is((select farm_id from public.create_customer('Route regression A1',null,null,null,'retail',null,30)),
  'a4000000-0000-4000-8000-000000000001'::uuid,'commercial write follows the newly selected Farm A1');

select set_config('request.headers','{"x-habfarms-active-farm":"a4000000-0000-4000-8000-000000000003"}',true);
select extensions.throws_ok($$select public.resolve_selected_farm(array['admin','manager'])$$,
  '42501',null,'authorized user cannot choose a farm without active membership');
select set_config('request.headers','{}',true);
select extensions.throws_ok($$select public.resolve_selected_farm(array['admin','manager'])$$,
  '22023','Explicit farm selection is required; select an active farm and retry','missing selection fails closed');
select set_config('request.headers','{"x-habfarms-active-farm":"not-a-uuid"}',true);
select extensions.throws_ok($$select public.resolve_selected_farm(array['admin','manager'])$$,
  '22023','Invalid selected farm','malformed selection fails safely');

select set_config('request.jwt.claim.sub','a3000000-0000-4000-8000-000000000003',true);
select set_config('request.headers','{"x-habfarms-active-farm":"a4000000-0000-4000-8000-000000000001"}',true);
select extensions.is(public.resolve_selected_farm(array['admin','manager','worker']),
  'a4000000-0000-4000-8000-000000000001'::uuid,'worker can resolve their own selected farm for permitted read paths');
select extensions.is((public.get_daily_farm_summary(current_date,null)->>'financial_access')::boolean,false,
  'daily reporting uses the selected worker farm and preserves financial privacy');
select extensions.is((public.get_weekly_farm_summary(current_date)->>'financial_access')::boolean,false,
  'weekly reporting uses the selected worker farm and preserves financial privacy');
select extensions.throws_ok($$select public.resolve_selected_farm(array['admin','manager'])$$,
  '42501',null,'worker cannot resolve a farm for manager/admin operations');
select extensions.throws_ok($$select public.create_feed_type('Worker prohibited feed',50,null)$$,
  '42501',null,'worker cannot create feed types through a direct RPC');

select set_config('request.jwt.claim.sub','a3000000-0000-4000-8000-000000000004',true);
select extensions.throws_ok($$select public.resolve_selected_farm(array['admin','manager','worker'])$$,
  '42501',null,'unrelated user cannot resolve any customer farm');

reset role;
select extensions.is((select count(*)::integer from public.customers where name like 'Route regression%'
  and farm_id in ('a4000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002')),
  2,'both authorized customer writes are in their selected farms and no rejected call partially wrote');
select * from extensions.finish();
rollback;
