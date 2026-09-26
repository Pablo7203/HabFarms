-- Manual one-off Platform invoices are document/billing records only. They do not
-- create farm-ledger expenses, subscription periods, cash entries, or payments.

create sequence public.platform_manual_invoice_number_seq;
revoke all on sequence public.platform_manual_invoice_number_seq from public, anon, authenticated;
grant usage, select on sequence public.platform_manual_invoice_number_seq to service_role;

create table public.platform_manual_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  farm_id uuid not null references public.farms(id) on delete restrict,
  customer_farm_name_snapshot text not null,
  customer_contact_name_snapshot text not null,
  customer_email_snapshot text not null,
  customer_phone_snapshot text,
  customer_country_snapshot text,
  issuer_name_snapshot text not null,
  issuer_billing_email_snapshot text,
  issuer_support_email_snapshot text,
  issuer_phone_snapshot text,
  description text not null check (char_length(trim(description)) between 3 and 500),
  amount numeric(14,2) not null check (amount > 0),
  currency varchar(3) not null check (currency ~ '^[A-Z]{3}$'),
  invoice_date date not null,
  due_date date not null,
  status text not null default 'issued' check (status in ('issued','void')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text,
  constraint platform_manual_invoices_dates check (due_date >= invoice_date),
  constraint platform_manual_invoices_void_fields check (
    (status = 'issued' and voided_at is null and voided_by is null and void_reason is null)
    or (status = 'void' and voided_at is not null and void_reason is not null)
  )
);

create index platform_manual_invoices_farm_date_idx on public.platform_manual_invoices(farm_id, invoice_date desc);
create index platform_manual_invoices_status_due_idx on public.platform_manual_invoices(status, due_date);

alter table public.platform_manual_invoices enable row level security;
create policy platform_manual_invoices_admin_read on public.platform_manual_invoices
  for select to authenticated using (public.is_platform_admin());
revoke all on public.platform_manual_invoices from public, anon, authenticated;
grant select on public.platform_manual_invoices to authenticated;
grant all on public.platform_manual_invoices to service_role;

create function public.platform_create_manual_invoice(
  target_farm uuid,
  target_description text,
  target_amount numeric,
  target_currency varchar,
  target_invoice_date date,
  target_due_date date
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  account public.farm_accounts;
  farm public.farms;
  settings public.platform_settings;
  created_invoice public.platform_manual_invoices;
  invoice_sequence bigint;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  if target_description is null or char_length(trim(target_description)) not between 3 and 500
    or target_amount is null or target_amount <= 0 or target_amount <> round(target_amount,2)
    or target_currency is null or upper(trim(target_currency)) !~ '^[A-Z]{3}$'
    or target_invoice_date is null or target_due_date is null or target_due_date < target_invoice_date then
    raise exception 'Invalid manual invoice details' using errcode='22023';
  end if;

  select * into account from public.farm_accounts where farm_id=target_farm;
  select * into farm from public.farms where id=target_farm;
  select * into settings from public.platform_settings where singleton;
  if account.farm_id is null or farm.id is null or settings.singleton is null then
    raise exception 'Customer farm or Platform settings not found' using errcode='23503';
  end if;

  invoice_sequence := nextval('public.platform_manual_invoice_number_seq'::regclass);
  insert into public.platform_manual_invoices(
    invoice_number,farm_id,customer_farm_name_snapshot,customer_contact_name_snapshot,
    customer_email_snapshot,customer_phone_snapshot,customer_country_snapshot,
    issuer_name_snapshot,issuer_billing_email_snapshot,issuer_support_email_snapshot,issuer_phone_snapshot,
    description,amount,currency,invoice_date,due_date,created_by
  ) values (
    'HF-MI-'||to_char(target_invoice_date,'YYYY')||'-'||lpad(invoice_sequence::text,6,'0'),
    farm.id,farm.name,account.contact_name,account.contact_email,account.contact_phone,account.country,
    settings.company_name,settings.billing_contact_email,settings.support_email,settings.support_phone,
    trim(target_description),round(target_amount,2),upper(trim(target_currency)),target_invoice_date,target_due_date,auth.uid()
  ) returning * into created_invoice;

  perform public.platform_write_audit(
    'platform.manual_invoice_issued',farm.id,'platform_manual_invoices',created_invoice.id,
    jsonb_build_object('invoice_number',created_invoice.invoice_number,'amount',created_invoice.amount,'currency',created_invoice.currency,'due_date',created_invoice.due_date)
  );
  return created_invoice.id;
end;
$$;

create function public.platform_void_manual_invoice(target_invoice uuid,target_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare invoice public.platform_manual_invoices;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  if target_reason is null or char_length(trim(target_reason)) not between 3 and 500 then
    raise exception 'A void reason of at least three characters is required' using errcode='22023';
  end if;
  select * into invoice from public.platform_manual_invoices where id=target_invoice for update;
  if invoice.id is null or invoice.status <> 'issued' then raise exception 'Issued manual invoice not found' using errcode='P0002'; end if;
  update public.platform_manual_invoices set status='void',voided_at=now(),voided_by=auth.uid(),void_reason=trim(target_reason) where id=invoice.id;
  perform public.platform_write_audit('platform.manual_invoice_voided',invoice.farm_id,'platform_manual_invoices',invoice.id,jsonb_build_object('invoice_number',invoice.invoice_number,'voided',true));
end;
$$;

revoke all on function public.platform_create_manual_invoice(uuid,text,numeric,varchar,date,date),public.platform_void_manual_invoice(uuid,text) from public,anon;
grant execute on function public.platform_create_manual_invoice(uuid,text,numeric,varchar,date,date),public.platform_void_manual_invoice(uuid,text) to authenticated;
