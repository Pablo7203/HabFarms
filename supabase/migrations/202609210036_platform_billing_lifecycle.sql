-- HabFarms Platform Phase 2: commercial subscription lifecycle.
-- Subscription billing is platform finance only. It must never enter tenant farm ledgers.

alter table public.farm_accounts
  add column suspension_source text check (suspension_source in ('billing','manual')),
  add column suspension_reason text,
  add column suspended_by uuid references auth.users(id) on delete set null;

alter table public.farm_subscriptions
  add column past_due_at timestamptz,
  add column suspended_at timestamptz,
  add column pending_plan_id uuid references public.subscription_plans(id) on delete restrict,
  add column pending_billing_cycle text check (pending_billing_cycle in ('monthly','annual')),
  add column suspension_reason text;

create table public.subscription_billing_periods (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  subscription_id uuid not null references public.farm_subscriptions(id) on delete restrict,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  plan_name_snapshot text not null,
  billing_cycle text not null check (billing_cycle in ('monthly','annual')),
  currency varchar(3) not null check (currency ~ '^[A-Z]{3}$'),
  price_snapshot numeric(14,2) not null check (price_snapshot >= 0),
  period_start date not null,
  period_end date not null,
  due_date date not null,
  amount_due numeric(14,2) not null check (amount_due >= 0),
  status text not null default 'open' check (status in ('open','partial','paid','void')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint subscription_billing_periods_dates check (period_end > period_start),
  constraint subscription_billing_periods_due_in_period check (due_date >= period_start and due_date <= period_end),
  unique (subscription_id, period_start)
);

create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  subscription_id uuid not null references public.farm_subscriptions(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  currency varchar(3) not null check (currency ~ '^[A-Z]{3}$'),
  payment_method text not null check (payment_method in ('momo','bank_transfer','cash','paystack_manual','other')),
  payment_reference text,
  paid_at date not null,
  notes text,
  status text not null default 'posted' check (status in ('posted','voided')),
  idempotency_key uuid not null default gen_random_uuid(),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text,
  unique (idempotency_key),
  constraint subscription_payments_void_fields check ((status = 'posted' and voided_at is null and voided_by is null and void_reason is null) or (status = 'voided' and voided_at is not null and void_reason is not null))
);

create unique index subscription_payments_reference_unique_idx
  on public.subscription_payments(farm_id,payment_method,payment_reference)
  where payment_reference is not null and status = 'posted';

create table public.subscription_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.subscription_payments(id) on delete restrict,
  billing_period_id uuid not null references public.subscription_billing_periods(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (payment_id)
);

create index subscription_billing_periods_subscription_dates_idx on public.subscription_billing_periods(subscription_id,period_start desc);
create index subscription_billing_periods_farm_status_idx on public.subscription_billing_periods(farm_id,status,due_date);
create index subscription_payments_subscription_date_idx on public.subscription_payments(subscription_id,paid_at desc);
create index subscription_payment_allocations_period_idx on public.subscription_payment_allocations(billing_period_id);

create function public.subscription_period_end(start_date date, cycle text)
returns date language plpgsql immutable set search_path='' as $$
begin
  if cycle = 'monthly' then return (start_date + interval '1 month')::date; end if;
  if cycle = 'annual' then return (start_date + interval '1 year')::date; end if;
  raise exception 'Invalid billing cycle' using errcode='22023';
end;
$$;

create function public.subscription_period_outstanding(target_period uuid)
returns numeric language sql stable security definer set search_path='' as $$
  select greatest(period.amount_due - coalesce(sum(allocation.amount) filter (where payment.status = 'posted'),0),0)
  from public.subscription_billing_periods period
  left join public.subscription_payment_allocations allocation on allocation.billing_period_id = period.id
  left join public.subscription_payments payment on payment.id = allocation.payment_id
  where period.id = target_period
  group by period.amount_due;
$$;

create function public.refresh_subscription_billing_period(target_period uuid)
returns void language plpgsql security definer set search_path='' as $$
declare outstanding numeric; period_amount_due numeric;
begin
  select period.amount_due into period_amount_due from public.subscription_billing_periods period where period.id=target_period for update;
  if period_amount_due is null then raise exception 'Billing period not found' using errcode='22023'; end if;
  select public.subscription_period_outstanding(target_period) into outstanding;
  update public.subscription_billing_periods
  set status = case when status='void' then 'void' when outstanding=0 then 'paid' when outstanding<period_amount_due then 'partial' else 'open' end,
      closed_at = case when status<>'void' and outstanding=0 then coalesce(closed_at,now()) else null end
  where id=target_period;
end;
$$;

create function public.platform_audit_system(target_action text,target_farm uuid,target_type text,target_id uuid,target_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if target_metadata ?| array['password','token','raw_token','access_token','refresh_token','service_role_key','smtp_password'] then
    raise exception 'Sensitive audit metadata is prohibited' using errcode='22023';
  end if;
  insert into public.platform_audit_logs(actor_user_id,action,farm_id,target_type,target_id,metadata)
  values(null,target_action,target_farm,target_type,target_id,coalesce(target_metadata,'{}'::jsonb));
end;
$$;

create function public.create_subscription_billing_period(target_subscription uuid,target_start date,target_due_date date default null)
returns public.subscription_billing_periods language plpgsql security definer set search_path='' as $$
declare subscription public.farm_subscriptions; plan public.subscription_plans; period public.subscription_billing_periods; chosen_plan uuid; chosen_cycle text; price numeric; end_date date;
begin
  select * into subscription from public.farm_subscriptions where id=target_subscription for update;
  if subscription.id is null or subscription.ended_at is not null then raise exception 'Current subscription required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(subscription.id::text,0));
  select * into period from public.subscription_billing_periods where subscription_id=subscription.id and period_start=target_start;
  if period.id is not null then return period; end if;
  if exists(select 1 from public.subscription_billing_periods where subscription_id=subscription.id and daterange(period_start,period_end,'[)') && daterange(target_start,public.subscription_period_end(target_start,coalesce(subscription.pending_billing_cycle,subscription.billing_cycle)),'[)')) then
    raise exception 'Billing period would overlap an existing period' using errcode='23514';
  end if;
  chosen_plan:=coalesce(subscription.pending_plan_id,subscription.plan_id);
  chosen_cycle:=coalesce(subscription.pending_billing_cycle,subscription.billing_cycle);
  select * into plan from public.subscription_plans where id=chosen_plan;
  if plan.id is null then raise exception 'Subscription plan not found' using errcode='22023'; end if;
  price:=case when chosen_cycle='monthly' then plan.monthly_price else plan.annual_price end;
  if price is null then raise exception 'Configure the plan price before creating a billing period' using errcode='23514'; end if;
  end_date:=public.subscription_period_end(target_start,chosen_cycle);
  insert into public.subscription_billing_periods(farm_id,subscription_id,plan_id,plan_name_snapshot,billing_cycle,currency,price_snapshot,period_start,period_end,due_date,amount_due,created_by)
  values(subscription.farm_id,subscription.id,plan.id,plan.name,chosen_cycle,plan.currency,price,target_start,end_date,coalesce(target_due_date,target_start),price,auth.uid())
  returning * into period;
  if subscription.pending_plan_id is not null or subscription.pending_billing_cycle is not null then
    update public.farm_subscriptions set plan_id=chosen_plan,billing_cycle=chosen_cycle,currency=plan.currency,price_snapshot=price,pending_plan_id=null,pending_billing_cycle=null where id=subscription.id;
    perform public.platform_audit_system('subscription.plan_changed',subscription.farm_id,'farm_subscriptions',subscription.id,jsonb_build_object('plan_code',plan.code,'billing_cycle',chosen_cycle));
  end if;
  return period;
end;
$$;

create function public.is_farm_member_any(target_farm_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.farm_members where farm_id=target_farm_id and user_id=auth.uid() and active);
$$;

create function public.get_farm_access_mode(target_farm_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare account public.farm_accounts; subscription public.farm_subscriptions;
begin
  if not public.is_farm_member_any(target_farm_id) then return 'blocked'; end if;
  select * into account from public.farm_accounts where farm_id=target_farm_id;
  if account.farm_id is null then return 'full'; end if;
  if account.account_status in ('closed','suspended') then return 'blocked'; end if;
  if account.account_status='onboarding' then return 'onboarding'; end if;
  select * into subscription from public.farm_subscriptions where farm_id=target_farm_id and ended_at is null order by created_at desc limit 1;
  if subscription.id is null then return 'full'; end if;
  if subscription.status='suspended' then return 'blocked'; end if;
  return 'full';
end;
$$;

create or replace function public.is_farm_member(target_farm_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.get_farm_access_mode(target_farm_id)='full';
$$;

create or replace function public.has_farm_role(target_farm_id uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path='' as $$
  select public.get_farm_access_mode(target_farm_id)='full' and exists(select 1 from public.farm_members where farm_id=target_farm_id and user_id=auth.uid() and active and role=any(allowed_roles));
$$;

drop policy if exists farms_read_members on public.farms;
create policy farms_read_members on public.farms for select to authenticated using(public.is_farm_member_any(id));
drop policy if exists settings_read_members on public.farm_settings;
create policy settings_read_members on public.farm_settings for select to authenticated using(public.is_farm_member_any(farm_id));
drop policy if exists members_read_farm_members on public.farm_members;
create policy members_read_farm_members on public.farm_members for select to authenticated using(public.is_farm_member_any(farm_id));
drop policy if exists farm_accounts_member_read on public.farm_accounts;
drop policy if exists farm_subscriptions_member_read on public.farm_subscriptions;
drop policy if exists farm_onboarding_member_read on public.farm_onboarding;

create function public.get_my_farm_access(target_farm uuid)
returns table(farm_id uuid,account_status text,primary_owner_user_id uuid,access_mode text,subscription_status text,plan_name text,billing_cycle text,trial_ends_at date,grace_ends_at date)
language sql stable security definer set search_path='' as $$
  select account.farm_id,account.account_status,account.primary_owner_user_id,public.get_farm_access_mode(account.farm_id),subscription.status,plan.name,subscription.billing_cycle,subscription.trial_ends_at,subscription.grace_ends_at
  from public.farm_accounts account
  left join public.farm_subscriptions subscription on subscription.farm_id=account.farm_id and subscription.ended_at is null
  left join public.subscription_plans plan on plan.id=subscription.plan_id
  where account.farm_id=target_farm and public.is_farm_member_any(target_farm)
  order by subscription.created_at desc nulls last limit 1;
$$;

create function public.get_my_subscription_status(target_farm uuid)
returns table(farm_id uuid,farm_name text,account_status text,access_mode text,plan_name text,currency varchar(3),subscription_status text,billing_cycle text,current_period_start date,current_period_end date,next_billing_date date,trial_ends_at date,grace_ends_at date,amount_due numeric,amount_paid numeric,outstanding numeric,can_view_financials boolean)
language sql stable security definer set search_path='' as $$
  with member as (select role from public.farm_members where farm_id=target_farm and user_id=auth.uid() and active), subscription as (select * from public.farm_subscriptions where farm_id=target_farm and ended_at is null order by created_at desc limit 1), period as (select * from public.subscription_billing_periods where subscription_id=(select id from subscription) order by period_end desc limit 1), paid as (select coalesce(sum(allocation.amount) filter(where payment.status='posted'),0) amount from public.subscription_payment_allocations allocation join public.subscription_payments payment on payment.id=allocation.payment_id where allocation.billing_period_id=(select id from period))
  select account.farm_id,farm.name,account.account_status,public.get_farm_access_mode(account.farm_id),plan.name,subscription.currency,subscription.status,subscription.billing_cycle,subscription.current_period_start,subscription.current_period_end,subscription.next_billing_date,subscription.trial_ends_at,subscription.grace_ends_at,
    case when (select role from member)='admin' then period.amount_due else null end,
    case when (select role from member)='admin' then paid.amount else null end,
    case when (select role from member)='admin' then greatest(coalesce(period.amount_due,0)-paid.amount,0) else null end,
    (select role from member)='admin'
  from public.farm_accounts account join public.farms farm on farm.id=account.farm_id left join subscription on true left join public.subscription_plans plan on plan.id=subscription.plan_id left join period on true cross join paid
  where account.farm_id=target_farm and exists(select 1 from member);
$$;

create function public.platform_create_subscription_plan(target_code text,target_name text,target_description text,target_currency text,target_monthly_price numeric,target_annual_price numeric,target_trial_days integer,target_grace_days integer,target_max_users integer)
returns public.subscription_plans language plpgsql security definer set search_path='' as $$
declare plan public.subscription_plans; normalized_code text;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  normalized_code:=upper(trim(target_code));
  if normalized_code !~ '^[A-Z][A-Z0-9_]{1,39}$' or char_length(trim(target_name)) not between 2 and 80 or target_currency !~ '^[A-Z]{3}$' or target_monthly_price<0 or target_annual_price<0 or target_trial_days not between 0 and 365 or target_grace_days not between 0 and 365 or (target_max_users is not null and target_max_users<=0) then raise exception 'Invalid subscription plan' using errcode='22023'; end if;
  insert into public.subscription_plans(code,name,description,currency,monthly_price,annual_price,default_trial_days,default_grace_days,max_users)
  values(normalized_code,trim(target_name),nullif(trim(target_description),''),target_currency,target_monthly_price,target_annual_price,target_trial_days,target_grace_days,target_max_users) returning * into plan;
  perform public.platform_write_audit('plan.created',null,'subscription_plans',plan.id,jsonb_build_object('code',plan.code));
  return plan;
end;
$$;

create function public.platform_update_subscription_plan(target_plan uuid,target_name text,target_description text,target_currency text,target_monthly_price numeric,target_annual_price numeric,target_trial_days integer,target_grace_days integer,target_max_users integer,target_active boolean)
returns public.subscription_plans language plpgsql security definer set search_path='' as $$
declare plan public.subscription_plans; was_active boolean;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  if char_length(trim(target_name)) not between 2 and 80 or target_currency !~ '^[A-Z]{3}$' or target_monthly_price<0 or target_annual_price<0 or target_trial_days not between 0 and 365 or target_grace_days not between 0 and 365 or (target_max_users is not null and target_max_users<=0) then raise exception 'Invalid subscription plan' using errcode='22023'; end if;
  select is_active into was_active from public.subscription_plans where id=target_plan for update;
  if was_active is null then raise exception 'Subscription plan not found' using errcode='22023'; end if;
  update public.subscription_plans set name=trim(target_name),description=nullif(trim(target_description),''),currency=target_currency,monthly_price=target_monthly_price,annual_price=target_annual_price,default_trial_days=target_trial_days,default_grace_days=target_grace_days,max_users=target_max_users,is_active=target_active where id=target_plan returning * into plan;
  perform public.platform_write_audit(case when was_active and not target_active then 'plan.deactivated' when not was_active and target_active then 'plan.reactivated' else 'plan.updated' end,null,'subscription_plans',plan.id,jsonb_build_object('code',plan.code));
  return plan;
end;
$$;

create function public.platform_extend_subscription_trial(target_subscription uuid,target_trial_end date,target_reason text)
returns public.farm_subscriptions language plpgsql security definer set search_path='' as $$
declare subscription public.farm_subscriptions; previous_end date;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  select * into subscription from public.farm_subscriptions where id=target_subscription and ended_at is null for update;
  if subscription.id is null or subscription.status<>'trialing' or target_trial_end<=subscription.trial_ends_at or char_length(trim(target_reason))<3 then raise exception 'A later trial end date and reason are required' using errcode='22023'; end if;
  previous_end:=subscription.trial_ends_at;
  update public.farm_subscriptions set trial_ends_at=target_trial_end where id=subscription.id returning * into subscription;
  perform public.platform_write_audit('subscription.trial_extended',subscription.farm_id,'farm_subscriptions',subscription.id,jsonb_build_object('old_trial_end',previous_end,'new_trial_end',target_trial_end,'reason',trim(target_reason)));
  return subscription;
end;
$$;

create function public.platform_schedule_subscription_plan_change(target_subscription uuid,target_plan uuid,target_cycle text)
returns public.farm_subscriptions language plpgsql security definer set search_path='' as $$
declare subscription public.farm_subscriptions; plan public.subscription_plans;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  select * into subscription from public.farm_subscriptions where id=target_subscription and ended_at is null for update;
  select * into plan from public.subscription_plans where id=target_plan and is_active;
  if subscription.id is null or plan.id is null or target_cycle not in ('monthly','annual') then raise exception 'Valid current subscription, plan, and billing cycle required' using errcode='22023'; end if;
  update public.farm_subscriptions set pending_plan_id=plan.id,pending_billing_cycle=target_cycle where id=subscription.id returning * into subscription;
  perform public.platform_write_audit('subscription.plan_change_scheduled',subscription.farm_id,'farm_subscriptions',subscription.id,jsonb_build_object('plan_code',plan.code,'billing_cycle',target_cycle));
  return subscription;
end;
$$;

create function public.platform_cancel_subscription_plan_change(target_subscription uuid)
returns public.farm_subscriptions language plpgsql security definer set search_path='' as $$
declare subscription public.farm_subscriptions;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  select * into subscription from public.farm_subscriptions where id=target_subscription and ended_at is null for update;
  if subscription.id is null or (subscription.pending_plan_id is null and subscription.pending_billing_cycle is null) then raise exception 'No scheduled plan change exists' using errcode='22023'; end if;
  update public.farm_subscriptions set pending_plan_id=null,pending_billing_cycle=null where id=subscription.id returning * into subscription;
  perform public.platform_write_audit('subscription.plan_change_cancelled',subscription.farm_id,'farm_subscriptions',subscription.id,'{}'::jsonb);
  return subscription;
end;
$$;

create function public.platform_record_subscription_payment(target_period uuid,target_amount numeric,target_payment_method text,target_reference text,target_paid_at date,target_notes text,target_idempotency_key uuid)
returns public.subscription_payments language plpgsql security definer set search_path='' as $$
declare period public.subscription_billing_periods; subscription public.farm_subscriptions; payment public.subscription_payments; outstanding numeric; account public.farm_accounts;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  if target_amount<=0 or target_payment_method not in ('momo','bank_transfer','cash','paystack_manual','other') or target_idempotency_key is null then raise exception 'Invalid subscription payment' using errcode='22023'; end if;
  select * into payment from public.subscription_payments where idempotency_key=target_idempotency_key;
  if payment.id is not null then return payment; end if;
  select * into period from public.subscription_billing_periods where id=target_period for update;
  if period.id is null or period.status='void' then raise exception 'Open billing period required' using errcode='22023'; end if;
  select * into subscription from public.farm_subscriptions where id=period.subscription_id and farm_id=period.farm_id and ended_at is null for update;
  if subscription.id is null then raise exception 'Billing period subscription mismatch' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(subscription.id::text,0));
  select public.subscription_period_outstanding(period.id) into outstanding;
  if target_amount>outstanding then raise exception 'Payment exceeds the outstanding amount' using errcode='23514'; end if;
  insert into public.subscription_payments(farm_id,subscription_id,amount,currency,payment_method,payment_reference,paid_at,notes,idempotency_key,recorded_by)
  values(period.farm_id,subscription.id,target_amount,period.currency,target_payment_method,nullif(trim(target_reference),''),target_paid_at,nullif(trim(target_notes),''),target_idempotency_key,auth.uid()) returning * into payment;
  insert into public.subscription_payment_allocations(payment_id,billing_period_id,amount) values(payment.id,period.id,target_amount);
  perform public.refresh_subscription_billing_period(period.id);
  select * into period from public.subscription_billing_periods where id=period.id;
  if period.status='paid' then
    update public.farm_subscriptions set status='active',current_period_start=period.period_start,current_period_end=period.period_end,next_billing_date=period.period_end,past_due_at=null,grace_ends_at=null,suspended_at=null,suspension_reason=null where id=subscription.id;
    select * into account from public.farm_accounts where farm_id=subscription.farm_id for update;
    if account.account_status='suspended' and account.suspension_source='billing' and exists(select 1 from public.farm_onboarding where farm_id=account.farm_id and status='completed') then
      update public.farm_accounts set account_status='active',suspension_source=null,suspension_reason=null,suspended_at=null,suspended_by=null where farm_id=account.farm_id;
      perform public.platform_write_audit('farm.billing_reactivated',account.farm_id,'farm_accounts',account.farm_id,jsonb_build_object('payment_id',payment.id));
      perform public.platform_write_audit('subscription.reactivated',account.farm_id,'farm_subscriptions',subscription.id,jsonb_build_object('payment_id',payment.id));
    elsif subscription.status is distinct from 'active' then
      perform public.platform_write_audit('subscription.activated',subscription.farm_id,'farm_subscriptions',subscription.id,jsonb_build_object('billing_period_id',period.id));
    end if;
  end if;
  perform public.platform_write_audit('subscription_payment.recorded',subscription.farm_id,'subscription_payments',payment.id,jsonb_build_object('billing_period_id',period.id,'amount',payment.amount,'currency',payment.currency,'method',payment.payment_method));
  return payment;
end;
$$;

create function public.platform_prepare_subscription_billing_period(target_subscription uuid)
returns public.subscription_billing_periods language plpgsql security definer set search_path='' as $$
declare subscription public.farm_subscriptions; period public.subscription_billing_periods; latest_paid public.subscription_billing_periods; start_date date;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  select * into subscription from public.farm_subscriptions where id=target_subscription and ended_at is null for update;
  if subscription.id is null or subscription.status in ('suspended','cancelled') then raise exception 'An active, trialing, or overdue subscription is required' using errcode='22023'; end if;
  select * into period from public.subscription_billing_periods where subscription_id=subscription.id and status in ('open','partial') order by period_start desc limit 1;
  if period.id is not null then return period; end if;
  select * into latest_paid from public.subscription_billing_periods where subscription_id=subscription.id and status='paid' order by period_end desc limit 1;
  start_date:=case when latest_paid.id is not null and latest_paid.period_end>current_date then latest_paid.period_end when subscription.status='trialing' and subscription.trial_ends_at is not null and subscription.trial_ends_at>current_date then current_date else coalesce(subscription.next_billing_date,current_date) end;
  period:=public.create_subscription_billing_period(subscription.id,start_date,start_date);
  perform public.platform_write_audit('subscription.billing_period_created',subscription.farm_id,'subscription_billing_periods',period.id,jsonb_build_object('period_start',period.period_start,'period_end',period.period_end));
  return period;
end;
$$;

create function public.platform_void_subscription_payment(target_payment uuid,target_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare payment public.subscription_payments; allocation public.subscription_payment_allocations; subscription public.farm_subscriptions; period public.subscription_billing_periods;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  if char_length(trim(target_reason))<3 then raise exception 'A void reason is required' using errcode='22023'; end if;
  select * into payment from public.subscription_payments where id=target_payment for update;
  if payment.id is null or payment.status='voided' then raise exception 'Posted subscription payment required' using errcode='22023'; end if;
  select * into allocation from public.subscription_payment_allocations where payment_id=payment.id;
  update public.subscription_payments set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=trim(target_reason) where id=payment.id;
  perform public.refresh_subscription_billing_period(allocation.billing_period_id);
  select * into period from public.subscription_billing_periods where id=allocation.billing_period_id;
  select * into subscription from public.farm_subscriptions where id=payment.subscription_id for update;
  if period.status<>'paid' and subscription.status='active' then
    update public.farm_subscriptions set status='past_due',past_due_at=coalesce(past_due_at,now()),grace_ends_at=coalesce(grace_ends_at,current_date+(select default_grace_days from public.subscription_plans where id=subscription.plan_id)) where id=subscription.id;
  end if;
  perform public.platform_write_audit('subscription_payment.voided',payment.farm_id,'subscription_payments',payment.id,jsonb_build_object('reason',trim(target_reason)));
end;
$$;

create function public.platform_extend_subscription_grace(target_subscription uuid,target_grace_end date,target_reason text)
returns public.farm_subscriptions language plpgsql security definer set search_path='' as $$
declare subscription public.farm_subscriptions; previous_end date;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  select * into subscription from public.farm_subscriptions where id=target_subscription and ended_at is null for update;
  if subscription.id is null or subscription.status not in ('past_due','grace_period') or target_grace_end<=coalesce(subscription.grace_ends_at,current_date) or char_length(trim(target_reason))<3 then raise exception 'A later grace end date and reason are required' using errcode='22023'; end if;
  previous_end:=subscription.grace_ends_at;
  update public.farm_subscriptions set status='grace_period',grace_ends_at=target_grace_end where id=subscription.id returning * into subscription;
  perform public.platform_write_audit('subscription.grace_extended',subscription.farm_id,'farm_subscriptions',subscription.id,jsonb_build_object('old_grace_end',previous_end,'new_grace_end',target_grace_end,'reason',trim(target_reason)));
  return subscription;
end;
$$;

create function public.platform_suspend_farm_manually(target_farm uuid,target_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_platform_admin() or char_length(trim(target_reason))<3 then raise exception 'Platform administrator and reason required' using errcode='42501'; end if;
  update public.farm_accounts set account_status='suspended',suspension_source='manual',suspension_reason=trim(target_reason),suspended_at=now(),suspended_by=auth.uid() where farm_id=target_farm and account_status<>'closed';
  if not found then raise exception 'Farm account not found or closed' using errcode='22023'; end if;
  perform public.platform_write_audit('farm.manual_suspended',target_farm,'farm_accounts',target_farm,jsonb_build_object('reason',trim(target_reason)));
end;
$$;

create function public.platform_reactivate_farm_manually(target_farm uuid,target_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_platform_admin() or char_length(trim(target_reason))<3 then raise exception 'Platform administrator and reason required' using errcode='42501'; end if;
  if exists(select 1 from public.farm_subscriptions where farm_id=target_farm and ended_at is null and status='suspended') then raise exception 'Settle the suspended subscription before reactivating this farm' using errcode='23514'; end if;
  update public.farm_accounts set account_status='active',suspension_source=null,suspension_reason=null,suspended_at=null,suspended_by=null where farm_id=target_farm and account_status='suspended' and suspension_source='manual';
  if not found then raise exception 'Manually suspended farm account required' using errcode='22023'; end if;
  perform public.platform_write_audit('farm.manual_reactivated',target_farm,'farm_accounts',target_farm,jsonb_build_object('reason',trim(target_reason)));
end;
$$;

create function public.platform_reconcile_subscription_lifecycle(target_as_of date default current_date)
returns integer language plpgsql security definer set search_path='' as $$
declare subscription public.farm_subscriptions; plan public.subscription_plans; period public.subscription_billing_periods; processed integer:=0; grace_days integer;
begin
  if not public.is_platform_admin() and auth.role() <> 'service_role' then raise exception 'Platform lifecycle access required' using errcode='42501'; end if;
  for subscription in select * from public.farm_subscriptions where ended_at is null order by created_at for update skip locked loop
    processed:=processed+1;
    select * into plan from public.subscription_plans where id=subscription.plan_id;
    grace_days:=coalesce(plan.default_grace_days,0);
    if subscription.status='trialing' and subscription.trial_ends_at < target_as_of then
      period:=public.create_subscription_billing_period(subscription.id,subscription.trial_ends_at,subscription.trial_ends_at);
      update public.farm_subscriptions set status='past_due',past_due_at=coalesce(past_due_at,now()),grace_ends_at=coalesce(grace_ends_at,subscription.trial_ends_at+grace_days),next_billing_date=period.due_date where id=subscription.id;
      perform public.platform_audit_system('subscription.past_due',subscription.farm_id,'farm_subscriptions',subscription.id,jsonb_build_object('reason','trial_expired'));
    elsif subscription.status='active' then
      select * into period from public.subscription_billing_periods where subscription_id=subscription.id and status='paid' order by period_end desc limit 1;
      if period.id is not null and period.period_end <= target_as_of then
        period:=public.create_subscription_billing_period(subscription.id,period.period_end,period.period_end);
        update public.farm_subscriptions set status='past_due',past_due_at=coalesce(past_due_at,now()),grace_ends_at=coalesce(grace_ends_at,period.due_date+grace_days),next_billing_date=period.due_date where id=subscription.id;
        perform public.platform_audit_system('subscription.past_due',subscription.farm_id,'farm_subscriptions',subscription.id,jsonb_build_object('billing_period_id',period.id));
      end if;
    end if;
    select * into subscription from public.farm_subscriptions where id=subscription.id;
    if subscription.status in ('past_due','grace_period') and subscription.grace_ends_at < target_as_of then
      update public.farm_subscriptions set status='suspended',suspended_at=coalesce(suspended_at,now()) where id=subscription.id;
      update public.farm_accounts set account_status='suspended',suspension_source='billing',suspension_reason='Subscription grace period expired',suspended_at=now(),suspended_by=null where farm_id=subscription.farm_id and account_status<>'closed' and suspension_source is distinct from 'manual';
      perform public.platform_audit_system('subscription.suspended',subscription.farm_id,'farm_subscriptions',subscription.id,jsonb_build_object('reason','grace_expired'));
      perform public.platform_audit_system('farm.billing_suspended',subscription.farm_id,'farm_accounts',subscription.farm_id,jsonb_build_object('reason','grace_expired'));
    end if;
  end loop;
  return processed;
end;
$$;

create function public.platform_get_subscription_summaries(target_status text default null,target_plan uuid default null,target_cycle text default null)
returns table(subscription_id uuid,farm_id uuid,farm_name text,owner_name text,plan_id uuid,plan_name text,currency varchar(3),billing_cycle text,subscription_status text,account_status text,current_period_start date,current_period_end date,next_billing_date date,trial_ends_at date,grace_ends_at date,outstanding numeric)
language sql stable security definer set search_path='' as $$
  with current_period as (select distinct on (subscription_id) * from public.subscription_billing_periods order by subscription_id,period_end desc), paid as (select allocation.billing_period_id,coalesce(sum(allocation.amount) filter(where payment.status='posted'),0) amount from public.subscription_payment_allocations allocation join public.subscription_payments payment on payment.id=allocation.payment_id group by allocation.billing_period_id)
  select subscription.id,subscription.farm_id,farm.name,account.contact_name,subscription.plan_id,plan.name,subscription.currency,subscription.billing_cycle,subscription.status,account.account_status,subscription.current_period_start,subscription.current_period_end,subscription.next_billing_date,subscription.trial_ends_at,subscription.grace_ends_at,greatest(coalesce(period.amount_due,0)-coalesce(paid.amount,0),0)
  from public.farm_subscriptions subscription join public.farms farm on farm.id=subscription.farm_id join public.farm_accounts account on account.farm_id=subscription.farm_id join public.subscription_plans plan on plan.id=subscription.plan_id left join current_period period on period.subscription_id=subscription.id left join paid on paid.billing_period_id=period.id
  where subscription.ended_at is null and public.is_platform_admin() and (target_status is null or subscription.status=target_status) and (target_plan is null or subscription.plan_id=target_plan) and (target_cycle is null or subscription.billing_cycle=target_cycle)
  order by farm.name;
$$;

alter table public.subscription_billing_periods enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.subscription_payment_allocations enable row level security;
create policy subscription_billing_periods_platform_read on public.subscription_billing_periods for select to authenticated using(public.is_platform_admin());
create policy subscription_payments_platform_read on public.subscription_payments for select to authenticated using(public.is_platform_admin());
create policy subscription_payment_allocations_platform_read on public.subscription_payment_allocations for select to authenticated using(public.is_platform_admin());

revoke all on public.subscription_billing_periods,public.subscription_payments,public.subscription_payment_allocations from public,anon,authenticated;
grant select on public.subscription_billing_periods,public.subscription_payments,public.subscription_payment_allocations to authenticated;
grant all on public.subscription_billing_periods,public.subscription_payments,public.subscription_payment_allocations to service_role;
revoke all on function public.is_farm_member_any(uuid),public.get_farm_access_mode(uuid),public.get_my_farm_access(uuid),public.get_my_subscription_status(uuid),public.platform_create_subscription_plan(text,text,text,text,numeric,numeric,integer,integer,integer),public.platform_update_subscription_plan(uuid,text,text,text,numeric,numeric,integer,integer,integer,boolean),public.platform_extend_subscription_trial(uuid,date,text),public.platform_schedule_subscription_plan_change(uuid,uuid,text),public.platform_cancel_subscription_plan_change(uuid),public.platform_record_subscription_payment(uuid,numeric,text,text,date,text,uuid),public.platform_prepare_subscription_billing_period(uuid),public.platform_void_subscription_payment(uuid,text),public.platform_extend_subscription_grace(uuid,date,text),public.platform_suspend_farm_manually(uuid,text),public.platform_reactivate_farm_manually(uuid,text),public.platform_reconcile_subscription_lifecycle(date),public.platform_get_subscription_summaries(text,uuid,text) from public,anon;
grant execute on function public.is_farm_member_any(uuid),public.get_farm_access_mode(uuid),public.get_my_farm_access(uuid),public.get_my_subscription_status(uuid),public.platform_create_subscription_plan(text,text,text,text,numeric,numeric,integer,integer,integer),public.platform_update_subscription_plan(uuid,text,text,text,numeric,numeric,integer,integer,integer,boolean),public.platform_extend_subscription_trial(uuid,date,text),public.platform_schedule_subscription_plan_change(uuid,uuid,text),public.platform_cancel_subscription_plan_change(uuid),public.platform_record_subscription_payment(uuid,numeric,text,text,date,text,uuid),public.platform_prepare_subscription_billing_period(uuid),public.platform_void_subscription_payment(uuid,text),public.platform_extend_subscription_grace(uuid,date,text),public.platform_suspend_farm_manually(uuid,text),public.platform_reactivate_farm_manually(uuid,text),public.platform_reconcile_subscription_lifecycle(date),public.platform_get_subscription_summaries(text,uuid,text) to authenticated;
grant execute on function public.platform_reconcile_subscription_lifecycle(date) to service_role;
