-- DOC Phase 4 completion: one role-shaped, source-backed lifecycle snapshot.
-- Event dates are effective dates; approved reversals/corrections therefore
-- flow into the effective period while their audit timestamps remain intact.
create or replace function public.get_rearing_lifecycle_as_of(target_batch uuid, target_date date)
returns table(
  batch_id uuid, as_of_date date, initial_birds integer, deaths integer,
  transferred_birds integer, remaining_birds integer, survival_rate numeric,
  feed_consumed_kg numeric, feed_cost numeric, acquisition_cost numeric,
  health_cost numeric, other_direct_cost numeric, historical_cost numeric,
  transferred_cost numeric, remaining_cost numeric, cost_per_remaining_bird numeric,
  cost_complete boolean
)
language plpgsql stable security definer set search_path='' as $$
declare
  f uuid;
  arrival date;
  farm_today date;
  financial boolean;
begin
  select b.farm_id,b.arrival_date,(now() at time zone fa.timezone)::date
    into f,arrival,farm_today
  from public.rearing_batches b join public.farms fa on fa.id=b.farm_id
  where b.id=target_batch;
  if f is null or not public.has_farm_role(f,array['admin','manager','worker']) then
    raise exception 'Rearing lifecycle report access denied' using errcode='42501';
  end if;
  if target_date is null or target_date<arrival or target_date>farm_today then
    raise exception 'Choose an as-of date from batch arrival through today' using errcode='22023';
  end if;
  financial:=public.has_farm_role(f,array['admin','manager']);
  return query
  with population as (
    select b.initial_quantity,
      coalesce(sum(case when m.direction='IN' then m.quantity else -m.quantity end),0)::integer remaining,
      coalesce(sum(m.quantity) filter(where m.movement_type='death'),0)::integer gross_deaths,
      coalesce(sum(m.quantity) filter(where m.movement_type='reversal'),0)::integer death_reversals
    from public.rearing_batches b left join public.rearing_movements m
      on m.farm_id=b.farm_id and m.rearing_batch_id=b.id and m.movement_date<=target_date
    where b.id=target_batch and b.farm_id=f group by b.initial_quantity
  ), transfers as (
    select coalesce(sum(t.quantity) filter(where t.status='posted'),0)::integer birds,
      coalesce(sum(t.total_cost_transferred) filter(where t.status='posted'),0)::numeric cost
    from public.rearing_transfers t
    where t.farm_id=f and t.source_batch_id=target_batch and t.transfer_date<=target_date
  ), feed as (
    select coalesce(sum(c.quantity_kg),0)::numeric kg,
      coalesce(sum(m.total_cost_snapshot),0)::numeric cost,
      bool_and(m.id is not null and m.total_cost_snapshot is not null) complete
    from public.rearing_feed_consumptions c left join public.feed_inventory_movements m
      on m.id=c.movement_id and m.farm_id=c.farm_id
    where c.farm_id=f and c.rearing_batch_id=target_batch and c.active and c.consumption_date<=target_date
  ), expense_costs as (
    select coalesce(sum(e.amount) filter(where e.rearing_cost_kind='acquisition'),0)::numeric acquisition,
      coalesce(sum(e.amount) filter(where e.rearing_cost_kind='health'),0)::numeric health,
      coalesce(sum(e.amount) filter(where e.rearing_cost_kind='other_direct'),0)::numeric other_cost,
      bool_or(e.rearing_cost_kind='acquisition') has_acquisition
    from public.expenses e
    where e.farm_id=f and e.rearing_batch_id=target_batch and e.status='active' and e.expense_date<=target_date
  ), health_sources as (
    select not exists(
      select 1 from public.health_records h
      where h.farm_id=f and h.rearing_batch_id=target_batch and h.status='active'
        and h.record_date<=target_date and h.cost>0
        and not exists(select 1 from public.expenses e where e.farm_id=f and e.source_type='health_record'
          and e.source_id=h.id and e.source_key='health_cost' and e.status='active' and e.expense_date<=target_date)
    ) valid
  )
  select target_batch,target_date,p.initial_quantity,
    greatest(p.gross_deaths-p.death_reversals,0),t.birds,p.remaining,
    case when p.initial_quantity>0 then round((p.remaining+t.birds)::numeric*100/p.initial_quantity,2) else null end,
    feed.kg,case when financial then feed.cost else null end,
    case when financial then ec.acquisition else null end,
    case when financial then ec.health else null end,
    case when financial then ec.other_cost else null end,
    case when financial then public.rearing_cost_total_at(target_batch,target_date) else null end,
    case when financial then t.cost else null end,
    case when financial then round(public.rearing_cost_total_at(target_batch,target_date)-t.cost,2) else null end,
    case when financial and p.remaining>0 then round((public.rearing_cost_total_at(target_batch,target_date)-t.cost)/p.remaining,2) else null end,
    case when not financial then false else coalesce(ec.has_acquisition,false) and coalesce(feed.complete,true) and hs.valid end
  from population p cross join transfers t cross join feed cross join expense_costs ec cross join health_sources hs;
end; $$;

revoke all on function public.get_rearing_lifecycle_as_of(uuid,date) from public,anon;
grant execute on function public.get_rearing_lifecycle_as_of(uuid,date) to authenticated;

comment on function public.get_rearing_lifecycle_as_of(uuid,date) is
  'Role-shaped DOC lifecycle snapshot from effective-dated authoritative ledgers. Worker financial fields are NULL.';
