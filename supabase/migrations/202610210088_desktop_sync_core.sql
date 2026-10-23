-- Durable, tenant-scoped receipts for the two supported desktop operations.
-- Business writes and receipt finalization happen in this one PostgreSQL transaction.
create table public.desktop_sync_receipts (
  farm_id uuid not null references public.farms(id) on delete cascade,
  operation_id uuid not null,
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  operation_type text not null check (operation_type in ('MORTALITY_V1','DAILY_PRODUCTION_V1')),
  schema_version integer not null check (schema_version = 1),
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('PROCESSING','SUCCEEDED')),
  receipt jsonb,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  primary key (farm_id, operation_id),
  constraint desktop_sync_receipt_terminal_state check (
    (state = 'PROCESSING' and receipt is null and committed_at is null)
    or (state = 'SUCCEEDED' and receipt is not null and committed_at is not null)
  )
);

alter table public.desktop_sync_receipts enable row level security;
revoke all on public.desktop_sync_receipts from public, anon, authenticated;
grant all on public.desktop_sync_receipts to service_role;

create or replace function public.sync_desktop_operation_v1(p_operation jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target_farm uuid;
  target_flock uuid;
  target_role text;
  target_status text;
  op_id uuid;
  op_type text;
  op_version integer;
  event_day date;
  created_local timestamptz;
  queued_local timestamptz;
  payload jsonb;
  normalized_payload jsonb;
  canonical jsonb;
  fingerprint text;
  existing public.desktop_sync_receipts;
  result jsonb;
  production public.daily_production_records;
  movement public.bird_movements;
  allocations jsonb;
  total_allocated bigint := 0;
  item jsonb;
  grade_id uuid;
  quantity integer;
  feed_kg numeric;
  transport numeric;
  other numeric;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_operation) is distinct from 'object' then
    raise exception 'Invalid desktop operation envelope' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_operation)) <> 10 then
    raise exception 'Invalid desktop operation envelope' using errcode = '22023';
  end if;
  if not (p_operation ?& array['operationId','farmId','createdAtLocal','queuedAtLocal','dependencies',
    'schemaVersion','operationType','flockId','eventDate','payload']) then
    raise exception 'Invalid desktop operation envelope' using errcode = '22023';
  end if;

  begin
    op_id := (p_operation->>'operationId')::uuid;
    target_farm := (p_operation->>'farmId')::uuid;
    target_flock := (p_operation->>'flockId')::uuid;
    event_day := (p_operation->>'eventDate')::date;
    created_local := (p_operation->>'createdAtLocal')::timestamptz;
    queued_local := (p_operation->>'queuedAtLocal')::timestamptz;
    op_version := (p_operation->>'schemaVersion')::integer;
  exception when others then
    raise exception 'Invalid desktop operation identity or date' using errcode = '22023';
  end;
  op_type := p_operation->>'operationType';
  payload := p_operation->'payload';
  if op_id is null or target_farm is null or target_flock is null or event_day is null
     or created_local is null or queued_local is null or queued_local < created_local
     or op_version is distinct from 1 or jsonb_typeof(p_operation->'dependencies') is distinct from 'array'
     or jsonb_array_length(p_operation->'dependencies') <> 0 then
    raise exception 'Invalid desktop operation envelope' using errcode = '22023';
  end if;
  if op_type is null or op_type not in ('MORTALITY_V1','DAILY_PRODUCTION_V1') then
    raise exception 'Unsupported desktop operation schema' using errcode = '22023';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'Invalid desktop operation payload' using errcode = '22023';
  end if;
  if (op_type = 'MORTALITY_V1' and (select count(*) from jsonb_object_keys(payload)) <> 2)
     or (op_type = 'DAILY_PRODUCTION_V1' and (select count(*) from jsonb_object_keys(payload)) <> 10) then
    raise exception 'Invalid desktop operation payload' using errcode = '22023';
  end if;

  -- Resolve current farm role and account/subscription access before any receipt lookup.
  if op_type = 'MORTALITY_V1' then
    if public.resolve_selected_farm(array['admin','manager']) is distinct from target_farm then
      raise exception 'Selected farm access denied' using errcode = '42501';
    end if;
  else
    if public.resolve_selected_farm(array['admin','manager','worker']) is distinct from target_farm then
      raise exception 'Selected farm access denied' using errcode = '42501';
    end if;
  end if;
  select fm.role into target_role
  from public.farm_members fm
  where fm.farm_id = target_farm and fm.user_id = actor and fm.active;
  if target_role is null or not exists(select 1 from public.farms f where f.id=target_farm and f.active) then
    raise exception 'Farm access is no longer available' using errcode = '42501';
  end if;
  select f.status into target_status from public.flocks f where f.id=target_flock and f.farm_id=target_farm for update;
  if target_status is null then
    raise exception 'Flock does not belong to this farm' using errcode = '42501';
  end if;
  if target_status <> 'active' then
    raise exception 'Closed flock cannot receive offline operations' using errcode = '23514';
  end if;

  if op_type = 'MORTALITY_V1' then
    if not (payload ?& array['quantity','notes'])
       or jsonb_typeof(payload->'quantity') is distinct from 'number'
       or jsonb_typeof(payload->'notes') is distinct from 'string'
       or (payload->>'quantity') !~ '^[1-9][0-9]*$'
       or (payload->>'quantity')::numeric > 2000000
       or char_length(payload->>'notes') > 2000 then
      raise exception 'Invalid mortality operation payload' using errcode = '22023';
    end if;
    normalized_payload := jsonb_build_object('quantity',(payload->>'quantity')::integer,'notes',trim(payload->>'notes'));
  else
    if not (payload ?& array['eggsCollected','crackedEggs','deaths','culls','feedConsumedKg','feedTypeId','transportCost','otherCost','notes','gradeAllocations'])
       or jsonb_typeof(payload->'gradeAllocations') is distinct from 'array'
       or jsonb_typeof(payload->'notes') is distinct from 'string'
       or char_length(payload->>'notes') > 2000 then
      raise exception 'Invalid production operation payload' using errcode = '22023';
    end if;
    if coalesce((payload->>'eggsCollected')::numeric < 0, true)
       or coalesce((payload->>'crackedEggs')::numeric < 0, true)
       or coalesce((payload->>'deaths')::numeric < 0, true)
       or coalesce((payload->>'culls')::numeric < 0, true)
       or coalesce((payload->>'eggsCollected')::numeric > 2000000, true)
       or coalesce((payload->>'crackedEggs')::numeric > 2000000, true)
       or coalesce((payload->>'deaths')::numeric > 2000000, true)
       or coalesce((payload->>'culls')::numeric > 2000000, true)
       or coalesce((payload->>'eggsCollected')::numeric <> trunc((payload->>'eggsCollected')::numeric), true)
       or coalesce((payload->>'crackedEggs')::numeric <> trunc((payload->>'crackedEggs')::numeric), true)
       or coalesce((payload->>'deaths')::numeric <> trunc((payload->>'deaths')::numeric), true)
       or coalesce((payload->>'culls')::numeric <> trunc((payload->>'culls')::numeric), true)
       or (payload->>'crackedEggs')::integer > (payload->>'eggsCollected')::integer then
      raise exception 'Invalid production quantities' using errcode = '22023';
    end if;
    feed_kg := (payload->>'feedConsumedKg')::numeric;
    transport := (payload->>'transportCost')::numeric;
    other := (payload->>'otherCost')::numeric;
    if feed_kg is null or transport is null or other is null
       or feed_kg < 0 or feed_kg > 1000000 or transport < 0 or transport > 1000000000
       or other < 0 or other > 1000000000 or (feed_kg > 0 and nullif(payload->>'feedTypeId','null') is null) then
      raise exception 'Invalid production quantity or feed type' using errcode = '22023';
    end if;
    allocations := '[]'::jsonb;
    for item in select value from jsonb_array_elements(payload->'gradeAllocations') loop
      if jsonb_typeof(item) is distinct from 'object' then
        raise exception 'Invalid production grade allocation' using errcode = '22023';
      end if;
      if (select count(*) from jsonb_object_keys(item)) <> 2 or not (item ?& array['eggGradeId','quantityEggs'])
         or jsonb_typeof(item->'quantityEggs') is distinct from 'number' then
        raise exception 'Invalid production grade allocation' using errcode = '22023';
      end if;
      begin
        grade_id := (item->>'eggGradeId')::uuid;
        if (item->>'quantityEggs') !~ '^[0-9]+$' or (item->>'quantityEggs')::numeric > 2000000 then
          raise exception 'Invalid grade quantity' using errcode = '22023';
        end if;
        quantity := (item->>'quantityEggs')::integer;
      exception when others then
        raise exception 'Invalid production grade allocation' using errcode = '22023';
      end;
      if exists(select 1 from jsonb_array_elements(payload->'gradeAllocations') x(value) where x.value->>'eggGradeId'=grade_id::text group by x.value->>'eggGradeId' having count(*)>1) then
        raise exception 'Duplicate production grade allocation' using errcode = '22023';
      end if;
      total_allocated := total_allocated + quantity;
      if quantity > 0 then
        allocations := allocations || jsonb_build_array(jsonb_build_object('eggGradeId',grade_id,'quantityEggs',quantity));
      end if;
    end loop;
    if jsonb_array_length(allocations)>0 and total_allocated <> (payload->>'eggsCollected')::integer-(payload->>'crackedEggs')::integer then
      raise exception 'Grade allocations must equal good eggs' using errcode = '23514';
    end if;
    if jsonb_array_length(allocations)=0 then
      allocations := '[]'::jsonb;
    else
      select coalesce(jsonb_agg(x.value order by x.value->>'eggGradeId'),'[]'::jsonb) into allocations from jsonb_array_elements(allocations) x(value);
    end if;
    normalized_payload := jsonb_build_object(
      'eggsCollected',(payload->>'eggsCollected')::integer,
      'crackedEggs',(payload->>'crackedEggs')::integer,
      'deaths',(payload->>'deaths')::integer,
      'culls',(payload->>'culls')::integer,
      'feedConsumedKg',feed_kg,
      'feedTypeId',nullif(payload->>'feedTypeId','null')::uuid,
      'transportCost',transport,
      'otherCost',other,
      'notes',trim(payload->>'notes'),
      'gradeAllocations',allocations
    );
  end if;

  canonical := jsonb_build_object('schemaVersion',1,'operationType',op_type,'farmId',target_farm,
    'flockId',target_flock,'eventDate',event_day,'payload',normalized_payload);
  fingerprint := encode(extensions.digest(convert_to(canonical::text,'UTF8'),'sha256'),'hex');

  insert into public.desktop_sync_receipts(farm_id,operation_id,actor_user_id,operation_type,schema_version,payload_fingerprint,state)
  values(target_farm,op_id,actor,op_type,1,fingerprint,'PROCESSING')
  on conflict (farm_id,operation_id) do nothing;
  if not found then
    select * into existing from public.desktop_sync_receipts r
    where r.farm_id=target_farm and r.operation_id=op_id for update;
    if existing.actor_user_id is distinct from actor or existing.payload_fingerprint is distinct from fingerprint
       or existing.operation_type is distinct from op_type then
      return jsonb_build_object('code','OPERATION_ID_REUSED','operationId',op_id);
    end if;
    if existing.state <> 'SUCCEEDED' or existing.receipt is null then
      raise exception 'Desktop operation receipt is incomplete' using errcode = '40001';
    end if;
    return jsonb_build_object('code','ALREADY_SYNCED','operationId',op_id,'receipt',existing.receipt);
  end if;

  if op_type='MORTALITY_V1' then
    movement := public.create_bird_movement(target_flock,event_day,'death',(payload->>'quantity')::integer,'OUT',trim(payload->>'notes'));
    result := jsonb_build_object('operationId',op_id,'farmId',target_farm,'operationType',op_type,
      'schemaVersion',1,'payloadFingerprint',fingerprint,'movementId',movement.id,'flockId',target_flock,
      'eventDate',event_day,'committedAt',now());
  else
    production := public.create_daily_production_graded(
      target_flock,event_day,(payload->>'eggsCollected')::integer,(payload->>'crackedEggs')::integer,
      (payload->>'deaths')::integer,(payload->>'culls')::integer,feed_kg,
      nullif(payload->>'feedTypeId','null')::uuid,transport,other,trim(payload->>'notes'),
      case when jsonb_array_length(allocations)=0 then null else (
        select jsonb_agg(jsonb_build_object('egg_grade_id',x.value->>'eggGradeId','quantity_eggs',x.value->>'quantityEggs') order by x.value->>'eggGradeId')
        from jsonb_array_elements(allocations) x(value)
      ) end
    );
    result := jsonb_build_object('operationId',op_id,'farmId',target_farm,'operationType',op_type,
      'schemaVersion',1,'payloadFingerprint',fingerprint,'productionRecordId',production.id,
      'flockId',target_flock,'eventDate',production.production_date,'eggsCollected',production.eggs_collected,
      'crackedEggs',production.cracked_eggs,'committedAt',now());
  end if;
  update public.desktop_sync_receipts set state='SUCCEEDED',receipt=result,committed_at=now()
  where farm_id=target_farm and operation_id=op_id;
  return jsonb_build_object('code','SUCCESS','operationId',op_id,'receipt',result);
end;
$$;

revoke all on function public.sync_desktop_operation_v1(jsonb) from public, anon;
grant execute on function public.sync_desktop_operation_v1(jsonb) to authenticated;

NOTIFY pgrst, 'reload schema';
