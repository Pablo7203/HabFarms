-- Require an auditable explanation for all flock population adjustments,
-- including direct RPC callers that do not use the browser form.
create or replace function public.create_bird_movement(
  target_flock_id uuid,movement_date date,movement_type text,quantity integer,direction text,notes text default null
) returns public.bird_movements language plpgsql security definer set search_path='' as $$
declare target_farm uuid; created public.bird_movements;
begin
  select f.farm_id into target_farm from public.flocks f where f.id=target_flock_id for update;
  if target_farm is null or not public.has_farm_role(target_farm,array['admin','manager']) then
    raise exception 'Bird movement access denied' using errcode='42501';
  end if;
  if movement_type='adjustment' and char_length(trim(coalesce(notes,'')))<5 then
    raise exception 'Adjustment movement requires a reason of at least 5 characters' using errcode='23514';
  end if;
  insert into public.bird_movements(farm_id,flock_id,movement_date,movement_type,quantity,direction,notes,created_by)
  values(target_farm,target_flock_id,movement_date,movement_type,quantity,upper(direction),nullif(trim(notes),''),auth.uid())
  returning * into created;
  perform public.assert_nonnegative_flock_history(target_flock_id);
  return created;
end; $$;

revoke all on function public.create_bird_movement(uuid,date,text,integer,text,text) from public,anon;
grant execute on function public.create_bird_movement(uuid,date,text,integer,text,text) to authenticated;
