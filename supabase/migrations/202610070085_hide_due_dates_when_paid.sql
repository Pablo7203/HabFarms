-- A due date is only actionable while a customer still owes money. Keep the
-- original terms for audit purposes, but do not surface or store due dates for
-- fully paid egg sales.

alter function public.post_graded_egg_sale(uuid, date, jsonb, numeric, numeric, text, text, integer)
  rename to post_graded_egg_sale_with_credit_terms;

create function public.post_graded_egg_sale(
  customer_id uuid,
  sale_date date,
  items jsonb,
  discount numeric,
  amount_paid numeric,
  payment_method text,
  notes text default null,
  credit_days integer default null
) returns public.sales
language plpgsql security definer set search_path=''
as $$
declare
  result public.sales;
begin
  result := public.post_graded_egg_sale_with_credit_terms(
    customer_id, sale_date, items, discount, amount_paid, payment_method, notes, credit_days
  );

  if amount_paid >= result.total_amount then
    update public.sales
      set credit_days = null, payment_due_date = null
      where id = result.id
      returning * into result;
  end if;

  return result;
end;
$$;

revoke all on function public.post_graded_egg_sale_with_credit_terms(uuid, date, jsonb, numeric, numeric, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.post_graded_egg_sale(uuid, date, jsonb, numeric, numeric, text, text, integer)
  from public, anon;
grant execute on function public.post_graded_egg_sale(uuid, date, jsonb, numeric, numeric, text, text, integer)
  to authenticated;

alter function public.update_graded_egg_sale(uuid, uuid, jsonb, numeric, text, integer)
  rename to update_graded_egg_sale_with_credit_terms;

create function public.update_graded_egg_sale(
  target_sale uuid,
  customer_id uuid,
  items jsonb,
  discount numeric,
  notes text default null,
  credit_days integer default null
) returns public.sales
language plpgsql security definer set search_path=''
as $$
declare
  result public.sales;
  active_paid numeric;
begin
  result := public.update_graded_egg_sale_with_credit_terms(
    target_sale, customer_id, items, discount, notes, credit_days
  );

  select coalesce(sum(p.amount), 0) into active_paid
  from public.customer_payments p
  where p.sale_id = result.id and p.voided_at is null;

  if active_paid >= result.total_amount then
    update public.sales
      set payment_due_date = null
      where id = result.id
      returning * into result;
  end if;

  return result;
end;
$$;

revoke all on function public.update_graded_egg_sale_with_credit_terms(uuid, uuid, jsonb, numeric, text, integer)
  from public, anon, authenticated;
revoke all on function public.update_graded_egg_sale(uuid, uuid, jsonb, numeric, text, integer)
  from public, anon;
grant execute on function public.update_graded_egg_sale(uuid, uuid, jsonb, numeric, text, integer)
  to authenticated;

-- Reports and collection screens consume these views. A settled sale retains
-- its original credit_days for history, while the due date disappears from the
-- receivable once its outstanding balance reaches zero.
create or replace view public.v_sales_receivables with (security_invoker=true) as
select
  s.id as sale_id,
  s.sale_number,
  s.farm_id,
  s.customer_id,
  s.sale_date,
  s.total_amount,
  coalesce(sum(p.amount) filter (where p.voided_at is null), 0)::numeric(14,2) as total_paid,
  (s.total_amount - coalesce(sum(p.amount) filter (where p.voided_at is null), 0))::numeric(14,2) as outstanding_balance,
  case
    when coalesce(sum(p.amount) filter (where p.voided_at is null), 0) = 0 then 'unpaid'
    when coalesce(sum(p.amount) filter (where p.voided_at is null), 0) < s.total_amount then 'partial'
    else 'paid'
  end as payment_status,
  s.status,
  s.credit_days,
  case
    when s.total_amount - coalesce(sum(p.amount) filter (where p.voided_at is null), 0) > 0 then s.payment_due_date
    else null::date
  end as payment_due_date,
  s.sale_type
from public.sales s
left join public.customer_payments p on p.sale_id = s.id
group by s.id;

-- With only one eligible farm, there is no ambiguous context to confirm. For
-- multi-farm users, preserve the explicit selection requirement.
create or replace function public.resolve_selected_farm(required_roles text[])
returns uuid
language plpgsql stable security definer set search_path=''
as $$
declare
  request_headers jsonb;
  selected_farm uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  begin
    request_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
    selected_farm := nullif(request_headers->>'x-habfarms-active-farm', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'Invalid selected farm' using errcode='22023';
  end;

  if selected_farm is null then
    select fm.farm_id into selected_farm
    from public.farm_members fm
    where fm.user_id = auth.uid() and fm.active and fm.role = any(required_roles)
    order by fm.created_at
    limit 1;

    if selected_farm is null then
      raise exception 'Farm access denied' using errcode='42501';
    end if;

    if exists (
      select 1 from public.farm_members fm
      where fm.user_id = auth.uid() and fm.active and fm.role = any(required_roles)
        and fm.farm_id <> selected_farm
    ) then
      raise exception 'Explicit farm selection is required; select an active farm and retry' using errcode='22023';
    end if;
  end if;

  if not public.has_farm_role(selected_farm, required_roles) then
    raise exception 'Selected farm access denied' using errcode='42501';
  end if;

  return selected_farm;
end;
$$;
revoke all on function public.resolve_selected_farm(text[]) from public, anon;
grant execute on function public.resolve_selected_farm(text[]) to authenticated;
