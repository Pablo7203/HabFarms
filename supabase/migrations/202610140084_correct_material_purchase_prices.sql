-- Allow farm admins and managers to correct supplier invoice unit prices
-- without rewriting payment history or bypassing the raw-material ledger.
-- Forward-only: before this RPC has been used, rollback is DROP FUNCTION
-- public.update_raw_material_purchase_prices(uuid,jsonb). After use, correct
-- prices through the audited purchase workflow rather than restoring snapshots.
create or replace function public.update_raw_material_purchase_prices(
  target_purchase uuid,
  purchase_items jsonb
) returns public.raw_material_purchase_batches
language plpgsql security definer set search_path = '' as $$
declare
  f uuid;
  b public.raw_material_purchase_batches;
  line record;
  new_total numeric(14,2);
  paid_total numeric(14,2);
  movement_count integer;
begin
  f := public.feed_access_farm(array['admin','manager']);

  select * into b
  from public.raw_material_purchase_batches
  where id = target_purchase and farm_id = f
  for update;

  if b.id is null or b.status <> 'completed' then
    raise exception 'Only completed material purchases in the active farm can be corrected' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(purchase_items), '') <> 'array' then
    raise exception 'Purchase item prices must be provided as a list' using errcode = '23514';
  end if;
  if jsonb_array_length(purchase_items) = 0 then
    raise exception 'At least one purchase line price is required' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(purchase_items) x
    where coalesce(jsonb_typeof(x->'purchase_id'), '') <> 'string'
      or coalesce(jsonb_typeof(x->'unit_cost'), '') <> 'number'
      or (x->>'unit_cost')::numeric < 0
  ) then
    raise exception 'Each purchase line needs a valid non-negative unit price' using errcode = '23514';
  end if;
  if (select count(*) from jsonb_array_elements(purchase_items)) <>
     (select count(*) from public.raw_material_purchases where purchase_batch_id = b.id)
     or (select count(*) from jsonb_array_elements(purchase_items)) <>
        (select count(distinct (x->>'purchase_id')::uuid) from jsonb_array_elements(purchase_items))
     or exists (
       select 1 from jsonb_array_elements(purchase_items) x
       left join public.raw_material_purchases p
         on p.id = (x->>'purchase_id')::uuid and p.purchase_batch_id = b.id and p.farm_id = f
       where p.id is null
     ) then
    raise exception 'Purchase lines do not match this supplier purchase' using errcode = '23514';
  end if;

  select coalesce(sum(round(p.quantity_kg * (x->>'unit_cost')::numeric, 2)), 0)
    into new_total
  from jsonb_array_elements(purchase_items) x
  join public.raw_material_purchases p on p.id = (x->>'purchase_id')::uuid;

  select coalesce(sum(amount), 0) into paid_total
  from public.raw_material_purchase_payments
  where purchase_batch_id = b.id and farm_id = f and voided_at is null;
  if paid_total > new_total then
    raise exception 'Corrected purchase total cannot be lower than the % already paid', paid_total using errcode = '23514';
  end if;

  for line in
    select p.id, p.material_id, p.quantity_kg, (x->>'unit_cost')::numeric as unit_cost
    from jsonb_array_elements(purchase_items) x
    join public.raw_material_purchases p on p.id = (x->>'purchase_id')::uuid
    order by p.material_id
  loop
    update public.raw_material_purchases
    set unit_cost = line.unit_cost,
        total_cost = round(line.quantity_kg * line.unit_cost, 2)
    where id = line.id and purchase_batch_id = b.id and farm_id = f;

    update public.raw_material_inventory_movements
    set unit_cost_snapshot = line.unit_cost,
        total_cost_snapshot = round(line.quantity_kg * line.unit_cost, 2)
    where farm_id = f
      and material_id = line.material_id
      and source_type = 'raw_material_purchase_batch'
      and source_id = b.id
      and movement_type = 'purchase'
      and direction = 'IN';
    get diagnostics movement_count = row_count;
    if movement_count <> 1 then
      raise exception 'Could not find the stock movement for a purchase line; no prices were changed' using errcode = '23514';
    end if;

    perform public.recalculate_raw_material_ledger(f, line.material_id);
  end loop;

  update public.raw_material_purchase_batches
  set total_cost = new_total,
      updated_by = auth.uid()
  where id = b.id and farm_id = f
  returning * into b;

  return b;
end;
$$;

revoke all on function public.update_raw_material_purchase_prices(uuid,jsonb) from public, anon;
grant execute on function public.update_raw_material_purchase_prices(uuid,jsonb) to authenticated;
