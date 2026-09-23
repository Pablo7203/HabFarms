-- Distinguish incomplete costing from a verified zero without exposing the
-- underlying financial values to workers.
create function public.get_rearing_cost_source_status(target_batch uuid)
returns table(category text,reconciliation_status text,source_references jsonb)
language plpgsql stable security definer set search_path='' as $$
declare f uuid; financial boolean;
begin
  select farm_id into f from public.rearing_batches where id=target_batch;
  if f is null or not public.has_farm_role(f,array['admin','manager','worker']) then
    raise exception 'Rearing cost-source access denied' using errcode='42501';
  end if;
  financial:=public.has_farm_role(f,array['admin','manager']);
  if not financial then
    return query select 'financial_cost_sources'::text,'NOT APPLICABLE'::text,'[]'::jsonb;
    return;
  end if;
  return query
  with acquisition as (
    select coalesce(jsonb_agg(e.id),'[]'::jsonb) refs,count(*)::integer n from public.expenses e
    where e.farm_id=f and e.rearing_batch_id=target_batch and e.rearing_cost_kind='acquisition' and e.status='active'
  ), feed as (
    select count(*) filter(where m.total_cost_snapshot is null)::integer missing,
      coalesce(jsonb_agg(c.id) filter(where m.total_cost_snapshot is null),'[]'::jsonb) refs
    from public.rearing_feed_consumptions c join public.feed_inventory_movements m on m.id=c.movement_id and m.farm_id=c.farm_id
    where c.farm_id=f and c.rearing_batch_id=target_batch and c.active
  ), health as (
    select coalesce(sum(h.cost),0)::numeric source_cost,
      coalesce(sum(e.amount),0)::numeric linked_cost,
      coalesce(jsonb_agg(h.id) filter(where h.cost>0 and e.id is null),'[]'::jsonb) missing_refs
    from public.health_records h left join public.expenses e on e.farm_id=h.farm_id and e.source_type='health_record'
      and e.source_id=h.id and e.source_key='health_cost' and e.status='active'
    where h.farm_id=f and h.rearing_batch_id=target_batch and h.status='active'
  )
  select 'acquisition'::text,case when a.n=0 then 'INSUFFICIENT SOURCE DATA' else 'RECONCILED' end,a.refs from acquisition a
  union all
  select 'feed_cost',case when feed.missing>0 then 'INSUFFICIENT SOURCE DATA' else 'RECONCILED' end,feed.refs from feed
  union all
  select 'health_cost',case when health.source_cost<>health.linked_cost or jsonb_array_length(health.missing_refs)>0
    then 'DISCREPANCY' else 'RECONCILED' end,health.missing_refs from health;
end; $$;

revoke all on function public.get_rearing_cost_source_status(uuid) from public,anon;
grant execute on function public.get_rearing_cost_source_status(uuid) to authenticated;
