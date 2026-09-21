-- Phase 3: controlled Platform Admin analytics. No tenant operational tables are queried.
create index farm_accounts_status_created_idx on public.farm_accounts(account_status,created_at desc);
create index farm_subscriptions_status_dates_idx on public.farm_subscriptions(status,trial_ends_at,next_billing_date,grace_ends_at) where ended_at is null;
create index subscription_payments_posted_paid_at_idx on public.subscription_payments(paid_at desc,currency) where status='posted';

create function public.platform_dashboard_summary(target_as_of date default current_date)
returns jsonb language sql stable security definer set search_path='' as $$
  with current_subscription as (select distinct on (farm_id) * from public.farm_subscriptions where ended_at is null order by farm_id,created_at desc),
  due_periods as (select p.id,p.farm_id,p.subscription_id,p.currency,p.amount_due,p.due_date,coalesce(sum(a.amount) filter(where pay.status='posted'),0) paid from public.subscription_billing_periods p left join public.subscription_payment_allocations a on a.billing_period_id=p.id left join public.subscription_payments pay on pay.id=a.payment_id group by p.id),
  active_users as (select count(distinct m.user_id) count from public.farm_members m join public.farm_accounts a on a.farm_id=m.farm_id where m.active and a.account_status in ('active','onboarding')),
  metrics as (select count(*) filter(where a.account_status<>'closed') total_farms, count(*) filter(where a.account_status='active' and o.status='completed' and s.status='active') active_farms, count(*) filter(where a.account_status='onboarding') onboarding_farms, count(*) filter(where s.status='trialing') trial_farms, count(*) filter(where s.status='past_due') past_due_farms, count(*) filter(where s.status='grace_period') grace_farms, count(*) filter(where a.account_status='suspended' or s.status='suspended') suspended_farms, count(*) filter(where date_trunc('month',a.created_at)=date_trunc('month',target_as_of)) new_farms from public.farm_accounts a join public.farm_onboarding o on o.farm_id=a.farm_id left join current_subscription s on s.farm_id=a.farm_id),
  mrr as (select s.currency,coalesce(sum(case when s.billing_cycle='annual' then s.price_snapshot/12 else s.price_snapshot end),0) amount,count(*) subscriptions from current_subscription s where s.status='active' group by s.currency),
  cash as (select p.currency,coalesce(sum(p.amount),0) amount from public.subscription_payments p where p.status='posted' and date_trunc('month',p.paid_at)=date_trunc('month',target_as_of) group by p.currency),
  outstanding as (select d.currency,coalesce(sum(d.amount_due-d.paid),0) amount from due_periods d where d.due_date<=target_as_of and d.amount_due>d.paid group by d.currency)
  select case when not public.is_platform_admin() then null else jsonb_build_object('as_of',target_as_of,'metrics',(select to_jsonb(metrics) from metrics),'active_users',(select count from active_users),'mrr_by_currency',coalesce((select jsonb_agg(jsonb_build_object('currency',currency,'amount',amount,'subscriptions',subscriptions)) from mrr),'[]'::jsonb),'cash_by_currency',coalesce((select jsonb_agg(jsonb_build_object('currency',currency,'amount',amount)) from cash),'[]'::jsonb),'outstanding_by_currency',coalesce((select jsonb_agg(jsonb_build_object('currency',currency,'amount',amount)) from outstanding),'[]'::jsonb)) end;
$$;

create function public.platform_attention_items(target_as_of date default current_date)
returns table(kind text,farm_id uuid,subscription_id uuid,invitation_id uuid,title text,detail text,attention_date date,priority integer)
language sql stable security definer set search_path='' as $$
  with subscriptions as (select distinct on (farm_id) * from public.farm_subscriptions where ended_at is null order by farm_id,created_at desc), periods as (select p.id,p.farm_id,p.subscription_id,p.due_date,p.amount_due,coalesce(sum(a.amount) filter(where pay.status='posted'),0) paid from public.subscription_billing_periods p left join public.subscription_payment_allocations a on a.billing_period_id=p.id left join public.subscription_payments pay on pay.id=a.payment_id group by p.id), invitations as (select distinct on (farm_id) * from public.farm_invitations where is_owner_invitation order by farm_id,created_at desc)
  select * from (
    select 'trial_expiring'::text,f.id,s.id,null::uuid,f.name,'Trial ends in '||(s.trial_ends_at-target_as_of)||' days',s.trial_ends_at,3 from subscriptions s join public.farms f on f.id=s.farm_id where s.status='trialing' and s.trial_ends_at between target_as_of and target_as_of+7
    union all select 'past_due',f.id,s.id,null::uuid,f.name,'Payment overdue by '||(target_as_of-p.due_date)||' days',p.due_date,1 from periods p join subscriptions s on s.id=p.subscription_id join public.farms f on f.id=p.farm_id where s.status='past_due' and p.due_date<=target_as_of and p.amount_due>p.paid
    union all select 'grace_ending',f.id,s.id,null::uuid,f.name,'Grace access ends in '||(s.grace_ends_at-target_as_of)||' days',s.grace_ends_at,1 from subscriptions s join public.farms f on f.id=s.farm_id where s.status='grace_period' and s.grace_ends_at between target_as_of and target_as_of+3
    union all select 'suspended',a.farm_id,s.id,null::uuid,f.name,'Farm access is suspended',a.suspended_at::date,2 from public.farm_accounts a join public.farms f on f.id=a.farm_id left join subscriptions s on s.farm_id=a.farm_id where a.account_status='suspended' or s.status='suspended'
    union all select 'invitation_delivery_failed',a.farm_id,null::uuid,i.id,f.name,'Owner invitation delivery failed',i.created_at::date,1 from invitations i join public.farm_accounts a on a.farm_id=i.farm_id join public.farms f on f.id=i.farm_id where i.status='pending' and i.delivery_status='failed'
    union all select 'pending_invitation',a.farm_id,null::uuid,i.id,f.name,'Owner invitation pending',i.created_at::date,4 from invitations i join public.farm_accounts a on a.farm_id=i.farm_id join public.farms f on f.id=i.farm_id where i.status='pending' and i.delivery_status<>'failed' and i.expires_at>now()
    union all select 'incomplete_onboarding',a.farm_id,s.id,null::uuid,f.name,'Onboarding is incomplete',a.created_at::date,4 from public.farm_accounts a join public.farm_onboarding o on o.farm_id=a.farm_id join public.farms f on f.id=a.farm_id left join subscriptions s on s.farm_id=a.farm_id where a.account_status='onboarding' and o.status<>'completed'
  ) items where public.is_platform_admin() order by 8,7;
$$;

revoke all on function public.platform_dashboard_summary(date),public.platform_attention_items(date) from public,anon;
grant execute on function public.platform_dashboard_summary(date),public.platform_attention_items(date) to authenticated;

create function public.platform_farm_portfolio(target_search text default null,target_account_status text default null,target_subscription_status text default null,target_plan uuid default null,target_onboarding_status text default null,target_limit integer default 25,target_offset integer default 0)
returns table(farm_id uuid,farm_name text,owner_name text,owner_email text,owner_phone text,account_status text,subscription_status text,plan_name text,onboarding_status text,onboarding_percentage integer,user_count bigint,next_billing_date date,outstanding numeric,currency varchar(3),created_at timestamptz,total_count bigint)
language sql stable security definer set search_path='' as $$
  with subscriptions as (select distinct on (farm_id) * from public.farm_subscriptions where ended_at is null order by farm_id,created_at desc), paid as (select p.id,coalesce(sum(a.amount) filter(where pay.status='posted'),0) amount from public.subscription_billing_periods p left join public.subscription_payment_allocations a on a.billing_period_id=p.id left join public.subscription_payments pay on pay.id=a.payment_id group by p.id), rows as (select a.farm_id,f.name,a.contact_name,a.contact_email,a.contact_phone,a.account_status,s.status,plan.name,o.status,(case when o.account_completed_at is not null then 25 else 0 end + case when o.farm_settings_completed_at is not null then 25 else 0 end + case when o.first_flock_completed_at is not null or o.first_flock_skipped_at is not null then 25 else 0 end + case when o.opening_stock_completed_at is not null or o.opening_stock_skipped_at is not null then 25 else 0 end)::integer,(select count(*) from public.farm_members m where m.farm_id=a.farm_id and m.active),s.next_billing_date,coalesce((select max(p.amount_due-coalesce(paid.amount,0)) from public.subscription_billing_periods p left join paid on paid.id=p.id where p.subscription_id=s.id and p.due_date<=current_date),0),s.currency,a.created_at from public.farm_accounts a join public.farms f on f.id=a.farm_id join public.farm_onboarding o on o.farm_id=a.farm_id left join subscriptions s on s.farm_id=a.farm_id left join public.subscription_plans plan on plan.id=s.plan_id where public.is_platform_admin() and (target_search is null or f.name ilike '%'||target_search||'%' or a.contact_name ilike '%'||target_search||'%' or a.contact_email ilike '%'||target_search||'%' or coalesce(a.contact_phone,'') ilike '%'||target_search||'%') and (target_account_status is null or a.account_status=target_account_status) and (target_subscription_status is null or s.status=target_subscription_status) and (target_plan is null or s.plan_id=target_plan) and (target_onboarding_status is null or o.status=target_onboarding_status)) select *,count(*) over() from rows order by created_at desc limit greatest(1,least(target_limit,100)) offset greatest(target_offset,0);
$$;
revoke all on function public.platform_farm_portfolio(text,text,text,uuid,text,integer,integer) from public,anon;
grant execute on function public.platform_farm_portfolio(text,text,text,uuid,text,integer,integer) to authenticated;

create function public.platform_trial_portfolio(target_window_days integer default 7,target_include_all boolean default false,target_limit integer default 50,target_offset integer default 0)
returns table(subscription_id uuid,farm_id uuid,farm_name text,owner_name text,plan_name text,trial_ends_at date,days_remaining integer,total_count bigint)
language sql stable security definer set search_path='' as $$
  with rows(subscription_id,farm_id,farm_name,owner_name,plan_name,trial_ends_at,days_remaining) as (
    select s.id,s.farm_id,f.name,a.contact_name,p.name,s.trial_ends_at,(s.trial_ends_at-current_date)::integer
    from public.farm_subscriptions s
    join public.farms f on f.id=s.farm_id
    join public.farm_accounts a on a.farm_id=s.farm_id
    join public.subscription_plans p on p.id=s.plan_id
    where public.is_platform_admin()
      and s.ended_at is null
      and s.status='trialing'
      and (target_include_all or s.trial_ends_at <= current_date + greatest(1,least(target_window_days,365)))
  )
  select *,count(*) over()
  from rows
  order by trial_ends_at nulls last,farm_name
  limit greatest(1,least(target_limit,100)) offset greatest(target_offset,0);
$$;

create function public.platform_upcoming_renewals(target_window_days integer default 7,target_limit integer default 50,target_offset integer default 0)
returns table(subscription_id uuid,farm_id uuid,farm_name text,owner_name text,plan_name text,billing_cycle text,currency varchar(3),next_billing_date date,expected_amount numeric,subscription_status text,total_count bigint)
language sql stable security definer set search_path='' as $$
  with rows(subscription_id,farm_id,farm_name,owner_name,plan_name,billing_cycle,currency,next_billing_date,expected_amount,subscription_status) as (
    select s.id,s.farm_id,f.name,a.contact_name,p.name,s.billing_cycle,s.currency,s.next_billing_date,s.price_snapshot,s.status
    from public.farm_subscriptions s
    join public.farms f on f.id=s.farm_id
    join public.farm_accounts a on a.farm_id=s.farm_id
    join public.subscription_plans p on p.id=s.plan_id
    where public.is_platform_admin()
      and s.ended_at is null
      and s.status in ('active','trialing','past_due','grace_period')
      and s.next_billing_date between current_date and current_date + greatest(1,least(target_window_days,365))
  )
  select *,count(*) over()
  from rows
  order by next_billing_date,farm_name
  limit greatest(1,least(target_limit,100)) offset greatest(target_offset,0);
$$;

create function public.platform_subscription_collections(target_category text default null,target_limit integer default 50,target_offset integer default 0)
returns table(billing_period_id uuid,subscription_id uuid,farm_id uuid,farm_name text,owner_name text,plan_name text,billing_period_status text,collection_status text,due_date date,amount_due numeric,amount_paid numeric,outstanding numeric,currency varchar(3),total_count bigint)
language sql stable security definer set search_path='' as $$
  with paid as (
    select a.billing_period_id,coalesce(sum(a.amount) filter(where p.status='posted'),0) amount
    from public.subscription_payment_allocations a
    join public.subscription_payments p on p.id=a.payment_id
    group by a.billing_period_id
  ), rows(billing_period_id,subscription_id,farm_id,farm_name,owner_name,plan_name,billing_period_status,collection_status,due_date,amount_due,amount_paid,outstanding,currency) as (
    select bp.id,bp.subscription_id,bp.farm_id,f.name,fa.contact_name,bp.plan_name_snapshot,bp.status,
      case
        when s.status='suspended' then 'suspended'
        when s.status='grace_period' then 'grace_period'
        when greatest(bp.amount_due-coalesce(p.amount,0),0)=0 then 'paid'
        when bp.due_date < current_date then 'past_due'
        when bp.due_date <= current_date+7 then 'due_soon'
        else 'scheduled'
      end,
      bp.due_date,bp.amount_due,coalesce(p.amount,0),greatest(bp.amount_due-coalesce(p.amount,0),0),bp.currency
    from public.subscription_billing_periods bp
    join public.farm_subscriptions s on s.id=bp.subscription_id
    join public.farms f on f.id=bp.farm_id
    join public.farm_accounts fa on fa.farm_id=bp.farm_id
    left join paid p on p.billing_period_id=bp.id
    where public.is_platform_admin()
      and (target_category is null or target_category = case
        when s.status='suspended' then 'suspended'
        when s.status='grace_period' then 'grace_period'
        when greatest(bp.amount_due-coalesce(p.amount,0),0)=0 then 'paid'
        when bp.due_date < current_date then 'past_due'
        when bp.due_date <= current_date+7 then 'due_soon'
        else 'scheduled'
      end)
  )
  select *,count(*) over()
  from rows
  order by case collection_status when 'past_due' then 1 when 'grace_period' then 2 when 'suspended' then 3 when 'due_soon' then 4 else 5 end,due_date,farm_name
  limit greatest(1,least(target_limit,100)) offset greatest(target_offset,0);
$$;

revoke all on function public.platform_trial_portfolio(integer,boolean,integer,integer),public.platform_upcoming_renewals(integer,integer,integer),public.platform_subscription_collections(text,integer,integer) from public,anon;
grant execute on function public.platform_trial_portfolio(integer,boolean,integer,integer),public.platform_upcoming_renewals(integer,integer,integer),public.platform_subscription_collections(text,integer,integer) to authenticated;
