create function public.get_cash_flow_summary_filtered(
  start_date date,
  end_date date,
  target_payment_method text
) returns table(
  opening_balance numeric,
  total_inflows numeric,
  total_outflows numeric,
  net_movement numeric,
  closing_balance numeric
) language plpgsql stable security definer set search_path='' as $$
declare
  target_farm uuid;
  opening numeric;
  inflows numeric;
  outflows numeric;
begin
  target_farm := public.reporting_farm(true);
  if start_date is null or end_date is null or start_date > end_date
    or target_payment_method not in ('cash','momo','bank_transfer','other') then
    raise exception 'Invalid cash-flow filter' using errcode='22023';
  end if;

  select f.opening_cash_balance + coalesce(sum(
    case when l.direction='IN' then l.amount else -l.amount end
  ) filter (
    where l.transaction_date < start_date
      and l.payment_method = target_payment_method
  ), 0)
  into opening
  from public.farms f
  left join public.v_cash_ledger l on l.farm_id=f.id
  where f.id=target_farm
  group by f.id;

  select
    coalesce(sum(amount) filter (where direction='IN'), 0),
    coalesce(sum(amount) filter (where direction='OUT'), 0)
  into inflows, outflows
  from public.v_cash_ledger
  where farm_id=target_farm
    and transaction_date between start_date and end_date
    and payment_method=target_payment_method;

  return query select opening, inflows, outflows, inflows-outflows, opening+inflows-outflows;
end;
$$;

revoke all on function public.get_cash_flow_summary_filtered(date,date,text) from public;
grant execute on function public.get_cash_flow_summary_filtered(date,date,text) to authenticated;
