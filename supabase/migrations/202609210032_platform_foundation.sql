-- HabFarms Platform Phase 1: control-plane identity, tenant accounts, and owner onboarding.
-- Platform administrators manage customer tenancy metadata only. They are never granted
-- unrestricted access to farm operational records.

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete restrict,
  platform_role text not null default 'super_admin' check (platform_role in ('super_admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(trim(code)) and code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name text not null check (char_length(trim(name)) between 2 and 80),
  description text,
  currency varchar(3) not null default 'GHS' check (currency ~ '^[A-Z]{3}$'),
  monthly_price numeric(14,2) check (monthly_price is null or monthly_price >= 0),
  annual_price numeric(14,2) check (annual_price is null or annual_price >= 0),
  default_trial_days integer not null default 14 check (default_trial_days between 0 and 365),
  default_grace_days integer not null default 0 check (default_grace_days between 0 and 365),
  max_users integer check (max_users is null or max_users > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.farm_accounts (
  farm_id uuid primary key references public.farms(id) on delete restrict,
  account_status text not null default 'invited' check (account_status in ('invited','onboarding','active','suspended','closed')),
  primary_owner_user_id uuid references public.profiles(id) on delete set null,
  contact_name text not null check (char_length(trim(contact_name)) between 2 and 160),
  contact_email text not null check (contact_email = lower(trim(contact_email)) and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'),
  contact_phone text,
  country text,
  internal_notes text,
  created_by_platform_admin uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  suspended_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.farm_subscriptions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  status text not null check (status in ('trialing','active','past_due','grace_period','suspended','cancelled')),
  billing_cycle text not null check (billing_cycle in ('monthly','annual')),
  currency varchar(3) not null check (currency ~ '^[A-Z]{3}$'),
  price_snapshot numeric(14,2) check (price_snapshot is null or price_snapshot >= 0),
  started_at date not null,
  current_period_start date,
  current_period_end date,
  next_billing_date date,
  trial_started_at date,
  trial_ends_at date,
  grace_ends_at date,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint farm_subscriptions_trial_dates check ((status <> 'trialing') or (trial_started_at is not null and trial_ends_at is not null and trial_ends_at >= trial_started_at))
);
create unique index farm_subscriptions_one_current_idx on public.farm_subscriptions(farm_id) where ended_at is null;

create table public.farm_onboarding (
  farm_id uuid primary key references public.farms(id) on delete restrict,
  status text not null default 'not_started' check (status in ('not_started','in_progress','completed')),
  current_step text not null default 'account' check (current_step in ('account','farm_details','operating_settings','first_flock','opening_stock','finish')),
  account_completed_at timestamptz,
  farm_settings_completed_at timestamptz,
  first_flock_completed_at timestamptz,
  opening_stock_completed_at timestamptz,
  completed_at timestamptz,
  started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint farm_onboarding_completed_status check ((status <> 'completed') or completed_at is not null)
);

create table public.platform_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  farm_id uuid references public.farms(id) on delete restrict,
  target_type text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint platform_audit_logs_no_sensitive_metadata check (
    not (metadata ?| array['password','token','raw_token','access_token','refresh_token','service_role_key','smtp_password'])
  )
);

alter table public.farm_invitations add column is_owner_invitation boolean not null default false;
alter table public.farm_invitations add column expires_at timestamptz;
alter table public.farm_invitations add column send_attempt_count integer not null default 0 check (send_attempt_count >= 0);
alter table public.farm_invitations add column delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','failed'));
create index farm_invitations_owner_status_idx on public.farm_invitations(is_owner_invitation,status,expires_at) where is_owner_invitation;

create index farm_accounts_status_idx on public.farm_accounts(account_status,created_at desc);
create index farm_accounts_owner_idx on public.farm_accounts(primary_owner_user_id) where primary_owner_user_id is not null;
create index farm_subscriptions_status_idx on public.farm_subscriptions(status,next_billing_date) where ended_at is null;
create index farm_onboarding_status_idx on public.farm_onboarding(status,updated_at desc);
create index platform_audit_logs_farm_created_idx on public.platform_audit_logs(farm_id,created_at desc);
create index platform_audit_logs_actor_created_idx on public.platform_audit_logs(actor_user_id,created_at desc);

create trigger subscription_plans_updated_at before update on public.subscription_plans for each row execute function public.set_updated_at();
create trigger farm_accounts_updated_at before update on public.farm_accounts for each row execute function public.set_updated_at();
create trigger farm_subscriptions_updated_at before update on public.farm_subscriptions for each row execute function public.set_updated_at();
create trigger farm_onboarding_updated_at before update on public.farm_onboarding for each row execute function public.set_updated_at();

create function public.is_platform_admin()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.platform_admins where user_id=auth.uid() and is_active and platform_role='super_admin');
$$;

create function public.platform_write_audit(target_action text,target_farm uuid,target_type text,target_id uuid,target_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  if target_metadata ?| array['password','token','raw_token','access_token','refresh_token','service_role_key','smtp_password'] then raise exception 'Sensitive audit metadata is prohibited' using errcode='22023'; end if;
  insert into public.platform_audit_logs(actor_user_id,action,farm_id,target_type,target_id,metadata)
  values(auth.uid(),target_action,target_farm,target_type,target_id,coalesce(target_metadata,'{}'::jsonb));
end;
$$;

create function public.platform_create_farm(
  target_farm_name text,
  target_owner_name text,
  target_owner_email text,
  target_owner_phone text,
  target_country text,
  target_internal_notes text,
  target_plan uuid,
  target_trial_enabled boolean,
  target_trial_days integer,
  target_billing_cycle text,
  target_start_date date
)
returns table(farm_id uuid, invitation_id uuid, subscription_id uuid)
language plpgsql security definer set search_path='' as $$
declare created_farm public.farms; created_invitation public.farm_invitations; created_subscription public.farm_subscriptions;
  plan public.subscription_plans; normalized_email text; trial_days integer; snapshot_price numeric;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  normalized_email:=lower(trim(target_owner_email));
  if char_length(trim(target_farm_name)) not between 2 and 120 or char_length(trim(target_owner_name)) not between 2 and 160 or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' then raise exception 'Invalid farm or owner details' using errcode='22023'; end if;
  if target_billing_cycle not in ('monthly','annual') then raise exception 'Invalid billing cycle' using errcode='22023'; end if;
  select * into plan from public.subscription_plans where id=target_plan and is_active for share;
  if plan.id is null then raise exception 'Active subscription plan required' using errcode='23514'; end if;
  trial_days:=coalesce(target_trial_days,plan.default_trial_days);
  if trial_days<0 or trial_days>365 then raise exception 'Invalid trial duration' using errcode='22023'; end if;
  snapshot_price:=case when target_billing_cycle='monthly' then plan.monthly_price else plan.annual_price end;
  insert into public.farms(name,currency) values(trim(target_farm_name),plan.currency) returning * into created_farm;
  insert into public.farm_settings(farm_id) values(created_farm.id);
  insert into public.farm_accounts(farm_id,account_status,contact_name,contact_email,contact_phone,country,internal_notes,created_by_platform_admin)
  values(created_farm.id,'invited',trim(target_owner_name),normalized_email,nullif(trim(target_owner_phone),''),nullif(trim(target_country),''),nullif(trim(target_internal_notes),''),auth.uid());
  insert into public.farm_onboarding(farm_id) values(created_farm.id);
  insert into public.farm_subscriptions(farm_id,plan_id,status,billing_cycle,currency,price_snapshot,started_at,trial_started_at,trial_ends_at)
  values(created_farm.id,plan.id,case when target_trial_enabled then 'trialing' else 'active' end,target_billing_cycle,plan.currency,snapshot_price,coalesce(target_start_date,current_date),case when target_trial_enabled then coalesce(target_start_date,current_date) end,case when target_trial_enabled then coalesce(target_start_date,current_date)+trial_days end)
  returning * into created_subscription;
  insert into public.farm_invitations(farm_id,email,role,invited_by,is_owner_invitation,expires_at,delivery_status)
  values(created_farm.id,normalized_email,'admin',auth.uid(),true,now()+interval '7 days','pending') returning * into created_invitation;
  perform public.platform_write_audit('farm.created',created_farm.id,'farms',created_farm.id,jsonb_build_object('account_status','invited','plan_code',plan.code));
  perform public.platform_write_audit('subscription.created',created_farm.id,'farm_subscriptions',created_subscription.id,jsonb_build_object('plan_code',plan.code,'status',created_subscription.status,'billing_cycle',target_billing_cycle));
  perform public.platform_write_audit('owner.invited',created_farm.id,'farm_invitations',created_invitation.id,jsonb_build_object('email',normalized_email));
  return query select created_farm.id,created_invitation.id,created_subscription.id;
end;
$$;

create or replace function public.accept_farm_invitation(target_invitation uuid)
returns public.farm_members language plpgsql security definer set search_path='' as $$
declare invitation public.farm_invitations; verified_email text; member public.farm_members;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  verified_email:=lower(coalesce(auth.jwt()->>'email',''));
  select * into invitation from public.farm_invitations where id=target_invitation for update;
  if invitation.id is null or invitation.status<>'pending' or invitation.email<>verified_email or (invitation.expires_at is not null and invitation.expires_at<=now()) then raise exception 'This invitation is no longer valid' using errcode='42501'; end if;
  insert into public.farm_members(farm_id,user_id,role,active) values(invitation.farm_id,auth.uid(),invitation.role,true)
  on conflict(farm_id,user_id) do update set role=excluded.role,active=true,updated_at=now() returning * into member;
  update public.farm_invitations set status='accepted',auth_user_id=auth.uid(),accepted_at=now(),delivery_status='sent' where id=invitation.id;
  if invitation.is_owner_invitation then
    update public.farm_accounts set primary_owner_user_id=auth.uid(),account_status='onboarding',updated_at=now() where farm_id=invitation.farm_id and primary_owner_user_id is null;
    if not found then raise exception 'Primary owner is already assigned' using errcode='23514'; end if;
    update public.farm_onboarding set status='in_progress',current_step='farm_details',account_completed_at=coalesce(account_completed_at,now()),started_at=coalesce(started_at,now()) where farm_id=invitation.farm_id;
    insert into public.platform_audit_logs(actor_user_id,action,farm_id,target_type,target_id,metadata) values(auth.uid(),'owner.invitation_accepted',invitation.farm_id,'farm_invitations',invitation.id,jsonb_build_object('owner_user_id',auth.uid()));
    insert into public.platform_audit_logs(actor_user_id,action,farm_id,target_type,target_id,metadata) values(auth.uid(),'onboarding.started',invitation.farm_id,'farm_onboarding',invitation.farm_id,'{}'::jsonb);
  end if;
  return member;
end;
$$;

create function public.platform_resend_owner_invitation(target_invitation uuid)
returns public.farm_invitations language plpgsql security definer set search_path='' as $$
declare invitation public.farm_invitations;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  select * into invitation from public.farm_invitations where id=target_invitation for update;
  if invitation.id is null or not invitation.is_owner_invitation or invitation.status<>'pending' then raise exception 'Owner invitation cannot be resent' using errcode='42501'; end if;
  if invitation.last_sent_at>now()-interval '60 seconds' then raise exception 'Please wait before resending this invitation' using errcode='42900'; end if;
  update public.farm_invitations set last_sent_at=now(),expires_at=now()+interval '7 days',send_attempt_count=send_attempt_count+1,delivery_status='pending' where id=invitation.id returning * into invitation;
  perform public.platform_write_audit('owner.invitation_resent',invitation.farm_id,'farm_invitations',invitation.id,jsonb_build_object('email',invitation.email));
  return invitation;
end;
$$;

create function public.platform_revoke_owner_invitation(target_invitation uuid)
returns void language plpgsql security definer set search_path='' as $$
declare invitation public.farm_invitations;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  select * into invitation from public.farm_invitations where id=target_invitation for update;
  if invitation.id is null or not invitation.is_owner_invitation or invitation.status<>'pending' then raise exception 'Owner invitation cannot be revoked' using errcode='42501'; end if;
  update public.farm_invitations set status='revoked',revoked_at=now(),revoked_by=auth.uid() where id=invitation.id;
  perform public.platform_write_audit('owner.invitation_revoked',invitation.farm_id,'farm_invitations',invitation.id,jsonb_build_object('email',invitation.email));
end;
$$;

create function public.platform_mark_owner_invitation_delivery(target_invitation uuid,target_delivered boolean)
returns void language plpgsql security definer set search_path='' as $$
declare invitation public.farm_invitations;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  select * into invitation from public.farm_invitations where id=target_invitation for update;
  if invitation.id is null or not invitation.is_owner_invitation then raise exception 'Owner invitation not found' using errcode='42501'; end if;
  update public.farm_invitations set delivery_status=case when target_delivered then 'sent' else 'failed' end,send_attempt_count=send_attempt_count+1,last_sent_at=now() where id=invitation.id;
end;
$$;

create function public.platform_link_owner_invitation_auth_user(target_invitation uuid,target_auth_user uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  update public.farm_invitations set auth_user_id=target_auth_user where id=target_invitation and is_owner_invitation and status='pending';
  if not found then raise exception 'Owner invitation not found' using errcode='42501'; end if;
end;
$$;

create function public.platform_get_farm_summaries(target_search text default null,target_account_status text default null,target_plan_id uuid default null,target_onboarding_status text default null)
returns table(farm_id uuid,farm_name text,owner_name text,owner_email text,owner_phone text,account_status text,plan_id uuid,plan_name text,subscription_status text,onboarding_status text,onboarding_percentage integer,user_count bigint,created_at timestamptz,invitation_status text,invitation_id uuid)
language sql stable security definer set search_path='' as $$
  with current_subscription as (select distinct on (farm_id) farm_id,plan_id,status from public.farm_subscriptions where ended_at is null order by farm_id,created_at desc), owner_invitation as (select distinct on (farm_id) farm_id,id,status,expires_at from public.farm_invitations where is_owner_invitation order by farm_id,created_at desc), counts as (select farm_id,count(*) filter(where active) as user_count from public.farm_members group by farm_id)
  select a.farm_id,f.name,a.contact_name,a.contact_email,a.contact_phone,a.account_status,subscription.plan_id,plan.name,subscription.status,onboarding.status,
    (case when onboarding.account_completed_at is not null then 25 else 0 end + case when onboarding.farm_settings_completed_at is not null then 25 else 0 end + case when onboarding.first_flock_completed_at is not null then 25 else 0 end + case when onboarding.opening_stock_completed_at is not null then 25 else 0 end)::integer,
    coalesce(counts.user_count,0),a.created_at,case when invitation.status='pending' and invitation.expires_at is not null and invitation.expires_at<=now() then 'expired' else coalesce(invitation.status,'none') end,invitation.id
  from public.farm_accounts a join public.farms f on f.id=a.farm_id join public.farm_onboarding onboarding on onboarding.farm_id=a.farm_id
  left join current_subscription subscription on subscription.farm_id=a.farm_id left join public.subscription_plans plan on plan.id=subscription.plan_id left join owner_invitation invitation on invitation.farm_id=a.farm_id left join counts on counts.farm_id=a.farm_id
  where public.is_platform_admin() and (target_search is null or f.name ilike '%'||target_search||'%' or a.contact_name ilike '%'||target_search||'%' or a.contact_email ilike '%'||target_search||'%' or coalesce(a.contact_phone,'') ilike '%'||target_search||'%') and (target_account_status is null or a.account_status=target_account_status) and (target_plan_id is null or subscription.plan_id=target_plan_id) and (target_onboarding_status is null or onboarding.status=target_onboarding_status)
  order by a.created_at desc;
$$;

create function public.platform_get_farm_detail(target_farm uuid)
returns table(farm_id uuid,farm_name text,contact_name text,contact_email text,contact_phone text,country text,account_status text,primary_owner_user_id uuid,plan_id uuid,plan_name text,subscription_status text,billing_cycle text,trial_ends_at date,onboarding_status text,current_step text,account_completed_at timestamptz,farm_settings_completed_at timestamptz,first_flock_completed_at timestamptz,opening_stock_completed_at timestamptz,completed_at timestamptz,user_count bigint,invitation_id uuid,invitation_status text,invitation_email text,invitation_delivery_status text,invitation_expires_at timestamptz)
language sql stable security definer set search_path='' as $$
  with subscription as (select * from public.farm_subscriptions where farm_id=target_farm and ended_at is null order by created_at desc limit 1), invitation as (select * from public.farm_invitations where farm_id=target_farm and is_owner_invitation order by created_at desc limit 1), counts as (select count(*) filter(where active) as user_count from public.farm_members where farm_id=target_farm)
  select a.farm_id,f.name,a.contact_name,a.contact_email,a.contact_phone,a.country,a.account_status,a.primary_owner_user_id,subscription.plan_id,plan.name,subscription.status,subscription.billing_cycle,subscription.trial_ends_at,onboarding.status,onboarding.current_step,onboarding.account_completed_at,onboarding.farm_settings_completed_at,onboarding.first_flock_completed_at,onboarding.opening_stock_completed_at,onboarding.completed_at,counts.user_count,invitation.id,case when invitation.status='pending' and invitation.expires_at is not null and invitation.expires_at<=now() then 'expired' else invitation.status end,invitation.email,invitation.delivery_status,invitation.expires_at
  from public.farm_accounts a join public.farms f on f.id=a.farm_id join public.farm_onboarding onboarding on onboarding.farm_id=a.farm_id left join subscription on true left join public.subscription_plans plan on plan.id=subscription.plan_id left join invitation on true cross join counts
  where a.farm_id=target_farm and public.is_platform_admin();
$$;

alter table public.platform_admins enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.farm_accounts enable row level security;
alter table public.farm_subscriptions enable row level security;
alter table public.farm_onboarding enable row level security;
alter table public.platform_audit_logs enable row level security;

create policy platform_admins_read_self on public.platform_admins for select to authenticated using(user_id=auth.uid());
create policy subscription_plans_platform_read on public.subscription_plans for select to authenticated using(public.is_platform_admin());
create policy farm_accounts_platform_read on public.farm_accounts for select to authenticated using(public.is_platform_admin());
create policy farm_accounts_member_read on public.farm_accounts for select to authenticated using(public.is_farm_member(farm_id));
create policy farm_subscriptions_platform_read on public.farm_subscriptions for select to authenticated using(public.is_platform_admin());
create policy farm_subscriptions_member_read on public.farm_subscriptions for select to authenticated using(public.is_farm_member(farm_id));
create policy farm_onboarding_platform_read on public.farm_onboarding for select to authenticated using(public.is_platform_admin());
create policy farm_onboarding_member_read on public.farm_onboarding for select to authenticated using(public.is_farm_member(farm_id));
create policy platform_audit_logs_platform_read on public.platform_audit_logs for select to authenticated using(public.is_platform_admin());

revoke all on public.platform_admins,public.subscription_plans,public.farm_accounts,public.farm_subscriptions,public.farm_onboarding,public.platform_audit_logs from public,anon,authenticated;
grant select on public.platform_admins,public.subscription_plans,public.farm_accounts,public.farm_subscriptions,public.farm_onboarding,public.platform_audit_logs to authenticated;
grant all on public.platform_admins,public.subscription_plans,public.farm_accounts,public.farm_subscriptions,public.farm_onboarding,public.platform_audit_logs to service_role;
revoke all on function public.is_platform_admin(),public.platform_write_audit(text,uuid,text,uuid,jsonb),public.platform_create_farm(text,text,text,text,text,text,uuid,boolean,integer,text,date),public.platform_resend_owner_invitation(uuid),public.platform_revoke_owner_invitation(uuid),public.platform_mark_owner_invitation_delivery(uuid,boolean),public.platform_link_owner_invitation_auth_user(uuid,uuid),public.platform_get_farm_summaries(text,text,uuid,text),public.platform_get_farm_detail(uuid) from public,anon;
grant execute on function public.is_platform_admin(),public.platform_create_farm(text,text,text,text,text,text,uuid,boolean,integer,text,date),public.platform_resend_owner_invitation(uuid),public.platform_revoke_owner_invitation(uuid),public.platform_mark_owner_invitation_delivery(uuid,boolean),public.platform_link_owner_invitation_auth_user(uuid,uuid),public.platform_get_farm_summaries(text,text,uuid,text),public.platform_get_farm_detail(uuid) to authenticated;

insert into public.subscription_plans(code,name,description,currency,monthly_price,annual_price,default_trial_days,is_active)
values ('STARTER','Starter','Initial HabFarms customer plan. Configure commercial pricing before customer billing.','GHS',null,null,14,true),('STANDARD','Standard','Initial HabFarms customer plan. Configure commercial pricing before customer billing.','GHS',null,null,14,true),('BUSINESS','Business','Initial HabFarms customer plan. Configure commercial pricing before customer billing.','GHS',null,null,14,true)
on conflict(code) do nothing;
