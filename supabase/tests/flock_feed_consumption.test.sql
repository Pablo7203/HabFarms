begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(11);

select extensions.ok(to_regprocedure('public.create_flock_feed_consumption(uuid,uuid,date,numeric,text)') is not null,
  'standalone flock feed-consumption RPC exists');
select extensions.ok(to_regprocedure('public.update_flock_feed_consumption(uuid,uuid,numeric,text)') is not null,
  'manager correction RPC exists');
select extensions.ok((select relrowsecurity from pg_class where oid='public.flock_feed_consumptions'::regclass),
  'standalone feed-use records have row-level security');
select extensions.ok(has_function_privilege('authenticated','public.create_flock_feed_consumption(uuid,uuid,date,numeric,text)','EXECUTE'),
  'authenticated farm members can use the guarded create RPC');
select extensions.ok(not has_function_privilege('anon','public.create_flock_feed_consumption(uuid,uuid,date,numeric,text)','EXECUTE'),
  'anonymous callers cannot create feed-use records');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000000','a8000000-0000-4000-8000-000000000001','authenticated','authenticated','flock-feed-manager@example.test','',now(),'{}','{}',now(),now());
insert into public.farms(id,name) values('a9000000-0000-4000-8000-000000000001','Feed-use contract farm');
insert into public.farm_settings(farm_id) values('a9000000-0000-4000-8000-000000000001');
insert into public.farm_members(farm_id,user_id,role,active) values('a9000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','manager',true);
insert into public.flocks(id,farm_id,flock_name,start_date,initial_birds,status,created_by)
values('aa000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000001','Broiler flock',current_date-14,100,'active','a8000000-0000-4000-8000-000000000001');
insert into public.feed_types(id,farm_id,name,default_bag_size_kg,active,created_by)
values('ab000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000001','Broiler starter',50,true,'a8000000-0000-4000-8000-000000000001');
insert into public.feed_inventory_movements(farm_id,feed_type_id,movement_date,movement_type,direction,quantity_kg,unit_cost_snapshot,total_cost_snapshot,source_type,created_by)
values('a9000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001',current_date-1,'opening_stock','IN',100,2,200,'opening_feed_stock','a8000000-0000-4000-8000-000000000001');
select public.recalculate_feed_ledger('a9000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','a8000000-0000-4000-8000-000000000001',true);
select set_config('request.headers','{"x-habfarms-active-farm":"a9000000-0000-4000-8000-000000000001"}',true);

select extensions.is((select quantity_kg from public.create_flock_feed_consumption(
  'aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001',current_date,12.5,'Broiler daily ration')),
  12.5::numeric,'standalone entry records the feed-use weight');
select extensions.is((select quantity_kg from public.feed_inventory_balances where farm_id='a9000000-0000-4000-8000-000000000001' and feed_type_id='ab000000-0000-4000-8000-000000000001'),
  87.5::numeric,'standalone use is deducted from the normal feed ledger');
select extensions.throws_ok($$select public.create_flock_feed_consumption(
  'aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001',current_date,1,'duplicate')$$,
  '23505','Feed has already been recorded for this flock on this date. Update the existing entry instead.','a second standalone entry that day is rejected');

reset role;
select extensions.throws_ok($$insert into public.feed_inventory_movements(farm_id,flock_id,feed_type_id,movement_date,movement_type,direction,quantity_kg,source_type,source_id,created_by)
values('a9000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001',current_date,'consumption','OUT',1,'daily_production',gen_random_uuid(),'a8000000-0000-4000-8000-000000000001')$$,
  '23505','Feed has already been recorded for this flock on this date. Update the existing entry instead.','daily production cannot create a second same-day feed issue');
select extensions.ok(not exists(select 1 from public.feed_inventory_movements where farm_id='a9000000-0000-4000-8000-000000000001' and source_type='daily_production'),
  'rejected cross-path movement leaves stock untouched');
select extensions.is((select count(*)::integer from public.flock_feed_consumptions where farm_id='a9000000-0000-4000-8000-000000000001'),
  1,'one same-day flock feed-use row remains');
select * from extensions.finish();
rollback;
