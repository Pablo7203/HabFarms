create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.farms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  currency varchar(3) not null default 'GHS' check (currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'Africa/Accra',
  crate_size integer not null default 30 check (crate_size > 0),
  feed_bag_size_kg numeric not null default 50 check (feed_bag_size_kg > 0),
  opening_cash_balance numeric(14,2) not null default 0 check (opening_cash_balance >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.farm_settings (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null unique references public.farms(id) on delete cascade,
  default_egg_price_per_crate numeric(14,2) not null default 0 check (default_egg_price_per_crate >= 0),
  default_loose_egg_price numeric(14,2) not null default 0 check (default_loose_egg_price >= 0),
  feed_alert_warning_days integer not null default 14 check (feed_alert_warning_days >= 0),
  feed_alert_critical_days integer not null default 7 check (feed_alert_critical_days >= 0),
  reporting_week_start integer not null default 1 check (reporting_week_start between 0 and 6),
  average_feed_days_window integer not null default 7 check (average_feed_days_window > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_feed_alert_order check (feed_alert_critical_days <= feed_alert_warning_days)
);

create table public.farm_members (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin','manager','worker')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, user_id)
);

create index farm_members_user_active_idx on public.farm_members(user_id, active);
create index farm_members_farm_active_idx on public.farm_members(farm_id, active);

create function public.set_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger farms_updated_at before update on public.farms for each row execute function public.set_updated_at();
create trigger farm_settings_updated_at before update on public.farm_settings for each row execute function public.set_updated_at();
create trigger farm_members_updated_at before update on public.farm_members for each row execute function public.set_updated_at();

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin insert into public.profiles(id,email,full_name) values (new.id,new.email, nullif(trim(new.raw_user_meta_data->>'full_name'),'')); return new; end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create function public.sync_user_email() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end; $$;
create trigger on_auth_user_email_updated after update of email on auth.users
for each row when (old.email is distinct from new.email) execute function public.sync_user_email();

create function public.is_farm_member(target_farm_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.farm_members where farm_id=target_farm_id and user_id=auth.uid() and active);
$$;
create function public.is_farm_admin(target_farm_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.farm_members where farm_id=target_farm_id and user_id=auth.uid() and active and role='admin');
$$;

create function public.create_farm_with_admin(farm_name text) returns public.farms language plpgsql security definer set search_path = '' as $$
declare created_farm public.farms;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if char_length(trim(farm_name)) not between 2 and 120 then raise exception 'Invalid farm name' using errcode='22023'; end if;
  insert into public.farms(name) values(trim(farm_name)) returning * into created_farm;
  insert into public.farm_settings(farm_id) values(created_farm.id);
  insert into public.farm_members(farm_id,user_id,role) values(created_farm.id,auth.uid(),'admin');
  return created_farm;
end; $$;

create function public.update_farm_configuration(target_farm_id uuid, farm_name text, farm_currency text, farm_timezone text, farm_crate_size integer, farm_feed_bag_size_kg numeric, farm_opening_cash_balance numeric, egg_price_per_crate numeric, loose_egg_price numeric, warning_days integer, critical_days integer, average_days integer) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_farm_admin(target_farm_id) then raise exception 'Admin access required' using errcode='42501'; end if;
  update public.farms set name=trim(farm_name),currency=upper(farm_currency),timezone=farm_timezone,crate_size=farm_crate_size,feed_bag_size_kg=farm_feed_bag_size_kg,opening_cash_balance=farm_opening_cash_balance where id=target_farm_id;
  update public.farm_settings set default_egg_price_per_crate=egg_price_per_crate,default_loose_egg_price=loose_egg_price,feed_alert_warning_days=warning_days,feed_alert_critical_days=critical_days,average_feed_days_window=average_days where farm_id=target_farm_id;
end; $$;

alter table public.profiles enable row level security;
alter table public.farms enable row level security;
alter table public.farm_settings enable row level security;
alter table public.farm_members enable row level security;

create policy "profiles_read_self_or_farm_member" on public.profiles for select to authenticated using (id=auth.uid() or exists(select 1 from public.farm_members fm_self join public.farm_members fm_other on fm_other.farm_id=fm_self.farm_id and fm_other.user_id=profiles.id and fm_other.active where fm_self.user_id=auth.uid() and fm_self.active));
create policy "profiles_update_self" on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy "farms_read_members" on public.farms for select to authenticated using (public.is_farm_member(id));
create policy "farms_update_admins" on public.farms for update to authenticated using (public.is_farm_admin(id)) with check (public.is_farm_admin(id));
create policy "settings_read_members" on public.farm_settings for select to authenticated using (public.is_farm_member(farm_id));
create policy "settings_update_admins" on public.farm_settings for update to authenticated using (public.is_farm_admin(farm_id)) with check (public.is_farm_admin(farm_id));
create policy "members_read_farm_members" on public.farm_members for select to authenticated using (public.is_farm_member(farm_id));
create policy "members_insert_admins" on public.farm_members for insert to authenticated with check (public.is_farm_admin(farm_id));
create policy "members_update_other_users_by_admin" on public.farm_members for update to authenticated using (public.is_farm_admin(farm_id) and user_id<>auth.uid()) with check (public.is_farm_admin(farm_id) and user_id<>auth.uid());

grant select on public.profiles, public.farms, public.farm_settings, public.farm_members to authenticated;
grant insert on public.farm_members to authenticated;
grant update on public.farms, public.farm_settings, public.farm_members to authenticated;
grant all on public.profiles, public.farms, public.farm_settings, public.farm_members to service_role;

revoke all on function public.create_farm_with_admin(text) from public;
grant execute on function public.create_farm_with_admin(text) to authenticated;
revoke all on function public.update_farm_configuration(uuid,text,text,text,integer,numeric,numeric,numeric,numeric,integer,integer,integer) from public;
grant execute on function public.update_farm_configuration(uuid,text,text,text,integer,numeric,numeric,numeric,numeric,integer,integer,integer) to authenticated;
revoke all on function public.is_farm_member(uuid) from public;
grant execute on function public.is_farm_member(uuid) to authenticated;
revoke all on function public.is_farm_admin(uuid) from public;
grant execute on function public.is_farm_admin(uuid) to authenticated;
revoke all on function public.handle_new_user() from public;
revoke all on function public.sync_user_email() from public;
revoke all on function public.set_updated_at() from public;
revoke update on public.profiles from authenticated;
grant update(full_name,phone) on public.profiles to authenticated;

comment on column public.farm_settings.reporting_week_start is 'ISO-like weekday number: 0=Sunday through 6=Saturday; default 1=Monday.';
comment on column public.profiles.email is 'Auth email snapshot required for the farm member directory; synchronized from auth.users by database triggers.';
