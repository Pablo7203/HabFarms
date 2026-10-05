-- Owners need their setup milestones before their account has full farm access.
-- Keep direct table access restricted; expose only the milestones used by setup.
create function public.get_my_onboarding_progress(target_farm uuid)
returns table (
  farm_settings_completed_at timestamptz,
  first_flock_completed_at timestamptz,
  first_flock_skipped_at timestamptz,
  opening_stock_completed_at timestamptz,
  opening_stock_skipped_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.farm_accounts a
    join public.farm_members m on m.farm_id = a.farm_id
    where a.farm_id = target_farm
      and a.primary_owner_user_id = auth.uid()
      and a.account_status = 'onboarding'
      and m.user_id = auth.uid() and m.active and m.role = 'admin'
  ) then
    raise exception 'Onboarding access denied' using errcode = '42501';
  end if;

  return query
    select o.farm_settings_completed_at, o.first_flock_completed_at,
      o.first_flock_skipped_at, o.opening_stock_completed_at,
      o.opening_stock_skipped_at
    from public.farm_onboarding o where o.farm_id = target_farm;
end;
$$;

revoke all on function public.get_my_onboarding_progress(uuid) from public, anon;
grant execute on function public.get_my_onboarding_progress(uuid) to authenticated;
