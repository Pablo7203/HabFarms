-- Allow correcting the feed type on a completed purchase while rebuilding both
-- affected inventory ledgers atomically. The purchase's payment history remains
-- unchanged and the corrected total must still cover valid recorded payments.
create or replace function public.update_feed_purchase_with_type(
  target_purchase uuid,
  supplier_id uuid,
  target_feed_type uuid,
  purchase_date date,
  bags numeric,
  bag_size_kg numeric,
  cost_per_bag numeric,
  notes text default null
) returns public.feed_purchases
language plpgsql security definer set search_path='' as $$
declare
  p public.feed_purchases;
  r public.feed_purchases;
  paid numeric;
  kg numeric;
  total numeric;
  farm_timezone text;
begin
  select * into p from public.feed_purchases where id=target_purchase for update;
  if p.id is null or p.status<>'completed'
    or not public.has_farm_role(p.farm_id,array['admin','manager']) then
    raise exception 'Purchase edit denied' using errcode='42501';
  end if;

  select timezone into farm_timezone from public.farms where id=p.farm_id;
  if purchase_date is null or purchase_date>(now() at time zone farm_timezone)::date then
    raise exception 'Purchase date cannot be in the future' using errcode='23514';
  end if;
  if target_feed_type is null or not exists (
    select 1 from public.feed_types
    where id=target_feed_type and farm_id=p.farm_id and active
  ) then
    raise exception 'Choose an active feed type from this farm' using errcode='23514';
  end if;
  if supplier_id is not null and not exists (
    select 1 from public.suppliers where id=supplier_id and farm_id=p.farm_id
  ) then
    raise exception 'Choose a supplier from this farm' using errcode='42501';
  end if;

  -- Lock both ledgers in a stable order to avoid deadlocks when the type changes.
  if p.feed_type_id=target_feed_type then
    perform pg_advisory_xact_lock(hashtextextended(p.farm_id::text||p.feed_type_id::text,0));
  elsif p.feed_type_id<target_feed_type then
    perform pg_advisory_xact_lock(hashtextextended(p.farm_id::text||p.feed_type_id::text,0));
    perform pg_advisory_xact_lock(hashtextextended(p.farm_id::text||target_feed_type::text,0));
  else
    perform pg_advisory_xact_lock(hashtextextended(p.farm_id::text||target_feed_type::text,0));
    perform pg_advisory_xact_lock(hashtextextended(p.farm_id::text||p.feed_type_id::text,0));
  end if;

  kg:=round(bags*bag_size_kg,3);
  total:=round(bags*cost_per_bag,2);
  select coalesce(sum(amount),0) into paid
    from public.feed_purchase_payments
    where feed_purchase_id=p.id and voided_at is null;
  if bags is null or bag_size_kg is null or cost_per_bag is null
    or bags<=0 or bag_size_kg<=0 or cost_per_bag<0 or total<paid then
    raise exception 'The corrected purchase total cannot be lower than payments already recorded' using errcode='23514';
  end if;

  update public.feed_purchases
  set supplier_id=$2,
      feed_type_id=$3,
      purchase_date=$4,
      bags=$5,
      bag_size_kg=$6,
      total_kg=kg,
      cost_per_bag=$7,
      cost_per_kg=round(total/kg,4),
      total_cost=total,
      notes=nullif(trim($8),''),
      updated_by=auth.uid()
  where id=p.id returning * into r;

  update public.feed_inventory_movements
  set feed_type_id=$3,
      movement_date=$4,
      quantity_kg=kg,
      unit_cost_snapshot=round(total/kg,4),
      total_cost_snapshot=total
  where source_type='feed_purchase' and source_id=p.id and movement_type='purchase';

  perform public.recalculate_feed_ledger(p.farm_id,p.feed_type_id);
  if target_feed_type is distinct from p.feed_type_id then
    perform public.recalculate_feed_ledger(p.farm_id,target_feed_type);
  end if;
  return r;
end;
$$;

revoke all on function public.update_feed_purchase_with_type(uuid,uuid,uuid,date,numeric,numeric,numeric,text) from public,anon;
grant execute on function public.update_feed_purchase_with_type(uuid,uuid,uuid,date,numeric,numeric,numeric,text) to authenticated;
