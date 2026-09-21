-- Correct the email expression introduced with the platform account contract.
-- A literal dot is expressed with a character class to avoid SQL-string escaping ambiguity.

alter table public.farm_accounts drop constraint farm_accounts_contact_email_check;
alter table public.farm_accounts add constraint farm_accounts_contact_email_check
  check (contact_email = lower(trim(contact_email)) and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$');

create or replace function public.platform_create_farm(
  target_farm_name text, target_owner_name text, target_owner_email text,
  target_owner_phone text, target_country text, target_internal_notes text,
  target_plan uuid, target_trial_enabled boolean, target_trial_days integer,
  target_billing_cycle text, target_start_date date
)
returns table(farm_id uuid, invitation_id uuid, subscription_id uuid)
language plpgsql security definer set search_path='' as $$
declare created_farm public.farms; created_invitation public.farm_invitations; created_subscription public.farm_subscriptions;
  plan public.subscription_plans; normalized_email text; trial_days integer; snapshot_price numeric;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  normalized_email:=lower(trim(target_owner_email));
  if char_length(trim(target_farm_name)) not between 2 and 120 or char_length(trim(target_owner_name)) not between 2 and 160 or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Invalid farm or owner details' using errcode='22023'; end if;
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

revoke all on function public.platform_create_farm(text,text,text,text,text,text,uuid,boolean,integer,text,date) from public,anon;
grant execute on function public.platform_create_farm(text,text,text,text,text,text,uuid,boolean,integer,text,date) to authenticated;
