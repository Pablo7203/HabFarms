-- Resolve flock creation against the farm selected by the authenticated app
-- context. The caller-provided farm ID is never authorization by itself.
-- Rollback strategy: keep this forward-only authorization fix. Older clients
-- can still use the nine-argument overload for a single eligible farm; for a
-- multi-farm user it fails closed until the explicit-context app is restored.

create or replace function public.create_flock(
  target_farm_id uuid,
  flock_name text,
  batch_reference text,
  breed text,
  house_pen text,
  start_date date,
  initial_birds integer,
  age_at_arrival_weeks integer,
  source text,
  notes text
) returns public.flocks
language plpgsql security definer set search_path=''
as $$
declare created public.flocks;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if target_farm_id is null
    or not public.has_farm_role(target_farm_id,array['admin','manager'])
    or not exists(select 1 from public.farms where id=target_farm_id and active)
  then
    raise exception 'Admin or manager access required for the selected farm' using errcode='42501';
  end if;
  if initial_birds is null or initial_birds<=0 then
    raise exception 'A directly acquired flock must start with a positive bird count' using errcode='23514';
  end if;

  -- initial_birds is the authoritative opening population baseline. Do not
  -- add an opening bird movement, which would count the same birds twice.
  insert into public.flocks(
    farm_id,flock_name,batch_reference,breed,house_pen,start_date,initial_birds,
    age_at_arrival_weeks,source,notes,created_by
  ) values (
    target_farm_id,trim(flock_name),nullif(trim(batch_reference),''),nullif(trim(breed),''),
    nullif(trim(house_pen),''),start_date,initial_birds,age_at_arrival_weeks,
    nullif(trim(source),''),nullif(trim(notes),''),auth.uid()
  ) returning * into created;

  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
  values (
    target_farm_id,auth.uid(),'flock.created','flocks',created.id,'Flock created',
    jsonb_build_object('flock_name',created.flock_name,'initial_birds',created.initial_birds,'start_date',created.start_date)
  );
  return created;
end;
$$;

-- Keep the old RPC callable for already-running single-farm clients, but never
-- guess a destination when the user has more than one eligible farm.
create or replace function public.create_flock(
  flock_name text,
  batch_reference text,
  breed text,
  house_pen text,
  start_date date,
  initial_birds integer,
  age_at_arrival_weeks integer,
  source text,
  notes text
) returns public.flocks
language plpgsql security definer set search_path=''
as $$
declare eligible_farms integer; target_farm uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  select count(*) into eligible_farms
  from public.farm_members m
  where m.user_id=auth.uid() and m.active and m.role in ('admin','manager')
    and public.has_farm_role(m.farm_id,array['admin','manager']);

  if eligible_farms=0 then
    raise exception 'Admin or manager access required' using errcode='42501';
  end if;
  if eligible_farms>1 then
    raise exception 'Explicit farm selection is required for multi-farm flock creation' using errcode='42501';
  end if;

  select m.farm_id into target_farm
  from public.farm_members m
  where m.user_id=auth.uid() and m.active and m.role in ('admin','manager')
    and public.has_farm_role(m.farm_id,array['admin','manager'])
  limit 1;

  return public.create_flock(
    target_farm,flock_name,batch_reference,breed,house_pen,start_date,
    initial_birds,age_at_arrival_weeks,source,notes
  );
end;
$$;

revoke all on function public.create_flock(uuid,text,text,text,text,date,integer,integer,text,text) from public,anon;
grant execute on function public.create_flock(uuid,text,text,text,text,date,integer,integer,text,text) to authenticated;
revoke all on function public.create_flock(text,text,text,text,date,integer,integer,text,text) from public,anon;
grant execute on function public.create_flock(text,text,text,text,date,integer,integer,text,text) to authenticated;
