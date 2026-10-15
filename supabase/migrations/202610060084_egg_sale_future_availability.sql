-- Include any dated future stock movements: the sale posting guard checks
-- every recorded closing balance from the sale date onward.
create or replace function public.get_egg_sale_stock_availability(target_date date)
returns table(egg_grade_id uuid, stock_on_date bigint, stock_today bigint, sellable_on_date bigint)
language sql stable security invoker set search_path = '' as $$
  with authorized_grades as (
    select g.id, (now() at time zone f.timezone)::date as today
    from public.egg_grades g
    join public.farms f on f.id = g.farm_id
    where g.is_active and public.has_farm_role(g.farm_id, array['admin', 'manager'])
  ), daily as (
    select g.id, m.movement_date,
      sum(case when m.direction = 'IN' then m.quantity_eggs else -m.quantity_eggs end)::bigint as delta
    from authorized_grades g
    join public.egg_inventory_movements m on m.egg_grade_id = g.id
    group by g.id, m.movement_date
  ), closing as (
    select id, movement_date,
      sum(delta) over (partition by id order by movement_date)::bigint as balance
    from daily
  )
  select g.id,
    coalesce((select sum(d.delta) from daily d
      where d.id = g.id and d.movement_date <= target_date), 0)::bigint,
    coalesce((select sum(d.delta) from daily d
      where d.id = g.id and d.movement_date <= g.today), 0)::bigint,
    greatest(0, least(
      coalesce((select sum(d.delta) from daily d
        where d.id = g.id and d.movement_date <= target_date), 0),
      coalesce((select min(c.balance) from closing c
        where c.id = g.id and c.movement_date >= target_date),
        (select coalesce(sum(d.delta), 0) from daily d
          where d.id = g.id and d.movement_date <= target_date))
    ))::bigint
  from authorized_grades g;
$$;
