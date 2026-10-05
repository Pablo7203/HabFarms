begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

select extensions.ok(not has_function_privilege('anon', 'public.get_my_onboarding_progress(uuid)', 'EXECUTE'), 'anonymous callers cannot read setup progress');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','b8100000-0000-4000-8000-000000000001','authenticated','authenticated','onboarding-owner-a@example.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','b8100000-0000-4000-8000-000000000002','authenticated','authenticated','onboarding-owner-b@example.test','',now(),'{}','{}',now(),now());
insert into public.farms(id,name) values
('b8200000-0000-4000-8000-000000000001','Onboarding A'),
('b8200000-0000-4000-8000-000000000002','Onboarding B');
insert into public.farm_members(farm_id,user_id,role,active) values
('b8200000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000001','admin',true),
('b8200000-0000-4000-8000-000000000002','b8100000-0000-4000-8000-000000000002','admin',true),
('b8200000-0000-4000-8000-000000000002','b8100000-0000-4000-8000-000000000001','admin',true);
insert into public.farm_accounts(farm_id,account_status,primary_owner_user_id,contact_name,contact_email,created_by_platform_admin) values
('b8200000-0000-4000-8000-000000000001','onboarding','b8100000-0000-4000-8000-000000000001','Owner A','onboarding-owner-a@example.test','b8100000-0000-4000-8000-000000000002'),
('b8200000-0000-4000-8000-000000000002','onboarding','b8100000-0000-4000-8000-000000000002','Owner B','onboarding-owner-b@example.test','b8100000-0000-4000-8000-000000000002');
insert into public.farm_onboarding(farm_id,farm_settings_completed_at) values
('b8200000-0000-4000-8000-000000000001','2026-10-01T00:00:00Z'),
('b8200000-0000-4000-8000-000000000002',null);

set local role authenticated;
select set_config('request.jwt.claim.sub','b8100000-0000-4000-8000-000000000001',true);
select extensions.is((select count(*)::integer from public.farm_onboarding),0,'direct table reads stay restricted');
select extensions.is((select farm_settings_completed_at from public.get_my_onboarding_progress('b8200000-0000-4000-8000-000000000001')),'2026-10-01T00:00:00Z'::timestamptz,'onboarding owner can read existing milestones');
select extensions.throws_ok($$select public.get_my_onboarding_progress('b8200000-0000-4000-8000-000000000002')$$,'42501','Onboarding access denied','membership alone does not grant another owner progress access');
select extensions.throws_ok($$select public.get_my_onboarding_progress(null)$$,'42501','Onboarding access denied','missing farm is denied');
select set_config('request.jwt.claim.sub','b8100000-0000-4000-8000-000000000002',true);
select extensions.throws_ok($$select public.get_my_onboarding_progress('b8200000-0000-4000-8000-000000000001')$$,'42501','Onboarding access denied','unrelated user cannot read another farm');

reset role;
update public.farm_members set active=false where farm_id='b8200000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','b8100000-0000-4000-8000-000000000001',true);
select extensions.throws_ok($$select public.get_my_onboarding_progress('b8200000-0000-4000-8000-000000000001')$$,'42501','Onboarding access denied','inactive owner cannot read progress');
reset role;
update public.farm_members set active=true where farm_id='b8200000-0000-4000-8000-000000000001';
update public.farm_accounts set account_status='suspended' where farm_id='b8200000-0000-4000-8000-000000000001';
set local role authenticated;
select extensions.throws_ok($$select public.get_my_onboarding_progress('b8200000-0000-4000-8000-000000000001')$$,'42501','Onboarding access denied','suspended accounts cannot use onboarding reader');
reset role;
update public.farm_accounts set account_status='onboarding' where farm_id='b8200000-0000-4000-8000-000000000001';
delete from public.farm_onboarding where farm_id='b8200000-0000-4000-8000-000000000001';
set local role authenticated;
select extensions.is((select count(*)::integer from public.get_my_onboarding_progress('b8200000-0000-4000-8000-000000000001')),0,'missing tracker returns no fabricated milestones');
select * from extensions.finish();
rollback;
