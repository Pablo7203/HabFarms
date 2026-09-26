-- Enforce non-negative population histories even when a write bypasses the
-- create_bird_movement RPC (for example, an elevated Table Editor/SQL write).
-- Movement rows cannot be reassigned between flocks; corrections must be
-- represented within the original flock's ledger.

create or replace function public.lock_bird_movement_flock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_flock uuid;
begin
  if tg_op = 'UPDATE' and (
    old.flock_id is distinct from new.flock_id
    or old.farm_id is distinct from new.farm_id
  ) then
    raise exception 'A bird movement cannot be reassigned to another flock or farm'
      using errcode = '23514';
  end if;

  target_flock := case when tg_op = 'DELETE' then old.flock_id else new.flock_id end;
  perform 1 from public.flocks where id = target_flock for update;
  if not found and tg_op <> 'DELETE' then
    raise exception 'The flock for this bird movement no longer exists'
      using errcode = '23503';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.lock_bird_movement_flock() from public, anon, authenticated;

create trigger bird_movements_lock_flock_before_write
before insert or update or delete on public.bird_movements
for each row execute function public.lock_bird_movement_flock();

create or replace function public.enforce_nonnegative_bird_movement_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.assert_nonnegative_flock_history(old.flock_id);
  else
    perform public.assert_nonnegative_flock_history(new.flock_id);
  end if;
  return null;
end;
$$;

revoke all on function public.enforce_nonnegative_bird_movement_history() from public, anon, authenticated;

create constraint trigger bird_movements_nonnegative_history
after insert or update or delete on public.bird_movements
deferrable initially deferred
for each row execute function public.enforce_nonnegative_bird_movement_history();

-- Keep the application RPC's validation immediate and user-readable. The
-- deferred trigger above remains the final guard for all database write paths.
create or replace function public.create_bird_movement(
  target_flock_id uuid,
  movement_date date,
  movement_type text,
  quantity integer,
  direction text,
  notes text default null
) returns public.bird_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_farm uuid;
  available_birds integer;
  normalized_direction text := upper(coalesce(direction, ''));
  created public.bird_movements;
begin
  select f.farm_id into target_farm
  from public.flocks f
  where f.id = target_flock_id
  for update;

  if target_farm is null or not public.has_farm_role(target_farm, array['admin','manager']) then
    raise exception 'Bird movement access denied' using errcode = '42501';
  end if;

  if movement_type = 'adjustment' and char_length(trim(coalesce(notes, ''))) < 5 then
    raise exception 'Adjustment movement requires a reason of at least 5 characters'
      using errcode = '23514';
  end if;

  if normalized_direction = 'OUT' then
    available_birds := public.flock_balance_at(target_flock_id, movement_date);
    if available_birds < 0 or quantity > available_birds then
      raise exception 'Cannot decrease by % birds: only % birds are available on %',
        quantity, greatest(available_birds, 0), movement_date
        using errcode = '23514';
    end if;
  end if;

  insert into public.bird_movements(
    farm_id, flock_id, movement_date, movement_type, quantity, direction, notes, created_by
  ) values (
    target_farm, target_flock_id, movement_date, movement_type, quantity,
    normalized_direction, nullif(trim(notes), ''), auth.uid()
  ) returning * into created;

  perform public.assert_nonnegative_flock_history(target_flock_id);
  return created;
end;
$$;

revoke all on function public.create_bird_movement(uuid,date,text,integer,text,text) from public, anon;
grant execute on function public.create_bird_movement(uuid,date,text,integer,text,text) to authenticated;

comment on function public.enforce_nonnegative_bird_movement_history() is
  'Deferred database-wide invariant: every flock movement write must leave all historical live-bird balances non-negative.';
