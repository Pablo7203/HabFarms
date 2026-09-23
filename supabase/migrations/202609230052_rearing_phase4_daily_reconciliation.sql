-- Keep daily movement reconciliation additive and source-backed, including
-- the compensating inbound movement created by audited reversals.
create or replace function public.get_rearing_daily_report(
  target_batch uuid, target_from date, target_to date
) returns table(
  report_date date, opening_birds integer, inbound_birds integer, deaths integer,
  transfers_out integer, other_outbound integer, closing_birds integer,
  daily_record_status text, observations text, feed_consumed_kg numeric,
  feed_cost numeric, feed_products jsonb, completed_health_activities integer,
  scheduled_health_activities integer, attributable_cost numeric
) language plpgsql stable security definer set search_path='' as $$
declare f uuid; can_see_financial boolean;
begin
  select b.farm_id into f from public.rearing_batches b where b.id=target_batch;
  if f is null or not public.has_farm_role(f,array['admin','manager','worker']) then
    raise exception 'Rearing report access denied' using errcode='42501';
  end if;
  if target_from is null or target_to is null or target_to<target_from or target_to-target_from>365 then
    raise exception 'Choose a valid reporting range of at most 366 days' using errcode='22023';
  end if;
  can_see_financial:=public.has_farm_role(f,array['admin','manager']);
  return query
  with dates as (
    select g::date d from generate_series(target_from::timestamp,target_to::timestamp,interval '1 day') g
  ), movement_daily as (
    select m.movement_date d,
      sum(m.quantity) filter(where m.direction='IN')::integer inbound,
      sum(m.quantity) filter(where m.movement_type='death')::integer deaths,
      sum(m.quantity) filter(where m.movement_type='transfer_out')::integer transfers,
      sum(m.quantity) filter(where m.direction='OUT' and m.movement_type not in('death','transfer_out'))::integer other_out
    from public.rearing_movements m where m.farm_id=f and m.rearing_batch_id=target_batch
      and m.movement_date between target_from and target_to group by m.movement_date
  ), daily_rows as (
    select d.d,coalesce(md.inbound,0) inbound,coalesce(md.deaths,0) deaths,
      coalesce(md.transfers,0) transfers,coalesce(md.other_out,0) other_out,
      coalesce((select sum(case when m.direction='IN' then m.quantity else -m.quantity end)
        from public.rearing_movements m where m.farm_id=f and m.rearing_batch_id=target_batch and m.movement_date<d.d),0)::integer opening,
      coalesce((select sum(case when m.direction='IN' then m.quantity else -m.quantity end)
        from public.rearing_movements m where m.farm_id=f and m.rearing_batch_id=target_batch and m.movement_date<=d.d),0)::integer closing,
      dr.id record_id,dr.observations
    from dates d left join movement_daily md on md.d=d.d
      left join public.rearing_daily_records dr on dr.farm_id=f and dr.rearing_batch_id=target_batch and dr.record_date=d.d
  ), feed_daily as (
    select c.consumption_date d,sum(c.quantity_kg)::numeric qty,sum(m.total_cost_snapshot)::numeric cost,
      jsonb_agg(jsonb_build_object('feed_type_id',c.feed_type_id,'product',ft.name,'quantity_kg',c.quantity_kg,
        'cost',case when can_see_financial then m.total_cost_snapshot else null end) order by ft.name,c.id) products
    from public.rearing_feed_consumptions c join public.feed_inventory_movements m on m.id=c.movement_id and m.farm_id=c.farm_id
      join public.feed_types ft on ft.id=c.feed_type_id and ft.farm_id=c.farm_id
    where c.farm_id=f and c.rearing_batch_id=target_batch and c.active and c.consumption_date between target_from and target_to
    group by c.consumption_date
  ), health_daily as (
    select h.record_date d,count(*) filter(where h.status='active')::integer completed
    from public.health_records h where h.farm_id=f and h.rearing_batch_id=target_batch and h.record_date between target_from and target_to
    group by h.record_date
  ), reminders_daily as (
    select h.due_date d,count(*) filter(where h.status in('pending','scheduled','overdue'))::integer scheduled
    from public.health_reminders h where h.farm_id=f and h.rearing_batch_id=target_batch and h.due_date between target_from and target_to
    group by h.due_date
  ), expense_daily as (
    select e.expense_date d,sum(e.amount)::numeric amount from public.expenses e
    where e.farm_id=f and e.rearing_batch_id=target_batch and e.status='active' and e.expense_date between target_from and target_to
    group by e.expense_date
  )
  select r.d,r.opening,r.inbound,r.deaths,r.transfers,r.other_out,r.closing,
    case when r.record_id is null then 'missing' else 'submitted' end,r.observations,
    coalesce(fd.qty,0),case when can_see_financial then fd.cost else null end,coalesce(fd.products,'[]'::jsonb),
    coalesce(hd.completed,0),coalesce(rd.scheduled,0),
    case when can_see_financial then coalesce(fd.cost,0)+coalesce(ed.amount,0) else null end
  from daily_rows r left join feed_daily fd on fd.d=r.d left join health_daily hd on hd.d=r.d
    left join reminders_daily rd on rd.d=r.d left join expense_daily ed on ed.d=r.d
  order by r.d;
end; $$;
