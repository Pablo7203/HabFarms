-- HabFarms Platform Phase 4: control-plane operations and launch hardening.
-- These tables deliberately contain Platform metadata only; tenant operational records are excluded.

create table public.platform_settings (
  singleton boolean primary key default true check (singleton),
  company_name text not null default 'HabFarms' check (char_length(trim(company_name)) between 2 and 120),
  support_name text,
  support_email text check (support_email is null or (support_email=lower(trim(support_email)) and support_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  support_phone text,
  billing_contact_email text check (billing_contact_email is null or (billing_contact_email=lower(trim(billing_contact_email)) and billing_contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  default_currency varchar(3) not null default 'GHS' check (default_currency ~ '^[A-Z]{3}$'),
  default_trial_days integer not null default 14 check (default_trial_days between 0 and 365),
  default_grace_days integer not null default 0 check (default_grace_days between 0 and 365),
  trial_expiry_reminder_days integer not null default 3 check (trial_expiry_reminder_days between 0 and 90),
  subscription_due_reminder_days integer not null default 3 check (subscription_due_reminder_days between 0 and 90),
  grace_ending_reminder_days integer not null default 1 check (grace_ending_reminder_days between 0 and 90),
  platform_timezone text not null default 'Africa/Accra' check (char_length(trim(platform_timezone)) between 1 and 80),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.platform_settings(singleton) values(true);

create table public.platform_account_notes (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  note text not null check (char_length(trim(note)) between 1 and 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index platform_account_notes_farm_created_idx on public.platform_account_notes(farm_id,created_at desc);

create table public.platform_communications (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  subscription_id uuid references public.farm_subscriptions(id) on delete restrict,
  message_type text not null check (message_type in ('owner_invitation','trial_expiring','trial_expired','subscription_due','past_due','grace_ending','suspension','reactivation','payment_recorded')),
  recipient_email text not null check (recipient_email=lower(trim(recipient_email)) and recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  dedupe_key text not null unique check (char_length(dedupe_key) between 10 and 240),
  attempted_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  last_error_category text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index platform_communications_status_created_idx on public.platform_communications(status,created_at desc);
create index platform_communications_farm_created_idx on public.platform_communications(farm_id,created_at desc);

create table public.platform_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('subscription_lifecycle','communication_delivery')),
  status text not null check (status in ('running','success','failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  records_examined integer not null default 0 check (records_examined >= 0),
  records_changed integer not null default 0 check (records_changed >= 0),
  error_summary text check (error_summary is null or char_length(error_summary) <= 500),
  created_at timestamptz not null default now(),
  constraint platform_job_runs_completion check ((status='running' and completed_at is null) or (status in ('success','failed') and completed_at is not null))
);
create index platform_job_runs_type_started_idx on public.platform_job_runs(job_type,started_at desc);

create trigger platform_settings_updated_at before update on public.platform_settings for each row execute function public.set_updated_at();
create trigger platform_communications_updated_at before update on public.platform_communications for each row execute function public.set_updated_at();

alter table public.platform_settings enable row level security;
alter table public.platform_account_notes enable row level security;
alter table public.platform_communications enable row level security;
alter table public.platform_job_runs enable row level security;
create policy platform_settings_platform_read on public.platform_settings for select to authenticated using(public.is_platform_admin());
create policy platform_account_notes_platform_read on public.platform_account_notes for select to authenticated using(public.is_platform_admin());
create policy platform_communications_platform_read on public.platform_communications for select to authenticated using(public.is_platform_admin());
create policy platform_job_runs_platform_read on public.platform_job_runs for select to authenticated using(public.is_platform_admin());
revoke all on public.platform_settings,public.platform_account_notes,public.platform_communications,public.platform_job_runs from public,anon,authenticated;
grant select on public.platform_settings,public.platform_account_notes,public.platform_communications,public.platform_job_runs to authenticated;
grant all on public.platform_settings,public.platform_account_notes,public.platform_communications,public.platform_job_runs to service_role;

create function public.platform_get_settings()
returns public.platform_settings language sql stable security definer set search_path='' as $$
  select settings from public.platform_settings settings where settings.singleton and public.is_platform_admin();
$$;

create function public.platform_update_settings(target_company_name text,target_support_name text,target_support_email text,target_support_phone text,target_billing_contact_email text,target_default_currency varchar,target_default_trial_days integer,target_default_grace_days integer,target_trial_reminder_days integer,target_due_reminder_days integer,target_grace_reminder_days integer,target_timezone text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  update public.platform_settings set company_name=trim(target_company_name),support_name=nullif(trim(target_support_name),''),support_email=nullif(lower(trim(target_support_email)),''),support_phone=nullif(trim(target_support_phone),''),billing_contact_email=nullif(lower(trim(target_billing_contact_email)),''),default_currency=upper(trim(target_default_currency)),default_trial_days=target_default_trial_days,default_grace_days=target_default_grace_days,trial_expiry_reminder_days=target_trial_reminder_days,subscription_due_reminder_days=target_due_reminder_days,grace_ending_reminder_days=target_grace_reminder_days,platform_timezone=trim(target_timezone),updated_by=auth.uid() where singleton;
  perform public.platform_write_audit('platform.settings_updated',null,'platform_settings',null,jsonb_build_object('default_currency',upper(trim(target_default_currency)),'default_trial_days',target_default_trial_days,'default_grace_days',target_default_grace_days));
end;
$$;

create function public.platform_create_account_note(target_farm uuid,target_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare note_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  insert into public.platform_account_notes(farm_id,note,created_by) values(target_farm,trim(target_note),auth.uid()) returning id into note_id;
  perform public.platform_write_audit('platform.account_note_created',target_farm,'platform_account_notes',note_id,'{}'::jsonb);
  return note_id;
end;
$$;

create function public.platform_get_account_notes(target_farm uuid)
returns table(id uuid,note text,created_at timestamptz,created_by uuid) language sql stable security definer set search_path='' as $$
  select n.id,n.note,n.created_at,n.created_by from public.platform_account_notes n where n.farm_id=target_farm and public.is_platform_admin() order by n.created_at desc;
$$;

create function public.platform_get_operations_health()
returns jsonb language sql stable security definer set search_path='' as $$
  with lifecycle as (select * from public.platform_job_runs where job_type='subscription_lifecycle' order by started_at desc limit 1), delivery as (select count(*) filter(where status='failed') failed,count(*) filter(where status='pending') pending from public.platform_communications)
  select case when not public.is_platform_admin() then null else jsonb_build_object('last_lifecycle_run',(select jsonb_build_object('status',status,'started_at',started_at,'completed_at',completed_at,'records_changed',records_changed,'error_summary',error_summary) from lifecycle),'communications',(select jsonb_build_object('failed',failed,'pending',pending) from delivery)) end;
$$;

create function public.platform_enqueue_lifecycle_communications(target_as_of date default current_date)
returns integer language plpgsql security definer set search_path='' as $$
declare created_count integer := 0; inserted_count integer := 0; settings public.platform_settings; item record;
begin
  select * into settings from public.platform_settings where singleton;
  for item in
    select s.id subscription_id,s.farm_id,a.contact_email,s.status,s.trial_ends_at,s.grace_ends_at,s.past_due_at,s.suspended_at
    from public.farm_subscriptions s join public.farm_accounts a on a.farm_id=s.farm_id
    where s.ended_at is null
  loop
    if item.status='trialing' and item.trial_ends_at=target_as_of+settings.trial_expiry_reminder_days then
      insert into public.platform_communications(farm_id,subscription_id,message_type,recipient_email,dedupe_key) values(item.farm_id,item.subscription_id,'trial_expiring',item.contact_email,'trial-expiring:'||item.subscription_id||':'||item.trial_ends_at) on conflict(dedupe_key) do nothing;
      get diagnostics inserted_count = row_count; created_count := created_count + inserted_count;
    end if;
    if item.status='past_due' and item.past_due_at::date=target_as_of then
      insert into public.platform_communications(farm_id,subscription_id,message_type,recipient_email,dedupe_key) values(item.farm_id,item.subscription_id,'past_due',item.contact_email,'past-due:'||item.subscription_id||':'||target_as_of) on conflict(dedupe_key) do nothing;
      get diagnostics inserted_count = row_count; created_count := created_count + inserted_count;
    end if;
    if item.status='grace_period' and item.grace_ends_at=target_as_of+settings.grace_ending_reminder_days then
      insert into public.platform_communications(farm_id,subscription_id,message_type,recipient_email,dedupe_key) values(item.farm_id,item.subscription_id,'grace_ending',item.contact_email,'grace-ending:'||item.subscription_id||':'||item.grace_ends_at) on conflict(dedupe_key) do nothing;
      get diagnostics inserted_count = row_count; created_count := created_count + inserted_count;
    end if;
    if item.status='suspended' and item.suspended_at::date=target_as_of then
      insert into public.platform_communications(farm_id,subscription_id,message_type,recipient_email,dedupe_key) values(item.farm_id,item.subscription_id,'suspension',item.contact_email,'suspension:'||item.subscription_id||':'||target_as_of) on conflict(dedupe_key) do nothing;
      get diagnostics inserted_count = row_count; created_count := created_count + inserted_count;
    end if;
  end loop;
  return created_count;
end;
$$;

revoke all on function public.platform_get_settings(),public.platform_update_settings(text,text,text,text,text,varchar,integer,integer,integer,integer,integer,text),public.platform_create_account_note(uuid,text),public.platform_get_account_notes(uuid),public.platform_get_operations_health(),public.platform_enqueue_lifecycle_communications(date) from public,anon;
grant execute on function public.platform_get_settings(),public.platform_update_settings(text,text,text,text,text,varchar,integer,integer,integer,integer,integer,text),public.platform_create_account_note(uuid,text),public.platform_get_account_notes(uuid),public.platform_get_operations_health() to authenticated;
grant execute on function public.platform_enqueue_lifecycle_communications(date) to service_role;
