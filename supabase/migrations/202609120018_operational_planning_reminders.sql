-- Effective-dated feed planning, operational reminders, and supplier payment due dates.

create table public.flock_feeding_plans(
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  flock_id uuid not null references public.flocks(id) on delete restrict,
  feed_type_id uuid not null references public.feed_types(id) on delete restrict,
  grams_per_bird_per_day numeric(10,3) not null check(grams_per_bird_per_day>0 and grams_per_bird_per_day<=1000),
  effective_from date not null, effective_to date,
  notes text, created_at timestamptz not null default now(), created_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id),
  check(effective_to is null or effective_to>=effective_from), unique(flock_id,effective_from)
);
create index flock_feeding_plans_lookup_idx on public.flock_feeding_plans(farm_id,flock_id,effective_from desc);

create table public.health_reminders(
  id uuid primary key default gen_random_uuid(), farm_id uuid not null references public.farms(id) on delete cascade,
  flock_id uuid not null references public.flocks(id) on delete restrict,
  activity_type text not null check(activity_type in('vaccination','treatment_follow_up','medication','inspection','other')),
  title text not null check(char_length(trim(title)) between 2 and 160), due_date date not null,
  notes text, status text not null default 'active' check(status in('active','completed','cancelled')),
  completed_health_record_id uuid references public.health_records(id) on delete set null, completed_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id)
);
create index health_reminders_due_idx on public.health_reminders(farm_id,due_date) where status='active';

alter table public.suppliers add column default_payment_days integer;
alter table public.suppliers add constraint suppliers_default_payment_days_check check(default_payment_days is null or default_payment_days between 1 and 365);
alter table public.feed_purchases add column payment_terms_days integer;
alter table public.feed_purchases add column payment_due_date date;
alter table public.feed_purchases add constraint feed_purchases_payment_terms_days_check check(payment_terms_days is null or payment_terms_days between 1 and 365);
alter table public.feed_purchases add constraint feed_purchases_payment_due_date_check check(payment_due_date is null or payment_due_date>=purchase_date);
create index feed_purchases_payment_due_idx on public.feed_purchases(farm_id,payment_due_date) where status='completed';

create or replace function public.assert_flock_plan_scope(target_flock uuid,target_feed_type uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare f uuid; begin select farm_id into f from public.farm_members where user_id=auth.uid() and active order by created_at limit 1;
if f is null or not public.has_farm_role(f,array['admin','manager']) or not exists(select 1 from public.flocks where id=target_flock and farm_id=f) or not exists(select 1 from public.feed_types where id=target_feed_type and farm_id=f and active) then raise exception 'Feed plan access denied' using errcode='42501'; end if; return f; end; $$;

create or replace function public.save_flock_feeding_plan(target_flock uuid,target_feed_type uuid,target_grams numeric,target_effective_from date,target_notes text default null) returns public.flock_feeding_plans language plpgsql security definer set search_path='' as $$
declare f uuid; result public.flock_feeding_plans; begin f:=public.assert_flock_plan_scope(target_flock,target_feed_type);
update public.flock_feeding_plans set effective_to=target_effective_from-1,updated_at=now(),updated_by=auth.uid() where flock_id=target_flock and effective_to is null and effective_from<target_effective_from;
insert into public.flock_feeding_plans(farm_id,flock_id,feed_type_id,grams_per_bird_per_day,effective_from,notes,created_by) values(f,target_flock,target_feed_type,target_grams,target_effective_from,nullif(trim(target_notes),''),auth.uid()) on conflict(flock_id,effective_from) do update set feed_type_id=excluded.feed_type_id,grams_per_bird_per_day=excluded.grams_per_bird_per_day,notes=excluded.notes,updated_at=now(),updated_by=auth.uid() returning * into result; return result; end; $$;

create or replace view public.v_flock_feed_plan_daily with(security_invoker=true) as
select p.farm_id,p.flock_id,p.feed_type_id,p.effective_from,p.effective_to,p.grams_per_bird_per_day,
  (fl.initial_birds+coalesce((select sum(case when bm.direction='IN' then bm.quantity else -bm.quantity end) from public.bird_movements bm where bm.flock_id=fl.id and bm.movement_date<=greatest(p.effective_from,fl.start_date)),0))::integer live_birds_at_effective_from,
  round((fl.initial_birds+coalesce((select sum(case when bm.direction='IN' then bm.quantity else -bm.quantity end) from public.bird_movements bm where bm.flock_id=fl.id and bm.movement_date<=greatest(p.effective_from,fl.start_date)),0))*p.grams_per_bird_per_day/1000,3) target_kg_per_day
from public.flock_feeding_plans p join public.flocks fl on fl.id=p.flock_id;

create or replace view public.v_health_reminder_status with(security_invoker=true) as
select h.*,f.flock_name,case when h.status='completed' then 'completed' when h.status='cancelled' then 'cancelled' when h.due_date<(now() at time zone fa.timezone)::date then 'overdue' when h.due_date=(now() at time zone fa.timezone)::date then 'due_today' else 'upcoming' end reminder_status
from public.health_reminders h join public.flocks f on f.id=h.flock_id join public.farms fa on fa.id=h.farm_id;

create or replace view public.v_supplier_payables with(security_invoker=true) as
select r.*,p.payment_terms_days,p.payment_due_date,s.name supplier_name,case when r.outstanding_balance<=0 then 'paid' when p.payment_due_date is null then 'unscheduled' when p.payment_due_date<(now() at time zone fa.timezone)::date then 'overdue' when p.payment_due_date=(now() at time zone fa.timezone)::date then 'due_today' else 'upcoming' end supplier_due_status,
case when p.payment_due_date<(now() at time zone fa.timezone)::date then (now() at time zone fa.timezone)::date-p.payment_due_date else 0 end days_overdue
from public.v_feed_purchase_receivables r join public.feed_purchases p on p.id=r.id left join public.suppliers s on s.id=r.supplier_id join public.farms fa on fa.id=r.farm_id;

alter table public.flock_feeding_plans enable row level security; alter table public.health_reminders enable row level security;
create policy flock_feeding_plans_read on public.flock_feeding_plans for select to authenticated using(public.is_farm_member(farm_id));
create policy health_reminders_read on public.health_reminders for select to authenticated using(public.is_farm_member(farm_id));
grant select on public.flock_feeding_plans,public.health_reminders,public.v_flock_feed_plan_daily,public.v_health_reminder_status,public.v_supplier_payables to authenticated,service_role;
revoke all on function public.assert_flock_plan_scope(uuid,uuid),public.save_flock_feeding_plan(uuid,uuid,numeric,date,text) from public,anon;
grant execute on function public.save_flock_feeding_plan(uuid,uuid,numeric,date,text) to authenticated;

create or replace function public.set_feed_purchase_due_defaults() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.supplier_id is not null and new.payment_terms_days is null then select default_payment_days into new.payment_terms_days from public.suppliers where id=new.supplier_id; end if;
  if new.payment_terms_days is not null and new.payment_due_date is null then new.payment_due_date:=new.purchase_date+new.payment_terms_days; end if;
  return new;
end; $$;
create trigger feed_purchase_due_defaults before insert on public.feed_purchases for each row execute function public.set_feed_purchase_due_defaults();

create or replace function public.create_health_reminder(target_flock uuid,target_activity_type text,target_title text,target_due_date date,target_notes text default null) returns public.health_reminders language plpgsql security definer set search_path='' as $$
declare f uuid; result public.health_reminders; begin select farm_id into f from public.farm_members where user_id=auth.uid() and active order by created_at limit 1;
if f is null or not public.has_farm_role(f,array['admin','manager']) or not exists(select 1 from public.flocks where id=target_flock and farm_id=f) then raise exception 'Health reminder access denied' using errcode='42501'; end if;
insert into public.health_reminders(farm_id,flock_id,activity_type,title,due_date,notes,created_by) values(f,target_flock,target_activity_type,trim(target_title),target_due_date,nullif(trim(target_notes),''),auth.uid()) returning * into result; return result; end; $$;
create or replace function public.complete_health_reminder(target_reminder uuid,target_health_record uuid default null) returns public.health_reminders language plpgsql security definer set search_path='' as $$
declare result public.health_reminders; begin update public.health_reminders set status='completed',completed_at=now(),completed_health_record_id=target_health_record,updated_at=now(),updated_by=auth.uid() where id=target_reminder and status='active' and public.has_farm_role(farm_id,array['admin','manager']) and (target_health_record is null or exists(select 1 from public.health_records where id=target_health_record and farm_id=health_reminders.farm_id)) returning * into result; if result.id is null then raise exception 'Health reminder completion denied' using errcode='42501'; end if; return result; end; $$;
revoke all on function public.set_feed_purchase_due_defaults(),public.create_health_reminder(uuid,text,text,date,text),public.complete_health_reminder(uuid,uuid) from public,anon;
grant execute on function public.create_health_reminder(uuid,text,text,date,text),public.complete_health_reminder(uuid,uuid) to authenticated;
