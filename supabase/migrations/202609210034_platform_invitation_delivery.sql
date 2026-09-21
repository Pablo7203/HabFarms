create function public.platform_get_owner_invitation(target_invitation uuid)
returns table(id uuid,email text,auth_user_id uuid,farm_id uuid,contact_name text,status text)
language sql stable security definer set search_path='' as $$
  select i.id,i.email,i.auth_user_id,i.farm_id,a.contact_name,i.status
  from public.farm_invitations i join public.farm_accounts a on a.farm_id=i.farm_id
  where i.id=target_invitation and i.is_owner_invitation and public.is_platform_admin();
$$;
revoke all on function public.platform_get_owner_invitation(uuid) from public,anon;
grant execute on function public.platform_get_owner_invitation(uuid) to authenticated;
