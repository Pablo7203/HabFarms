-- P1 commercial readiness: effective-dated Hen-Day targets and financially complete raw-material purchases.

create extension if not exists btree_gist with schema extensions;

create table public.flock_hen_day_targets(
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  flock_id uuid not null references public.flocks(id) on delete restrict,
  target_percentage numeric(5,2) not null check(target_percentage > 0 and target_percentage <= 100),
  effective_from date not null,
  effective_to date,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  check(effective_to is null or effective_to >= effective_from),
  exclude using gist (flock_id with =, daterange(effective_from, coalesce(effective_to + 1, 'infinity'::date), '[)') with &&)
);
create index flock_hen_day_targets_farm_flock_idx on public.flock_hen_day_targets(farm_id,flock_id,effective_from desc);
alter table public.flock_hen_day_targets enable row level security;
create policy flock_hen_day_targets_read on public.flock_hen_day_targets for select to authenticated using(public.is_farm_member(farm_id));

create function public.save_flock_hen_day_target(target_flock uuid,target_percentage numeric,target_effective_from date,target_notes text default null)
returns public.flock_hen_day_targets language plpgsql security definer set search_path='' as $$
declare f uuid; previous public.flock_hen_day_targets; result public.flock_hen_day_targets;
begin
  f:=public.feed_access_farm(array['admin','manager']);
  if target_percentage<=0 or target_percentage>100 or target_effective_from is null then raise exception 'Hen-Day target must be greater than 0 and no more than 100' using errcode='23514'; end if;
  if not exists(select 1 from public.flocks where id=target_flock and farm_id=f) then raise exception 'Flock is not available' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(f::text||target_flock::text,0));
  select * into previous from public.flock_hen_day_targets where farm_id=f and flock_id=target_flock and effective_to is null order by effective_from desc limit 1 for update;
  if previous.id is not null then
    if target_effective_from<=previous.effective_from then raise exception 'The new target effective date must be after the current target start date' using errcode='23514'; end if;
    update public.flock_hen_day_targets set effective_to=target_effective_from-1,updated_at=now(),updated_by=auth.uid() where id=previous.id;
  elsif exists(select 1 from public.flock_hen_day_targets where flock_id=target_flock and effective_from>=target_effective_from) then
    raise exception 'Target periods cannot overlap' using errcode='23P01';
  end if;
  insert into public.flock_hen_day_targets(farm_id,flock_id,target_percentage,effective_from,notes,created_by,updated_by)
  values(f,target_flock,round(target_percentage,2),target_effective_from,nullif(trim(target_notes),''),auth.uid(),auth.uid()) returning * into result;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
  values(f,auth.uid(),case when previous.id is null then 'hen_day_target.created' else 'hen_day_target.changed' end,'flock_hen_day_targets',result.id,'Hen-Day target saved',jsonb_build_object('flock_id',target_flock,'old_target',previous.target_percentage,'new_target',result.target_percentage,'effective_from',target_effective_from));
  return result;
end;$$;

create function public.get_hen_day_target_summary(start_date date,end_date date,target_flock uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f uuid; member_role text; actual_eggs numeric; all_bird_days numeric; covered_bird_days numeric; expected_eggs numeric;
begin
  select farm_id,role into f,member_role from public.farm_members where user_id=auth.uid() and active order by created_at limit 1;
  if f is null or start_date is null or end_date is null or start_date>end_date or (target_flock is not null and not exists(select 1 from public.flocks where id=target_flock and farm_id=f)) then raise exception 'Hen-Day target access denied' using errcode='42501'; end if;
  with rows as (
    select p.id,p.flock_id,p.production_date,p.eggs_collected,m.live_birds,t.target_percentage
    from public.daily_production_records p join public.v_daily_production_metrics m on m.production_id=p.id
    left join lateral(select target_percentage from public.flock_hen_day_targets t where t.farm_id=f and t.flock_id=p.flock_id and p.production_date between t.effective_from and coalesce(t.effective_to,'infinity'::date) order by t.effective_from desc limit 1)t on true
    where p.farm_id=f and p.production_date between start_date and end_date and (target_flock is null or p.flock_id=target_flock)
  ) select coalesce(sum(eggs_collected),0),coalesce(sum(live_birds),0),coalesce(sum(live_birds) filter(where target_percentage is not null),0),coalesce(sum(live_birds*target_percentage/100) filter(where target_percentage is not null),0)
    into actual_eggs,all_bird_days,covered_bird_days,expected_eggs from rows;
  return jsonb_build_object('actual_hen_day_percentage',case when all_bird_days=0 then null else round(actual_eggs/all_bird_days*100,2) end,'target_hen_day_percentage',case when covered_bird_days=0 then null else round(expected_eggs/covered_bird_days*100,2) end,'variance_points',case when covered_bird_days=0 or all_bird_days=0 then null else round(actual_eggs/all_bird_days*100-expected_eggs/covered_bird_days*100,2) end,'target_coverage_percentage',case when all_bird_days=0 then 0 else round(covered_bird_days/all_bird_days*100,2) end,'covered_bird_days',covered_bird_days,'eligible_bird_days',all_bird_days,'status',case when covered_bird_days=0 then 'not_configured' when actual_eggs/all_bird_days*100>=expected_eggs/covered_bird_days*100 then 'at_or_above_target' else 'below_target' end);
end;$$;

create table public.raw_material_purchase_payments(
  id uuid primary key default gen_random_uuid(), farm_id uuid not null references public.farms(id) on delete cascade,
  purchase_batch_id uuid not null references public.raw_material_purchase_batches(id) on delete restrict,
  payment_date date not null, amount numeric(14,2) not null check(amount>0), payment_method text not null check(payment_method in('cash','momo','bank_transfer','other')),
  reference text,notes text,voided_at timestamptz,voided_by uuid references public.profiles(id),void_reason text,created_at timestamptz not null default now(),created_by uuid not null references public.profiles(id)
);
create index raw_material_purchase_payments_batch_idx on public.raw_material_purchase_payments(purchase_batch_id);
alter table public.raw_material_purchase_payments enable row level security;
create policy raw_material_purchase_payments_read on public.raw_material_purchase_payments for select to authenticated using(public.has_farm_role(farm_id,array['admin','manager']));

create or replace view public.v_raw_material_purchase_receivables with(security_invoker=true) as
select b.*,coalesce(sum(p.amount) filter(where p.voided_at is null),0)::numeric(14,2) total_paid,(b.total_cost-coalesce(sum(p.amount) filter(where p.voided_at is null),0))::numeric(14,2) outstanding_balance,
case when coalesce(sum(p.amount) filter(where p.voided_at is null),0)=0 then 'unpaid' when coalesce(sum(p.amount) filter(where p.voided_at is null),0)<b.total_cost then 'partial' else 'paid' end payment_status
from public.raw_material_purchase_batches b left join public.raw_material_purchase_payments p on p.purchase_batch_id=b.id group by b.id;

drop view public.v_supplier_payables;
create view public.v_supplier_payables with(security_invoker=true) as
select r.id,r.farm_id,r.supplier_id,r.purchase_number,r.purchase_date,r.total_cost,r.total_paid,r.outstanding_balance,r.payment_status,p.payment_terms_days,p.payment_due_date,s.name supplier_name,'finished_feed'::text source_type,
case when r.outstanding_balance<=0 then 'paid' when p.payment_due_date is null then 'unscheduled' when p.payment_due_date<(now() at time zone fa.timezone)::date then 'overdue' when p.payment_due_date=(now() at time zone fa.timezone)::date then 'due_today' else 'upcoming' end supplier_due_status,
case when p.payment_due_date<(now() at time zone fa.timezone)::date then (now() at time zone fa.timezone)::date-p.payment_due_date else 0 end days_overdue
from public.v_feed_purchase_receivables r join public.feed_purchases p on p.id=r.id left join public.suppliers s on s.id=r.supplier_id join public.farms fa on fa.id=r.farm_id
union all
select r.id,r.farm_id,r.supplier_id,r.purchase_number,r.purchase_date,r.total_cost,r.total_paid,r.outstanding_balance,r.payment_status,r.payment_terms_days,r.payment_due_date,s.name,'raw_material'::text,
case when r.outstanding_balance<=0 then 'paid' when r.payment_due_date is null then 'unscheduled' when r.payment_due_date<(now() at time zone fa.timezone)::date then 'overdue' when r.payment_due_date=(now() at time zone fa.timezone)::date then 'due_today' else 'upcoming' end,
case when r.payment_due_date<(now() at time zone fa.timezone)::date then (now() at time zone fa.timezone)::date-r.payment_due_date else 0 end
from public.v_raw_material_purchase_receivables r left join public.suppliers s on s.id=r.supplier_id join public.farms fa on fa.id=r.farm_id where r.status='completed';

create or replace function public.record_raw_material_purchase_payment(target_purchase uuid,target_payment_date date,target_amount numeric,target_payment_method text,target_reference text default null,target_notes text default null)
returns public.raw_material_purchase_payments language plpgsql security definer set search_path='' as $$
declare b public.raw_material_purchase_batches; paid numeric; result public.raw_material_purchase_payments;
begin
 select * into b from public.raw_material_purchase_batches where id=target_purchase for update;
 if b.id is null or b.status<>'completed' or not public.has_farm_role(b.farm_id,array['admin','manager']) then raise exception 'Material payment access denied' using errcode='42501'; end if;
 if target_amount<=0 or target_payment_method not in('cash','momo','bank_transfer','other') then raise exception 'Invalid material payment' using errcode='23514'; end if;
 select coalesce(sum(amount),0) into paid from public.raw_material_purchase_payments where purchase_batch_id=b.id and voided_at is null;
 if paid+target_amount>b.total_cost then raise exception 'Payment exceeds remaining balance' using errcode='23514'; end if;
 insert into public.raw_material_purchase_payments(farm_id,purchase_batch_id,payment_date,amount,payment_method,reference,notes,created_by) values(b.farm_id,b.id,target_payment_date,target_amount,target_payment_method,nullif(trim(target_reference),''),nullif(trim(target_notes),''),auth.uid()) returning * into result;
 return result;
end;$$;

create or replace function public.void_raw_material_purchase_payment(target_payment uuid,reason text) returns void language plpgsql security definer set search_path='' as $$
declare p public.raw_material_purchase_payments;
begin select * into p from public.raw_material_purchase_payments where id=target_payment for update;
 if p.id is null or p.voided_at is not null or not public.has_farm_role(p.farm_id,array['admin']) or char_length(trim(reason))<3 then raise exception 'Material payment void denied' using errcode='42501'; end if;
 update public.raw_material_purchase_payments set voided_at=now(),voided_by=auth.uid(),void_reason=trim(reason) where id=p.id;
end;$$;

create or replace function public.post_raw_material_purchase_batch(target_supplier uuid,target_purchase_date date,target_amount_paid numeric,target_notes text,purchase_items jsonb)
returns public.raw_material_purchase_batches language plpgsql security definer set search_path='' as $$
declare f uuid; b public.raw_material_purchase_batches; i record; total numeric:=0; line_total numeric; terms integer; due date; number text; line_number integer:=0;
begin
 f:=public.feed_access_farm(array['admin','manager']);
 if jsonb_typeof(purchase_items)<>'array' or jsonb_array_length(purchase_items)=0 or target_amount_paid<0 then raise exception 'At least one valid purchase item is required' using errcode='23514'; end if;
 if target_supplier is not null and not exists(select 1 from public.suppliers where id=target_supplier and farm_id=f and active) then raise exception 'Invalid supplier' using errcode='42501'; end if;
 if exists(select 1 from jsonb_array_elements(purchase_items) x where coalesce((x->>'quantity_kg')::numeric,0)<=0 or coalesce((x->>'unit_cost')::numeric,-1)<0 or not exists(select 1 from public.raw_materials m where m.id=(x->>'material_id')::uuid and m.farm_id=f and m.is_active)) then raise exception 'Every purchase line needs an active material, quantity, and unit cost' using errcode='23514'; end if;
 if (select count(*) from jsonb_array_elements(purchase_items))<>(select count(distinct (x->>'material_id')) from jsonb_array_elements(purchase_items)x) then raise exception 'A material can appear only once on a purchase' using errcode='23514'; end if;
 select coalesce(sum(round((x->>'quantity_kg')::numeric*(x->>'unit_cost')::numeric,2)),0) into total from jsonb_array_elements(purchase_items)x;
 if target_amount_paid>total then raise exception 'Payment exceeds purchase total' using errcode='23514'; end if;
 select default_payment_days into terms from public.suppliers where id=target_supplier; due:=case when target_amount_paid<total and terms is not null then target_purchase_date+terms else null end;
 number:='MAT-'||to_char(target_purchase_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
 insert into public.raw_material_purchase_batches(farm_id,supplier_id,purchase_number,purchase_date,total_cost,amount_paid,payment_terms_days,payment_due_date,notes,created_by) values(f,target_supplier,number,target_purchase_date,total,0,terms,due,nullif(trim(target_notes),''),auth.uid()) returning * into b;
 for i in select (x->>'material_id')::uuid material_id,(x->>'quantity_kg')::numeric quantity_kg,(x->>'unit_cost')::numeric unit_cost,nullif(x->>'package_count','')::numeric package_count,nullif(x->>'package_weight_kg','')::numeric package_weight_kg from jsonb_array_elements(purchase_items)x loop
  line_number:=line_number+1; line_total:=round(i.quantity_kg*i.unit_cost,2);
  insert into public.raw_material_purchases(farm_id,supplier_id,material_id,purchase_batch_id,purchase_number,purchase_date,quantity_kg,unit_cost,total_cost,payment_terms_days,payment_due_date,package_count,package_weight_kg_snapshot,notes,created_by) values(f,target_supplier,i.material_id,b.id,number||'-'||line_number,target_purchase_date,i.quantity_kg,i.unit_cost,line_total,terms,due,i.package_count,i.package_weight_kg,nullif(trim(target_notes),''),auth.uid());
  insert into public.raw_material_inventory_movements(farm_id,material_id,movement_date,movement_type,direction,quantity_kg,unit_cost_snapshot,total_cost_snapshot,source_type,source_id,created_by) values(f,i.material_id,target_purchase_date,'purchase','IN',i.quantity_kg,i.unit_cost,line_total,'raw_material_purchase_batch',b.id,auth.uid()); perform public.recalculate_raw_material_ledger(f,i.material_id);
 end loop;
 if target_amount_paid>0 then perform public.record_raw_material_purchase_payment(b.id,target_purchase_date,target_amount_paid,'cash',null,null); end if;
 return b;
end;$$;

create or replace view public.v_cash_ledger with(security_invoker=true) as
select p.farm_id,p.id transaction_id,p.payment_date transaction_date,'customer_payment'::text source_type,p.sale_id source_id,'IN'::text direction,p.amount,p.payment_method,coalesce(s.sale_number,'Customer payment')description,p.reference,p.created_at from public.customer_payments p join public.sales s on s.id=p.sale_id where p.voided_at is null and s.status='completed'
union all select p.farm_id,p.id,p.payment_date,'feed_purchase_payment',p.feed_purchase_id,'OUT',p.amount,p.payment_method,coalesce(x.purchase_number,'Feed purchase payment'),p.reference,p.created_at from public.feed_purchase_payments p join public.feed_purchases x on x.id=p.feed_purchase_id where p.voided_at is null and x.status='completed'
union all select p.farm_id,p.id,p.payment_date,'raw_material_purchase_payment',p.purchase_batch_id,'OUT',p.amount,p.payment_method,coalesce(x.purchase_number,'Material purchase payment'),p.reference,p.created_at from public.raw_material_purchase_payments p join public.raw_material_purchase_batches x on x.id=p.purchase_batch_id where p.voided_at is null and x.status='completed'
union all select p.farm_id,p.id,p.payment_date,'expense_payment',p.expense_id,'OUT',p.amount,p.payment_method,coalesce(x.expense_number,'Expense payment'),p.reference,p.created_at from public.expense_payments p join public.expenses x on x.id=p.expense_id where p.voided_at is null and x.status='active'
union all select a.farm_id,a.id,a.adjustment_date,'cash_adjustment',a.id,a.direction,a.amount,a.payment_method,a.description,a.reference,a.created_at from public.cash_adjustments a where a.status='active';

create trigger flock_hen_day_targets_updated_at before update on public.flock_hen_day_targets for each row execute function public.set_updated_at();
create trigger flock_hen_day_targets_audit after insert or update or delete on public.flock_hen_day_targets for each row execute function public.write_business_audit();
create trigger raw_material_purchase_payments_audit after insert or update or delete on public.raw_material_purchase_payments for each row execute function public.write_business_audit();
grant select on public.flock_hen_day_targets,public.raw_material_purchase_payments,public.v_raw_material_purchase_receivables,public.v_supplier_payables,public.v_cash_ledger to authenticated;
revoke all on function public.save_flock_hen_day_target(uuid,numeric,date,text),public.get_hen_day_target_summary(date,date,uuid),public.record_raw_material_purchase_payment(uuid,date,numeric,text,text,text),public.void_raw_material_purchase_payment(uuid,text) from public,anon;
grant execute on function public.save_flock_hen_day_target(uuid,numeric,date,text),public.get_hen_day_target_summary(date,date,uuid),public.record_raw_material_purchase_payment(uuid,date,numeric,text,text,text),public.void_raw_material_purchase_payment(uuid,text) to authenticated;
