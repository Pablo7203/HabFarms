create table public.farm_invitations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin','manager','worker')),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  invited_by uuid not null references auth.users(id),
  auth_user_id uuid references auth.users(id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  last_sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint farm_invitations_email_normalized check (email = lower(trim(email)))
);
create unique index farm_invitations_one_pending_idx on public.farm_invitations(farm_id,email) where status='pending';
create index farm_invitations_invitee_idx on public.farm_invitations(email,status,created_at desc);
create index farm_invitations_farm_idx on public.farm_invitations(farm_id,status,created_at desc);
create trigger farm_invitations_updated_at before update on public.farm_invitations for each row execute function public.set_updated_at();
alter table public.farm_invitations enable row level security;

create policy "invitations_admin_read" on public.farm_invitations for select to authenticated
using (public.is_farm_admin(farm_id));
create policy "invitations_invitee_read" on public.farm_invitations for select to authenticated
using (status='pending' and email=lower(coalesce(auth.jwt()->>'email','')));
grant select on public.farm_invitations to authenticated;
grant all on public.farm_invitations to service_role;

create function public.create_farm_invitation(target_email text,target_role text)
returns public.farm_invitations language plpgsql security definer set search_path='' as $$
declare f uuid; normalized text; result public.farm_invitations;
begin
  normalized:=lower(trim(target_email));
  select farm_id into f from public.farm_members where user_id=auth.uid() and active and role='admin' order by created_at limit 1;
  if f is null then raise exception 'Invitation access denied' using errcode='42501'; end if;
  if normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or target_role not in ('admin','manager','worker') then raise exception 'Invalid invitation details' using errcode='22023'; end if;
  if exists(select 1 from public.farm_members fm join public.profiles p on p.id=fm.user_id where fm.farm_id=f and fm.active and lower(p.email)=normalized) then raise exception 'This user is already a member of the farm' using errcode='23505'; end if;
  if exists(select 1 from public.farm_invitations where farm_id=f and email=normalized and status='pending') then raise exception 'An invitation is already pending for this email' using errcode='23505'; end if;
  insert into public.farm_invitations(farm_id,email,role,invited_by) values(f,normalized,target_role,auth.uid()) returning * into result;
  return result;
end;$$;

create function public.mark_farm_invitation_resent(target_invitation uuid)
returns public.farm_invitations language plpgsql security definer set search_path='' as $$
declare result public.farm_invitations;
begin
  select * into result from public.farm_invitations where id=target_invitation for update;
  if result.id is null or result.status<>'pending' or not public.is_farm_admin(result.farm_id) then raise exception 'Invitation resend denied' using errcode='42501'; end if;
  if result.last_sent_at > now()-interval '60 seconds' then raise exception 'Please wait before resending this invitation' using errcode='42900'; end if;
  update public.farm_invitations set last_sent_at=now() where id=result.id returning * into result;
  return result;
end;$$;

create function public.revoke_farm_invitation(target_invitation uuid)
returns void language plpgsql security definer set search_path='' as $$
declare invitation public.farm_invitations;
begin
  select * into invitation from public.farm_invitations where id=target_invitation for update;
  if invitation.id is null or invitation.status<>'pending' or not public.is_farm_admin(invitation.farm_id) then raise exception 'Invitation revoke denied' using errcode='42501'; end if;
  update public.farm_invitations set status='revoked',revoked_at=now(),revoked_by=auth.uid() where id=invitation.id;
end;$$;

create function public.accept_farm_invitation(target_invitation uuid)
returns public.farm_members language plpgsql security definer set search_path='' as $$
declare invitation public.farm_invitations; verified_email text; member public.farm_members;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  verified_email:=lower(coalesce(auth.jwt()->>'email',''));
  select * into invitation from public.farm_invitations where id=target_invitation for update;
  if invitation.id is null or invitation.status<>'pending' or invitation.email<>verified_email then raise exception 'This invitation is no longer valid' using errcode='42501'; end if;
  insert into public.farm_members(farm_id,user_id,role,active) values(invitation.farm_id,auth.uid(),invitation.role,true)
  on conflict(farm_id,user_id) do update set role=excluded.role,active=true,updated_at=now() returning * into member;
  update public.farm_invitations set status='accepted',auth_user_id=auth.uid(),accepted_at=now() where id=invitation.id;
  return member;
end;$$;

create function public.get_pending_farm_invitations()
returns table(id uuid,role text,farm_name text) language sql stable security definer set search_path='' as $$
  select i.id,i.role,f.name from public.farm_invitations i join public.farms f on f.id=i.farm_id
  where i.status='pending' and i.email=lower(coalesce(auth.jwt()->>'email',''));
$$;

create function public.manage_farm_member(target_membership uuid,new_role text default null,new_active boolean default null)
returns public.farm_members language plpgsql security definer set search_path='' as $$
declare member public.farm_members; result public.farm_members; admins integer;
begin
  select * into member from public.farm_members where id=target_membership for update;
  if member.id is null or not public.is_farm_admin(member.farm_id) then raise exception 'Member management denied' using errcode='42501'; end if;
  if new_role is not null and new_role not in ('admin','manager','worker') then raise exception 'Invalid role' using errcode='22023'; end if;
  if member.role='admin' and member.active and (coalesce(new_role,member.role)<>'admin' or coalesce(new_active,member.active)=false) then
    select count(*) into admins from public.farm_members where farm_id=member.farm_id and active and role='admin';
    if admins<=1 then raise exception 'Assign another administrator before changing this user' using errcode='23514'; end if;
  end if;
  update public.farm_members set role=coalesce(new_role,role),active=coalesce(new_active,active) where id=member.id returning * into result;
  return result;
end;$$;

revoke all on function public.create_farm_invitation(text,text),public.mark_farm_invitation_resent(uuid),public.revoke_farm_invitation(uuid),public.accept_farm_invitation(uuid),public.get_pending_farm_invitations(),public.manage_farm_member(uuid,text,boolean) from public,anon;
grant execute on function public.create_farm_invitation(text,text),public.mark_farm_invitation_resent(uuid),public.revoke_farm_invitation(uuid),public.accept_farm_invitation(uuid),public.get_pending_farm_invitations(),public.manage_farm_member(uuid,text,boolean) to authenticated;

create function public.write_invitation_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare event_action text;
begin
  event_action:=case when tg_op='INSERT' then 'farm_invitations.created'
    when new.status='accepted' and old.status='pending' then 'farm_invitations.accepted'
    when new.status='revoked' and old.status='pending' then 'farm_invitations.revoked'
    when new.last_sent_at is distinct from old.last_sent_at then 'farm_invitations.resent'
    else 'farm_invitations.updated' end;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
  values(new.farm_id,auth.uid(),event_action,'farm_invitations',new.id,replace(initcap(replace(event_action,'_',' ')),'.',' '),
    jsonb_strip_nulls(jsonb_build_object('role',new.role,'status',new.status,'previous_status',case when tg_op='UPDATE' then old.status end)));
  return new;
end;$$;
revoke all on function public.write_invitation_audit() from public,anon,authenticated;
create trigger audit_farm_invitations after insert or update on public.farm_invitations for each row execute function public.write_invitation_audit();
