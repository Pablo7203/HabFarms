begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(7);

select extensions.ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.bird_movements'::regclass
      and tgname = 'bird_movements_lock_flock_before_write'
      and not tgisinternal
  ),
  'bird movement writes lock their parent flock'
);

select extensions.ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.bird_movements'::regclass
      and tgname = 'bird_movements_nonnegative_history'
      and tgdeferrable
      and tginitdeferred
      and not tgisinternal
  ),
  'direct bird movement writes receive a deferred history check'
);

select extensions.ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=%'
   from pg_proc p where p.oid = 'public.enforce_nonnegative_bird_movement_history()'::regprocedure),
  'the trigger guard is security-definer with a controlled search_path'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'f0100000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'bird-population-guard@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.farms (id, name)
values ('f0100000-0000-4000-8000-000000000002', 'Bird Population Guard Test Farm');

insert into public.flocks (id, farm_id, flock_name, start_date, initial_birds, created_by)
values (
  'f0100000-0000-4000-8000-000000000003',
  'f0100000-0000-4000-8000-000000000002',
  'Guard Test Flock', current_date - 1, 481,
  'f0100000-0000-4000-8000-000000000001'
);

set constraints bird_movements_nonnegative_history immediate;

insert into public.bird_movements (
  id, farm_id, flock_id, movement_date, movement_type, quantity, direction, notes, created_by
) values (
  'f0100000-0000-4000-8000-000000000004',
  'f0100000-0000-4000-8000-000000000002',
  'f0100000-0000-4000-8000-000000000003',
  current_date, 'adjustment', 481, 'OUT', 'Valid full-population test decrease',
  'f0100000-0000-4000-8000-000000000001'
);

select extensions.is(
  public.flock_balance_at('f0100000-0000-4000-8000-000000000003'),
  0,
  'a decrease equal to the available live birds is accepted'
);

select extensions.throws_ok(
  $$insert into public.bird_movements (farm_id, flock_id, movement_date, movement_type, quantity, direction, notes, created_by)
    values ('f0100000-0000-4000-8000-000000000002', 'f0100000-0000-4000-8000-000000000003', current_date, 'adjustment', 1, 'OUT', 'One too many birds', 'f0100000-0000-4000-8000-000000000001')$$,
  '23514', 'Bird movement would make flock population negative',
  'a direct insert cannot decrease below zero'
);

select extensions.throws_ok(
  $$update public.bird_movements set quantity = 482 where id = 'f0100000-0000-4000-8000-000000000004'$$,
  '23514', 'Bird movement would make flock population negative',
  'a direct update cannot decrease below zero'
);

select extensions.is(
  (select count(*)::integer from public.bird_movements
   where id = 'f0100000-0000-4000-8000-000000000004' and quantity = 481),
  1,
  'rejected over-decreases leave the valid movement unchanged'
);

select * from extensions.finish();
rollback;
