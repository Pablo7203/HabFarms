-- Phase 1 onboarding milestones distinguish a verified real record from an owner choosing
-- to skip an optional setup step. The tracker never becomes a replacement inventory/flock ledger.

alter table public.farm_onboarding add column first_flock_skipped_at timestamptz;
alter table public.farm_onboarding add column opening_stock_skipped_at timestamptz;

create function public.mark_platform_onboarding_settings(target_farm uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.farm_accounts where farm_id=target_farm and account_status='onboarding' and primary_owner_user_id=auth.uid()) then raise exception 'Onboarding access denied' using errcode='42501'; end if;
  update public.farm_onboarding set farm_settings_completed_at=coalesce(farm_settings_completed_at,now()),current_step='first_flock' where farm_id=target_farm;
end;
$$;

create function public.mark_platform_onboarding_first_flock(target_farm uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.farm_accounts where farm_id=target_farm and account_status='onboarding' and primary_owner_user_id=auth.uid()) or not exists(select 1 from public.flocks where farm_id=target_farm) then raise exception 'Onboarding flock milestone denied' using errcode='42501'; end if;
  update public.farm_onboarding set first_flock_completed_at=coalesce(first_flock_completed_at,now()),current_step='opening_stock' where farm_id=target_farm;
end;
$$;

create function public.skip_platform_onboarding_step(target_farm uuid,target_step text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.farm_accounts where farm_id=target_farm and account_status='onboarding' and primary_owner_user_id=auth.uid()) then raise exception 'Onboarding access denied' using errcode='42501'; end if;
  if target_step='first_flock' then update public.farm_onboarding set first_flock_skipped_at=coalesce(first_flock_skipped_at,now()),current_step='opening_stock' where farm_id=target_farm;
  elsif target_step='opening_stock' then update public.farm_onboarding set opening_stock_skipped_at=coalesce(opening_stock_skipped_at,now()),current_step='finish' where farm_id=target_farm;
  else raise exception 'Invalid skippable onboarding step' using errcode='22023'; end if;
end;
$$;

create function public.complete_platform_onboarding(target_farm uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.farm_accounts where farm_id=target_farm and account_status='onboarding' and primary_owner_user_id=auth.uid()) then raise exception 'Onboarding access denied' using errcode='42501'; end if;
  if not exists(select 1 from public.farm_onboarding where farm_id=target_farm and account_completed_at is not null and farm_settings_completed_at is not null) then raise exception 'Complete required farm settings before finishing onboarding' using errcode='23514'; end if;
  update public.farm_onboarding set status='completed',current_step='finish',completed_at=coalesce(completed_at,now()) where farm_id=target_farm;
  update public.farm_accounts set account_status='active',activated_at=coalesce(activated_at,now()) where farm_id=target_farm;
  insert into public.platform_audit_logs(actor_user_id,action,farm_id,target_type,target_id,metadata) values(auth.uid(),'onboarding.completed',target_farm,'farm_onboarding',target_farm,'{}'::jsonb);
end;
$$;

drop function public.platform_get_farm_summaries(text,text,uuid,text);
create function public.platform_get_farm_summaries(target_search text default null,target_account_status text default null,target_plan_id uuid default null,target_onboarding_status text default null)
returns table(farm_id uuid,farm_name text,owner_name text,owner_email text,owner_phone text,account_status text,plan_id uuid,plan_name text,subscription_status text,onboarding_status text,onboarding_percentage integer,user_count bigint,created_at timestamptz,invitation_status text,invitation_id uuid)
language sql stable security definer set search_path='' as $$
  with current_subscription as (select distinct on (farm_id) farm_id,plan_id,status from public.farm_subscriptions where ended_at is null order by farm_id,created_at desc), owner_invitation as (select distinct on (farm_id) farm_id,id,status,expires_at from public.farm_invitations where is_owner_invitation order by farm_id,created_at desc), counts as (select farm_id,count(*) filter(where active) as user_count from public.farm_members group by farm_id)
  select a.farm_id,f.name,a.contact_name,a.contact_email,a.contact_phone,a.account_status,subscription.plan_id,plan.name,subscription.status,onboarding.status,
    (case when onboarding.account_completed_at is not null then 25 else 0 end + case when onboarding.farm_settings_completed_at is not null then 25 else 0 end + case when onboarding.first_flock_completed_at is not null or onboarding.first_flock_skipped_at is not null then 25 else 0 end + case when onboarding.opening_stock_completed_at is not null or onboarding.opening_stock_skipped_at is not null then 25 else 0 end)::integer,
    coalesce(counts.user_count,0),a.created_at,case when invitation.status='pending' and invitation.expires_at is not null and invitation.expires_at<=now() then 'expired' else coalesce(invitation.status,'none') end,invitation.id
  from public.farm_accounts a join public.farms f on f.id=a.farm_id join public.farm_onboarding onboarding on onboarding.farm_id=a.farm_id
  left join current_subscription subscription on subscription.farm_id=a.farm_id left join public.subscription_plans plan on plan.id=subscription.plan_id left join owner_invitation invitation on invitation.farm_id=a.farm_id left join counts on counts.farm_id=a.farm_id
  where public.is_platform_admin() and (target_search is null or f.name ilike '%'||target_search||'%' or a.contact_name ilike '%'||target_search||'%' or a.contact_email ilike '%'||target_search||'%' or coalesce(a.contact_phone,'') ilike '%'||target_search||'%') and (target_account_status is null or a.account_status=target_account_status) and (target_plan_id is null or subscription.plan_id=target_plan_id) and (target_onboarding_status is null or onboarding.status=target_onboarding_status)
  order by a.created_at desc;
$$;

revoke all on function public.mark_platform_onboarding_settings(uuid),public.mark_platform_onboarding_first_flock(uuid),public.skip_platform_onboarding_step(uuid,text),public.complete_platform_onboarding(uuid),public.platform_get_farm_summaries(text,text,uuid,text) from public,anon;
grant execute on function public.mark_platform_onboarding_settings(uuid),public.mark_platform_onboarding_first_flock(uuid),public.skip_platform_onboarding_step(uuid,text),public.complete_platform_onboarding(uuid),public.platform_get_farm_summaries(text,text,uuid,text) to authenticated;
