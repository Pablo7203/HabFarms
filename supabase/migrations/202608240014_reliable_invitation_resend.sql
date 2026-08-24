create function public.link_farm_invitation_auth_user(target_invitation uuid,target_auth_user uuid)
returns void language plpgsql security definer set search_path='' as $$
declare invitation public.farm_invitations;
begin
  select * into invitation from public.farm_invitations where id=target_invitation for update;
  if invitation.id is null or invitation.status<>'pending' or not public.is_farm_admin(invitation.farm_id) then raise exception 'Invitation link denied' using errcode='42501'; end if;
  update public.farm_invitations set auth_user_id=target_auth_user where id=invitation.id;
end;$$;
revoke all on function public.link_farm_invitation_auth_user(uuid,uuid) from public,anon;
grant execute on function public.link_farm_invitation_auth_user(uuid,uuid) to authenticated;
