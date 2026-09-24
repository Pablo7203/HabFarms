-- Admin-only, audited correction of a flock's opening population and start date.
-- Current live population remains derived from initial_birds + dated movements.

create or replace function public.update_flock(
  target_flock_id uuid,flock_name text,batch_reference text,breed text,house_pen text,
  start_date date,age_at_arrival_weeks integer,source text,status text,notes text
) returns public.flocks language plpgsql security definer set search_path='' as $$
declare target_farm uuid; prior_start_date date; updated public.flocks;
begin
  select f.farm_id,f.start_date into target_farm,prior_start_date
  from public.flocks f where f.id=target_flock_id for update;
  if target_farm is null or not public.has_farm_role(target_farm,array['admin','manager']) then
    raise exception 'Flock access denied' using errcode='42501';
  end if;
  if start_date is distinct from prior_start_date then
    raise exception 'Use the admin flock correction workflow to change the flock start date' using errcode='42501';
  end if;
  update public.flocks set
    flock_name=trim(update_flock.flock_name),
    batch_reference=nullif(trim(update_flock.batch_reference),''),
    breed=nullif(trim(update_flock.breed),''),
    house_pen=nullif(trim(update_flock.house_pen),''),
    age_at_arrival_weeks=update_flock.age_at_arrival_weeks,
    source=nullif(trim(update_flock.source),''),
    status=update_flock.status,
    notes=nullif(trim(update_flock.notes),''),
    updated_by=auth.uid()
  where id=target_flock_id returning * into updated;
  return updated;
end; $$;

create function public.admin_update_flock(
  target_flock_id uuid,expected_initial_birds integer,expected_start_date date,
  flock_name text,batch_reference text,breed text,house_pen text,
  new_start_date date,new_initial_birds integer,age_at_arrival_weeks integer,
  source text,status text,notes text,correction_reason text
) returns public.flocks language plpgsql security definer set search_path='' as $$
declare
  existing public.flocks;
  updated public.flocks;
  farm_timezone text;
  baseline_changed boolean;
  date_changed boolean;
  reason text:=trim(coalesce(correction_reason,''));
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select f.* into existing from public.flocks f where f.id=target_flock_id for update;
  if existing.id is null or not public.has_farm_role(existing.farm_id,array['admin']) then
    raise exception 'Farm admin access required to correct flock opening details' using errcode='42501';
  end if;
  if existing.initial_birds is distinct from expected_initial_birds or existing.start_date is distinct from expected_start_date then
    raise exception 'Flock opening details changed since this page was opened. Reload and review the latest values.' using errcode='40001';
  end if;
  if char_length(trim(coalesce(flock_name,''))) not between 2 and 120
    or char_length(coalesce(batch_reference,''))>120
    or char_length(coalesce(breed,''))>120
    or char_length(coalesce(house_pen,''))>120
    or char_length(coalesce(source,''))>120
    or char_length(coalesce(notes,''))>2000
    or new_initial_birds is null or new_initial_birds<0
    or (new_initial_birds=0 and not existing.population_is_transfer_only)
    or (age_at_arrival_weeks is not null and age_at_arrival_weeks<0)
    or status not in('active','closed','sold','culled') then
    raise exception 'Enter valid flock details and a non-negative whole opening bird count' using errcode='23514';
  end if;
  select f.timezone into farm_timezone from public.farms f where f.id=existing.farm_id;
  if new_start_date is null or new_start_date>(now() at time zone farm_timezone)::date then
    raise exception 'Flock start date cannot be in the future' using errcode='23514';
  end if;

  baseline_changed:=new_initial_birds is distinct from existing.initial_birds;
  date_changed:=new_start_date is distinct from existing.start_date;
  if (baseline_changed or date_changed) and char_length(reason)<5 then
    raise exception 'Provide a correction reason (at least 5 characters) when changing opening birds or start date' using errcode='23514';
  end if;
  if date_changed and (
    exists(select 1 from public.bird_movements m where m.flock_id=existing.id and m.movement_date<new_start_date)
    or exists(select 1 from public.daily_production_records p where p.flock_id=existing.id and p.production_date<new_start_date)
    or exists(select 1 from public.feed_inventory_movements m where m.flock_id=existing.id and m.movement_date<new_start_date)
    or exists(select 1 from public.health_records h where h.flock_id=existing.id and h.record_date<new_start_date)
  ) then
    raise exception 'Start date cannot move past existing flock activity. Choose a date on or before the earliest recorded activity.' using errcode='23514';
  end if;

  update public.flocks set
    flock_name=trim(admin_update_flock.flock_name),
    batch_reference=nullif(trim(admin_update_flock.batch_reference),''),
    breed=nullif(trim(admin_update_flock.breed),''),
    house_pen=nullif(trim(admin_update_flock.house_pen),''),
    start_date=new_start_date,
    initial_birds=new_initial_birds,
    age_at_arrival_weeks=admin_update_flock.age_at_arrival_weeks,
    source=nullif(trim(admin_update_flock.source),''),
    status=admin_update_flock.status,
    notes=nullif(trim(admin_update_flock.notes),''),
    updated_by=auth.uid()
  where id=existing.id returning * into updated;

  if baseline_changed then perform public.assert_nonnegative_flock_history(existing.id); end if;
  if baseline_changed or date_changed then
    insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
    values(existing.farm_id,auth.uid(),'flocks.opening_details_corrected','flocks',existing.id,
      'Flock opening population or start date corrected',
      jsonb_build_object(
        'previous_initial_birds',existing.initial_birds,
        'new_initial_birds',new_initial_birds,
        'previous_start_date',existing.start_date,
        'new_start_date',new_start_date,
        'reason',reason,
        'historical_population_revalidated',baseline_changed
      ));
  end if;
  return updated;
end; $$;

revoke all on function public.admin_update_flock(uuid,integer,date,text,text,text,text,date,integer,integer,text,text,text,text) from public,anon;
grant execute on function public.admin_update_flock(uuid,integer,date,text,text,text,text,date,integer,integer,text,text,text,text) to authenticated;
