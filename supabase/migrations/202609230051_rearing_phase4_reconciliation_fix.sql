-- Phase 4 reconciliation follow-up: use the transfer reconciliation view's
-- actual column name and compare mortality ledger movements to daily records.
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
  ), movement as (
    select coalesce(sum(case when direction='IN' then quantity else -quantity end),0)::numeric current_value,
      coalesce(sum(quantity) filter(where movement_type='death'),0)::numeric gross_deaths,
      coalesce(sum(quantity) filter(where movement_type='reversal'),0)::numeric death_reversals,
      bool_and(running_birds>=0) nonnegative
    from public.v_rearing_population_history where rearing_batch_id=target_batch and farm_id=f
  ), transfer as (
    select coalesce(sum(transfer_quantity) filter(where status='posted'),0)::numeric valid_birds,
      count(*) filter(where status='posted' and not coalesce(reconciles,false)) bad_count,
      coalesce(jsonb_agg(transfer_id) filter(where status='posted' and not coalesce(reconciles,false)),'[]'::jsonb) bad_ids
    from public.v_rearing_transfer_reconciliation where source_batch_id=target_batch and farm_id=f
  ), daily_mortality as (
    select coalesce(sum(deaths),0)::numeric quantity from public.rearing_daily_records
    where farm_id=f and rearing_batch_id=target_batch
  ), feed as (
    select coalesce(sum(c.quantity_kg),0)::numeric qty,
      coalesce(sum(m.quantity_kg) filter(where m.movement_type='consumption' and m.direction='OUT'),0)::numeric ledger_qty,
      coalesce(sum(m.total_cost_snapshot),0)::numeric cost,
      count(*) filter(where m.total_cost_snapshot is null)::integer missing_costs
    from public.rearing_feed_consumptions c join public.feed_inventory_movements m on m.id=c.movement_id and m.farm_id=c.farm_id
    where c.farm_id=f and c.rearing_batch_id=target_batch and c.active
  ), costs as (
    select public.rearing_cost_total_at(target_batch,(now() at time zone fa.timezone)::date)::numeric historical,
      coalesce((select sum(t.total_cost_transferred) from public.rearing_transfers t where t.farm_id=f and t.source_batch_id=target_batch and t.status='posted'),0)::numeric transferred
    from public.farms fa where fa.id=f
  ), checks as (
    select 'population'::text cat,b.initial_quantity::numeric exp,
      (b.current_birds+b.cumulative_deaths+t.valid_birds)::numeric act,
      case when m.nonnegative and b.current_birds=m.current_value then 'RECONCILED' else 'DISCREPANCY' end st,
      jsonb_build_array(target_batch) refs from batch b cross join movement m cross join transfer t
    union all
    select 'mortality',m.gross_deaths-m.death_reversals,dm.quantity,
      case when m.gross_deaths-m.death_reversals=dm.quantity and (select cumulative_deaths from batch)=dm.quantity then 'RECONCILED' else 'DISCREPANCY' end,
      jsonb_build_array(target_batch) from movement m cross join daily_mortality dm
    union all
    select 'point_of_lay_transfers',t.valid_birds,t.valid_birds,
      case when t.bad_count=0 then 'RECONCILED' else 'DISCREPANCY' end,t.bad_ids from transfer t
    union all
    select 'feed_quantity',feed.qty,feed.ledger_qty,
      case when feed.qty=feed.ledger_qty then 'RECONCILED' else 'DISCREPANCY' end,jsonb_build_array(target_batch) from feed
    union all
    select 'feed_cost',case when financial then feed.cost else null end,case when financial then feed.cost else null end,
      case when not financial then 'NOT APPLICABLE' when feed.missing_costs>0 then 'INSUFFICIENT SOURCE DATA' else 'RECONCILED' end,
      jsonb_build_object('missing_cost_snapshots',feed.missing_costs) from feed
    union all
    select 'remaining_rearing_cost',case when financial then costs.historical-costs.transferred else null end,
      case when financial then costs.historical-costs.transferred else null end,
      case when not financial then 'NOT APPLICABLE' when costs.historical<costs.transferred then 'DISCREPANCY' else 'RECONCILED' end,
      jsonb_build_array(target_batch) from costs
  )
  select cat,exp,act,case when exp is null or act is null then null else act-exp end,st,refs from checks;
end; $$;
