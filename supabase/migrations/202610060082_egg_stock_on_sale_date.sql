-- Show the selected day's closing egg balance alongside today's balance on the sale form.
-- The sale RPC remains responsible for rejecting a backdated sale that would make
-- any later daily balance negative.
create or replace function public.get_egg_sale_stock_comparison(target_date date)
returns table(egg_grade_id uuid, stock_on_date bigint, stock_today bigint)
language sql stable security invoker set search_path = '' as $$
  select g.id,
    coalesce(sum(case when m.movement_date <= target_date then
      case when m.direction = 'IN' then m.quantity_eggs else -m.quantity_eggs end
    end), 0)::bigint,
    coalesce(sum(case when m.movement_date <= (now() at time zone f.timezone)::date then
      case when m.direction = 'IN' then m.quantity_eggs else -m.quantity_eggs end
    end), 0)::bigint
  from public.egg_grades g
  join public.farms f on f.id = g.farm_id
  left join public.egg_inventory_movements m
    on m.farm_id = g.farm_id and m.egg_grade_id = g.id
  where g.is_active and public.has_farm_role(g.farm_id, array['admin', 'manager'])
  group by g.id;
$$;

revoke all on function public.get_egg_sale_stock_comparison(date) from public, anon;
grant execute on function public.get_egg_sale_stock_comparison(date) to authenticated, service_role;
