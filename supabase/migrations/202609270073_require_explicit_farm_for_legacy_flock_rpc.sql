-- Remove the temporary single-farm compatibility fallback from migration 072.
-- All supported application callers now send their validated farm context.
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
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  raise exception 'Explicit farm selection is required; choose an active farm in HabFarms' using errcode='22023';
end;
$$;

revoke all on function public.create_flock(text,text,text,text,date,integer,integer,text,text) from public,anon;
grant execute on function public.create_flock(text,text,text,text,date,integer,integer,text,text) to authenticated;
