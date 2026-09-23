-- Make Phase 4 reconciliation compare independent ledger sources and verify
-- both legs of reversed transfers. This function is read-only.
create or replace function public.get_rearing_reconciliation(target_batch uuid)
returns table(category text, expected_value numeric, actual_value numeric, difference numeric,
  reconciliation_status text, source_references jsonb)
language plpgsql stable security definer set search_path='' as $$
declare f uuid; financial boolean;
begin
  select farm_id into f from public.rearing_batches where id=target_batch;
  if f is null or not public.has_farm_role(f,array['admin','manager','worker']) then
    raise exception 'Rearing reconciliation access denied' using errcode='42501';
  end if;
  financial:=public.has_farm_role(f,array['admin','manager']);
  return query
  with batch as (
    select b.initial_quantity,p.current_birds,p.cumulative_deaths
    from public.rearing_batches b join public.v_rearing_population p on p.batch_id=b.id and p.farm_id=b.farm_id
    where b.id=target_batch and b.farm_id=f
  ), transfer_rows as (
    select t.id,t.status,t.quantity,t.total_cost_transferred,t.source_cost_before,t.remaining_cost_after,
      coalesce(sum(t.total_cost_transferred) filter(where t.status='posted') over(
        partition by t.farm_id,t.source_batch_id order by t.transfer_date,t.created_at,t.id
        rows between unbounded preceding and 1 preceding),0)::numeric prior_transferred_cost,
      sm.id source_id,sm.quantity source_quantity,sm.direction source_direction,
      dm.id destination_id,dm.quantity destination_quantity,dm.direction destination_direction,
      sr.id source_reversal_id,sr.quantity source_reversal_quantity,
      sr.direction source_reversal_direction,
      dr.id destination_reversal_id,dr.quantity destination_reversal_quantity,dr.direction dr_direction
    from public.rearing_transfers t
    left join public.rearing_movements sm on sm.id=t.source_movement_id and sm.transfer_id=t.id and sm.farm_id=t.farm_id
      and sm.rearing_batch_id=t.source_batch_id and sm.movement_type='transfer_out'
    left join public.bird_movements dm on dm.id=t.destination_movement_id and dm.rearing_transfer_id=t.id and dm.farm_id=t.farm_id
      and dm.flock_id=t.destination_flock_id and dm.movement_type='transfer_in'
    left join public.rearing_movements sr on sr.reversal_of=sm.id and sr.transfer_id=t.id and sr.movement_type='transfer_reversal'
      and sr.farm_id=t.farm_id and sr.rearing_batch_id=t.source_batch_id
    left join public.bird_movements dr on dr.rearing_transfer_id=t.id and dr.source_type='rearing_transfer'
      and dr.source_id=t.id and dr.movement_type='transfer_out' and dr.farm_id=t.farm_id and dr.flock_id=t.destination_flock_id
    where t.farm_id=f and t.source_batch_id=target_batch and t.status in('posted','reversed')
  ), transfer_check as (
    select count(*) filter(where status='posted' and (source_id is null or destination_id is null
        or source_quantity<>quantity or destination_quantity<>quantity or source_direction<>'OUT' or destination_direction<>'IN'
        or round(source_cost_before-prior_transferred_cost-total_cost_transferred,2)<>remaining_cost_after))::integer bad_posted,
      count(*) filter(where status='reversed' and (source_id is null or destination_id is null
        or source_quantity<>quantity or destination_quantity<>quantity or source_reversal_id is null or destination_reversal_id is null
        or source_reversal_quantity<>quantity or source_reversal_direction<>'IN' or destination_reversal_quantity<>quantity
        or dr_direction<>'OUT'))::integer bad_reversed,
      coalesce(sum(quantity) filter(where status='posted'),0)::numeric posted_birds,
      coalesce(sum(source_quantity) filter(where status='posted'),0)::numeric source_birds,
      coalesce(sum(destination_quantity) filter(where status='posted'),0)::numeric destination_birds,
      coalesce(sum(total_cost_transferred) filter(where status='posted'),0)::numeric posted_cost,
      coalesce(sum(source_cost_before-prior_transferred_cost-remaining_cost_after) filter(where status='posted'),0)::numeric source_pool_reduction,
      coalesce(jsonb_agg(id) filter(where status='posted' and (source_id is null or destination_id is null
        or source_quantity<>quantity or destination_quantity<>quantity or round(source_cost_before-prior_transferred_cost-total_cost_transferred,2)<>remaining_cost_after)
        or status='reversed' and (source_reversal_id is null or destination_reversal_id is null
          or source_reversal_quantity<>quantity or source_reversal_direction<>'IN'
          or destination_reversal_quantity<>quantity or dr_direction<>'OUT')), '[]'::jsonb) bad_ids
    from transfer_rows
  ), mortality as (
    select coalesce(sum(quantity) filter(where movement_type='death'),0)::numeric gross,
      coalesce(sum(quantity) filter(where movement_type='reversal'),0)::numeric reversed
    from public.rearing_movements where farm_id=f and rearing_batch_id=target_batch
  ), daily_mortality as (
    select coalesce(sum(deaths),0)::numeric quantity from public.rearing_daily_records
    where farm_id=f and rearing_batch_id=target_batch
  ), feed as (
    select coalesce(sum(c.quantity_kg),0)::numeric linked_quantity,
      coalesce(sum(m.quantity_kg) filter(where m.movement_type='consumption' and m.direction='OUT'),0)::numeric ledger_quantity,
      coalesce(sum(round(m.unit_cost_snapshot*c.quantity_kg,2)),0)::numeric calculated_cost,
      coalesce(sum(m.total_cost_snapshot),0)::numeric snapshot_cost,
      count(*) filter(where m.id is null or m.movement_type<>'consumption' or m.direction<>'OUT'
        or m.unit_cost_snapshot is null or m.total_cost_snapshot is null)::integer incomplete
    from public.rearing_feed_consumptions c left join public.feed_inventory_movements m
      on m.id=c.movement_id and m.farm_id=c.farm_id
    where c.farm_id=f and c.rearing_batch_id=target_batch and c.active
  ), expense_cost as (
    select coalesce(sum(e.amount),0)::numeric total,
      coalesce(sum(e.amount) filter(where e.rearing_cost_kind='acquisition'),0)::numeric acquisition,
      coalesce(sum(e.amount) filter(where e.rearing_cost_kind='health'),0)::numeric health,
      coalesce(sum(e.amount) filter(where e.rearing_cost_kind='other_direct'),0)::numeric other_direct,
      count(*) filter(where e.rearing_cost_kind='acquisition')::integer acquisition_sources
    from public.expenses e where e.farm_id=f and e.rearing_batch_id=target_batch and e.status='active'
  ), health_check as (
    select coalesce(sum(h.cost),0)::numeric health_records_cost,
      coalesce(sum(e.amount),0)::numeric linked_expense_cost,
      count(*) filter(where h.cost>0 and e.id is null)::integer missing_source
    from public.health_records h left join public.expenses e on e.farm_id=h.farm_id and e.source_type='health_record'
      and e.source_id=h.id and e.source_key='health_cost' and e.status='active'
    where h.farm_id=f and h.rearing_batch_id=target_batch and h.status='active'
  ), cost_totals as (
    select feed.snapshot_cost+expense_cost.total::numeric source_total,
      public.rearing_cost_total_at(target_batch,(now() at time zone fa.timezone)::date)::numeric function_total,
      coalesce(transfer_check.posted_cost,0)::numeric transferred
    from public.farms fa cross join feed cross join expense_cost cross join transfer_check where fa.id=f
  ), population_check as (
    select b.initial_quantity::numeric initial,
      (b.initial_quantity+coalesce((select sum(case when m.direction='IN' then m.quantity else -m.quantity end)
        from public.rearing_movements m where m.farm_id=f and m.rearing_batch_id=target_batch
          and m.movement_type<>'arrival'),0))::numeric expected,
      b.current_birds::numeric actual
    from batch b cross join transfer_check
  ), checks as (
    select 'population'::text cat,pc.expected exp,pc.actual act,
      case when pc.expected=pc.actual and pc.actual>=0 then 'RECONCILED' else 'DISCREPANCY' end st,
      jsonb_build_array(target_batch) refs from population_check pc
    union all
    select 'mortality',mortality.gross-mortality.reversed,daily_mortality.quantity,
      case when mortality.gross-mortality.reversed=daily_mortality.quantity then 'RECONCILED' else 'DISCREPANCY' end,
      jsonb_build_array(target_batch) from mortality cross join daily_mortality
    union all
    select 'feed_quantity',feed.linked_quantity,feed.ledger_quantity,
      case when feed.incomplete>0 then 'INSUFFICIENT SOURCE DATA'
        when feed.linked_quantity=feed.ledger_quantity then 'RECONCILED' else 'DISCREPANCY' end,
      jsonb_build_object('missing_or_invalid_movement_count',feed.incomplete) from feed
    union all
    select 'feed_cost',case when financial then feed.calculated_cost else null end,
      case when financial then feed.snapshot_cost else null end,
      case when not financial then 'NOT APPLICABLE' when feed.incomplete>0 then 'INSUFFICIENT SOURCE DATA'
        when feed.calculated_cost=feed.snapshot_cost then 'RECONCILED' else 'DISCREPANCY' end,
      jsonb_build_object('missing_or_invalid_snapshot_count',feed.incomplete) from feed
    union all
    select 'health_cost_attribution',case when financial then health_check.health_records_cost else null end,
      case when financial then health_check.linked_expense_cost else null end,
      case when not financial then 'NOT APPLICABLE' when health_check.missing_source>0 then 'INSUFFICIENT SOURCE DATA'
        when health_check.health_records_cost=health_check.linked_expense_cost then 'RECONCILED' else 'DISCREPANCY' end,
      jsonb_build_object('missing_expense_source_count',health_check.missing_source) from health_check
    union all
    select 'historical_rearing_cost',case when financial then costs.source_total else null end,
      case when financial then costs.function_total else null end,
      case when not financial then 'NOT APPLICABLE' when cost_sources.reconciliation_status='INSUFFICIENT SOURCE DATA' then 'INSUFFICIENT SOURCE DATA'
        when costs.source_total=costs.function_total then 'RECONCILED' else 'DISCREPANCY' end,
      jsonb_build_object('cost_source_status',(select jsonb_object_agg(x.category,x.reconciliation_status) from public.get_rearing_cost_source_status(target_batch) x))
      from cost_totals costs cross join lateral (select case when exists(select 1 from public.get_rearing_cost_source_status(target_batch) x where x.reconciliation_status='INSUFFICIENT SOURCE DATA') then 'INSUFFICIENT SOURCE DATA' else 'RECONCILED' end reconciliation_status) cost_sources
    union all
    select 'transferred_cost',case when financial then transfer_check.source_pool_reduction else null end,
      case when financial then transfer_check.posted_cost else null end,
      case when not financial then 'NOT APPLICABLE' when transfer_check.bad_posted>0 then 'DISCREPANCY'
        when transfer_check.source_pool_reduction=transfer_check.posted_cost then 'RECONCILED' else 'DISCREPANCY' end,
      transfer_check.bad_ids from transfer_check
    union all
    select 'remaining_rearing_cost',case when financial then costs.source_total-costs.transferred else null end,
      case when financial then costs.function_total-costs.transferred else null end,
      case when not financial then 'NOT APPLICABLE'
        when cost_sources.reconciliation_status='INSUFFICIENT SOURCE DATA' then 'INSUFFICIENT SOURCE DATA'
        when costs.source_total<costs.transferred or costs.function_total<costs.transferred then 'DISCREPANCY'
        when costs.source_total=costs.function_total then 'RECONCILED' else 'DISCREPANCY' end,
      jsonb_build_array(target_batch) from cost_totals costs cross join lateral (select case when exists(select 1 from public.get_rearing_cost_source_status(target_batch) x where x.reconciliation_status='INSUFFICIENT SOURCE DATA') then 'INSUFFICIENT SOURCE DATA' else 'RECONCILED' end reconciliation_status) cost_sources
    union all
    select 'source_destination_transfer_movements',transfer_check.posted_birds,
      case when transfer_check.source_birds=transfer_check.destination_birds then transfer_check.source_birds else null end,
      case when transfer_check.bad_posted>0 or transfer_check.source_birds<>transfer_check.posted_birds
        or transfer_check.destination_birds<>transfer_check.posted_birds then 'DISCREPANCY' else 'RECONCILED' end,
      transfer_check.bad_ids from transfer_check
    union all
    select 'transfer_reversals',transfer_check.bad_reversed::numeric,0::numeric,
      case when transfer_check.bad_reversed=0 then 'RECONCILED' else 'DISCREPANCY' end,
      transfer_check.bad_ids from transfer_check
  )
  select cat,exp,act,case when exp is null or act is null then null else act-exp end,st,refs from checks;
end; $$;

revoke all on function public.get_rearing_reconciliation(uuid) from public,anon;
grant execute on function public.get_rearing_reconciliation(uuid) to authenticated;
