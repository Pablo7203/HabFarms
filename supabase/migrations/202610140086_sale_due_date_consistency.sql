-- A due date is meaningful only while money remains outstanding. Keep the
-- stored sale value in sync with payments, even when credit days were
-- prefilled from a customer's defaults on a sale that was paid in full.

create or replace function public.normalize_sale_due_date()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  active_paid numeric(14,2);
begin
  select coalesce(sum(p.amount),0)::numeric(14,2)
    into active_paid
  from public.customer_payments p
  where p.sale_id=new.id and p.voided_at is null;

  if new.total_amount<=active_paid then
    new.payment_due_date:=null;
  elsif new.payment_due_date is null and new.credit_days between 1 and 365 then
    new.payment_due_date:=new.sale_date+new.credit_days;
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_sale_due_date() from public,anon,authenticated;

drop trigger if exists sales_normalize_due_date on public.sales;
create trigger sales_normalize_due_date
before insert or update of total_amount,sale_date,credit_days,payment_due_date
on public.sales
for each row execute function public.normalize_sale_due_date();

create or replace function public.sync_sale_due_date_after_payment_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  affected_sale uuid;
begin
  if tg_op<>'INSERT' then
    affected_sale:=old.sale_id;
    update public.sales s
    set payment_due_date=case
      when s.total_amount<=coalesce((
        select sum(p.amount) from public.customer_payments p
        where p.sale_id=s.id and p.voided_at is null
      ),0) then null
      when s.payment_due_date is null and s.credit_days between 1 and 365
        then s.sale_date+s.credit_days
      else s.payment_due_date
    end
    where s.id=affected_sale;
  end if;

  if tg_op<>'DELETE' and (tg_op='INSERT' or new.sale_id is distinct from old.sale_id) then
    affected_sale:=new.sale_id;
    update public.sales s
    set payment_due_date=case
      when s.total_amount<=coalesce((
        select sum(p.amount) from public.customer_payments p
        where p.sale_id=s.id and p.voided_at is null
      ),0) then null
      when s.payment_due_date is null and s.credit_days between 1 and 365
        then s.sale_date+s.credit_days
      else s.payment_due_date
    end
    where s.id=affected_sale;
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.sync_sale_due_date_after_payment_change() from public,anon,authenticated;

drop trigger if exists customer_payments_sync_sale_due_date on public.customer_payments;
create trigger customer_payments_sync_sale_due_date
after insert or update or delete on public.customer_payments
for each row execute function public.sync_sale_due_date_after_payment_change();

-- Repair existing fully settled sales without changing their payment history.
update public.sales s
set payment_due_date=null
where s.payment_due_date is not null
  and s.total_amount<=coalesce((
    select sum(p.amount) from public.customer_payments p
    where p.sale_id=s.id and p.voided_at is null
  ),0);
