create function public.validate_farm_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.timezone is distinct from old.timezone) then
    if not exists (
       select 1
       from pg_catalog.pg_timezone_names
       where name = new.timezone
    ) then
      raise exception 'Invalid timezone. Use a valid IANA timezone, such as Africa/Lagos.'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger farms_validate_timezone
before insert or update of timezone on public.farms
for each row execute function public.validate_farm_timezone();
