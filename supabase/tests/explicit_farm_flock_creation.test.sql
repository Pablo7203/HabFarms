begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(22);

select extensions.ok(
  to_regprocedure('public.create_flock(uuid,text,text,text,text,date,integer,integer,text,text)') is not null,
  'explicit-farm flock creation RPC exists'
);
select extensions.ok(
  (select p.prosecdef and array_to_string(p.proconfig,',') like '%search_path=%'
   from pg_proc p where p.oid='public.create_flock(uuid,text,text,text,text,date,integer,integer,text,text)'::regprocedure),
  'explicit-farm RPC is security-definer with a controlled search path'
);
select extensions.ok(
  has_function_privilege('authenticated','public.create_flock(uuid,text,text,text,text,date,integer,integer,text,text)','EXECUTE'),
  'authenticated users can call the guarded explicit-farm RPC'
);
select extensions.ok(
  not has_function_privilege('anon','public.create_flock(uuid,text,text,text,text,date,integer,integer,text,text)','EXECUTE'),
  'anonymous users cannot call the explicit-farm RPC'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-4000-8000-000000000001','authenticated','authenticated','farm-route-admin@example.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-4000-8000-000000000002','authenticated','authenticated','farm-route-manager@example.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-4000-8000-000000000003','authenticated','authenticated','farm-route-worker@example.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-4000-8000-000000000004','authenticated','authenticated','farm-route-inactive@example.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-4000-8000-000000000005','authenticated','authenticated','farm-route-platform@example.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-4000-8000-000000000006','authenticated','authenticated','farm-route-unrelated@example.test','',now(),'{}','{}',now(),now());

insert into public.platform_admins(user_id,platform_role,is_active)
values('a1000000-0000-4000-8000-000000000005','super_admin',true);

insert into public.farms(id,name) values
  ('a2000000-0000-4000-8000-000000000001','Farm Route A1'),
  ('a2000000-0000-4000-8000-000000000002','Farm Route A2'),
  ('a2000000-0000-4000-8000-000000000003','Farm Route B'),
  ('a2000000-0000-4000-8000-000000000004','Farm Route Suspended');

insert into public.farm_members(farm_id,user_id,role,active) values
  ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','admin',true),
  ('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','admin',true),
  ('a2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000002','manager',true),
  ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003','worker',true),
  ('a2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000004','admin',false),
  ('a2000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000001','admin',true);

insert into public.farm_accounts(
  farm_id,account_status,primary_owner_user_id,contact_name,contact_email,created_by_platform_admin
) values(
  'a2000000-0000-4000-8000-000000000004','suspended','a1000000-0000-4000-8000-000000000001',
  'Suspended Farm Owner','farm-route-suspended@example.test','a1000000-0000-4000-8000-000000000005'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);

select extensions.is(
  (select farm_id from public.create_flock(
    'a2000000-0000-4000-8000-000000000002','A2 selected flock',null,null,null,current_date,120,null,null,null
  )),
  'a2000000-0000-4000-8000-000000000002'::uuid,
  'admin creation targets Farm A2 when Farm A2 is explicitly selected'
);
select extensions.is(
  (select count(*)::integer from public.flocks where farm_id='a2000000-0000-4000-8000-000000000001'),
  0,
  'creating under Farm A2 leaves Farm A1 unchanged'
);
select extensions.is(
  (select count(*)::integer from public.audit_logs where farm_id='a2000000-0000-4000-8000-000000000002' and action='flock.created' and entity_type='flocks' and metadata->>'initial_birds'='120'),
  1,
  'the creation audit is attached to Farm A2 with the opening population'
);
select extensions.is(
  (select count(*)::integer from public.bird_movements m join public.flocks f on f.id=m.flock_id where f.farm_id='a2000000-0000-4000-8000-000000000002'),
  0,
  'initial_birds remains the sole opening baseline with no duplicate opening movement'
);

select extensions.is(
  (select farm_id from public.create_flock(
    'a2000000-0000-4000-8000-000000000001','A1 selected flock',null,null,null,current_date,90,null,null,null
  )),
  'a2000000-0000-4000-8000-000000000001'::uuid,
  'admin creation also targets Farm A1 when Farm A1 is explicitly selected'
);

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
select extensions.is(
  (select farm_id from public.create_flock(
    'a2000000-0000-4000-8000-000000000003','Manager flock',null,null,null,current_date,75,null,null,null
  )),
  'a2000000-0000-4000-8000-000000000003'::uuid,
  'authorized manager retains flock-creation permission'
);
select extensions.throws_ok(
  $$select public.create_flock('Legacy manager flock',null,null,null,current_date,10,null,null,null)$$,
  '22023','Explicit farm selection is required; choose an active farm in HabFarms',
  'legacy overload rejects even a single-farm caller instead of selecting implicitly'
);

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
select extensions.throws_ok(
  $$select public.create_flock('a2000000-0000-4000-8000-000000000001','Worker flock',null,null,null,current_date,10,null,null,null)$$,
  '42501',null,'worker cannot create a flock'
);

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000004',true);
select extensions.throws_ok(
  $$select public.create_flock('a2000000-0000-4000-8000-000000000003','Inactive member flock',null,null,null,current_date,10,null,null,null)$$,
  '42501',null,'inactive membership cannot create a flock'
);

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000006',true);
select extensions.throws_ok(
  $$select public.create_flock('a2000000-0000-4000-8000-000000000001','Unrelated user flock',null,null,null,current_date,10,null,null,null)$$,
  '42501',null,'user without farm membership cannot create a flock'
);

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select extensions.throws_ok(
  $$select public.create_flock('a2000000-0000-4000-8000-000000000004','Suspended farm flock',null,null,null,current_date,10,null,null,null)$$,
  '42501',null,'suspended farm blocks flock creation'
);

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000005',true);
select extensions.throws_ok(
  $$select public.create_flock('a2000000-0000-4000-8000-000000000001','Platform admin flock',null,null,null,current_date,10,null,null,null)$$,
  '42501',null,'platform admin without farm membership cannot create a flock'
);

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
select extensions.throws_ok(
  $$select public.create_flock('a2000000-0000-4000-8000-000000000002','Cross-farm flock',null,null,null,current_date,10,null,null,null)$$,
  '42501',null,'Farm B manager cannot create in Farm A2'
);
select extensions.throws_ok(
  $$select public.create_flock('a2999999-0000-4000-8000-000000000099','Unknown farm flock',null,null,null,current_date,10,null,null,null)$$,
  '42501',null,'unknown farm identifier is rejected'
);
select extensions.throws_ok(
  $$select public.create_flock(null,'Missing farm flock',null,null,null,current_date,10,null,null,null)$$,
  '42501',null,'missing farm identifier is rejected'
);

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select extensions.throws_ok(
  $$select public.create_flock('Legacy ambiguous flock',null,null,null,current_date,10,null,null,null)$$,
  '22023','Explicit farm selection is required; choose an active farm in HabFarms',
  'legacy overload fails closed rather than choosing an arbitrary farm for multi-farm users'
);

reset role;
select extensions.is(
  (select count(*)::integer from public.flocks where farm_id in (
    'a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000004'
  )),
  3,
  'rejected authorization attempts create no partial flocks in the isolated fixture farms'
);
select extensions.is(
  (select count(*)::integer from public.audit_logs where action='flock.created' and farm_id in (
    'a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000004'
  )),
  3,
  'rejected authorization attempts create no partial audit records'
);

reset role;
select * from extensions.finish();
rollback;
