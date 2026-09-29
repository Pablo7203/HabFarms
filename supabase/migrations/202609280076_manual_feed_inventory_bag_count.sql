alter table public.feed_types
  add column inventory_bag_count integer
  check (inventory_bag_count is null or inventory_bag_count >= 0);

create function public.set_feed_inventory_bag_count(target_feed_type uuid, bag_count integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  farm uuid;
begin
  farm := public.feed_access_farm(array['admin', 'manager']);

  update public.feed_types
  set inventory_bag_count = $2,
      updated_by = auth.uid(),
      updated_at = now()
  where id = $1
    and farm_id = farm;

  if not found then
    raise exception 'Feed type not found for the active farm'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.set_feed_inventory_bag_count(uuid, integer) from public;
grant execute on function public.set_feed_inventory_bag_count(uuid, integer) to authenticated;
