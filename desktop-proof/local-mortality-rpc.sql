-- Development proof only. Applied manually to the uniquely named local stack.
-- Deliberately outside supabase/migrations until Phase 1 review.
create schema if not exists desktop_proof;
revoke all on schema desktop_proof from public, anon, authenticated;

create table if not exists desktop_proof.operation_receipts (
  operation_id uuid primary key,
  actor_id uuid not null,
  farm_id uuid not null,
  payload jsonb not null,
  receipt jsonb,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);
revoke all on desktop_proof.operation_receipts from public, anon, authenticated;

-- Proof-only one-shot retryable response injection. This is never a ledger row.
create table if not exists desktop_proof.retry_once (operation_id uuid primary key);
revoke all on desktop_proof.retry_once from public, anon, authenticated;

drop function if exists public.desktop_proof_submit_mortality_v1(uuid,uuid,uuid,date,integer,text);
create or replace function public.desktop_proof_submit_mortality_v1(
  p_schema_version integer,
  p_operation_type text,
  p_operation_id uuid,
  p_farm_id uuid,
  p_flock_id uuid,
  p_event_date date,
  p_quantity integer,
  p_notes text,
  p_created_at_local timestamptz,
  p_queued_at_local timestamptz,
  p_dependencies uuid[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  canonical jsonb;
  existing desktop_proof.operation_receipts;
  inserted boolean;
  movement public.bird_movements;
  result jsonb;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_schema_version is distinct from 1 or p_operation_type is distinct from 'MORTALITY_V1' then
    raise exception 'Unsupported mortality operation schema' using errcode = '22023';
  end if;
  if p_created_at_local is null or p_queued_at_local is null
     or p_queued_at_local < p_created_at_local or p_dependencies is null
     or cardinality(p_dependencies) <> 0 then
    raise exception 'Invalid mortality operation envelope' using errcode = '22023';
  end if;
  if p_operation_id is null or p_farm_id is null or p_flock_id is null
     or p_event_date is null or p_quantity is null or p_quantity <= 0
     or char_length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Invalid mortality operation' using errcode = '22023';
  end if;
  -- Explicit farm header and current membership, role, account and subscription.
  if public.resolve_selected_farm(array['admin','manager']) <> p_farm_id then
    raise exception 'Selected farm mismatch' using errcode = '42501';
  end if;
  if not exists (select 1 from public.flocks where id = p_flock_id and farm_id = p_farm_id) then
    raise exception 'Flock outside selected farm' using errcode = '42501';
  end if;

  canonical := jsonb_build_object(
    'schemaVersion', 1, 'operationType', 'MORTALITY_V1',
    'farmId', p_farm_id, 'flockId', p_flock_id,
    'eventDate', p_event_date, 'quantity', p_quantity,
    'notes', trim(coalesce(p_notes, '')),
    'createdAtLocal', p_created_at_local,
    'queuedAtLocal', p_queued_at_local,
    'dependencies', to_jsonb(p_dependencies)
  );

  if trim(coalesce(p_notes, '')) = 'Synthetic retry once' then
    insert into desktop_proof.retry_once(operation_id) values (p_operation_id)
      on conflict (operation_id) do nothing;
    if found then
      return jsonb_build_object('code', 'RETRYABLE_FAILURE', 'operationId', p_operation_id);
    end if;
  end if;

  -- The PK serializes simultaneous claims for the same operation ID. The
  -- movement and receipt commit or roll back in one PostgreSQL transaction.
  insert into desktop_proof.operation_receipts(operation_id, actor_id, farm_id, payload)
  values (p_operation_id, actor, p_farm_id, canonical)
  on conflict (operation_id) do nothing;
  inserted := found;
  if not inserted then
    select * into existing from desktop_proof.operation_receipts
      where operation_id = p_operation_id for update;
    if existing.actor_id <> actor or existing.payload <> canonical then
      raise exception 'Operation ID reused with different actor or payload' using errcode = '23505';
    end if;
    return existing.receipt || jsonb_build_object('code', 'ALREADY_SYNCED');
  end if;

  movement := public.create_bird_movement(
    p_flock_id, p_event_date, 'death', p_quantity, 'OUT', trim(coalesce(p_notes, ''))
  );
  result := jsonb_build_object(
    'code', 'SUCCESS', 'operationId', p_operation_id,
    'farmId', p_farm_id, 'movementId', movement.id,
    'committedAt', now()
  );
  update desktop_proof.operation_receipts
    set receipt = result, committed_at = now()
    where operation_id = p_operation_id;
  return result;
end;
$$;
revoke all on function public.desktop_proof_submit_mortality_v1(integer,text,uuid,uuid,uuid,date,integer,text,timestamptz,timestamptz,uuid[]) from public, anon;
grant execute on function public.desktop_proof_submit_mortality_v1(integer,text,uuid,uuid,uuid,date,integer,text,timestamptz,timestamptz,uuid[]) to authenticated;
