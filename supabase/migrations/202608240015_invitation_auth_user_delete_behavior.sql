alter table public.farm_invitations drop constraint farm_invitations_auth_user_id_fkey;
alter table public.farm_invitations add constraint farm_invitations_auth_user_id_fkey foreign key(auth_user_id) references auth.users(id) on delete set null;
