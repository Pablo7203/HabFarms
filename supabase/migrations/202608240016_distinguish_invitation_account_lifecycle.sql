drop function public.get_pending_farm_invitations();

create function public.get_pending_farm_invitations()
returns table(
  id uuid,
  role text,
  farm_name text,
  requires_password_setup boolean
)
language sql
stable
security definer
set search_path=''
as $$
  select
    invitation.id,
    invitation.role,
    farm.name,
    coalesce(invitation.auth_user_id = auth.uid(), false)
  from public.farm_invitations invitation
  join public.farms farm on farm.id = invitation.farm_id
  where invitation.status = 'pending'
    and invitation.email = lower(coalesce(auth.jwt()->>'email', ''));
$$;

revoke all on function public.get_pending_farm_invitations() from public, anon;
grant execute on function public.get_pending_farm_invitations() to authenticated;
