-- Allow a manual farm expense to be attributed to one laying flock.
-- DOC/rearing batch costs keep their existing, cost-aware attribution path.
alter table public.expenses
  add column flock_id uuid,
  add constraint expense_flock_same_farm foreign key(flock_id,farm_id)
    references public.flocks(id,farm_id) on delete restrict,
  add constraint expense_one_attribution_check
    check(flock_id is null or rearing_batch_id is null);

create index expenses_flock_date_idx on public.expenses(farm_id,flock_id,expense_date desc)
  where flock_id is not null and status='active';

drop function public.create_expense(date,uuid,text,uuid,text,numeric,numeric,text,text,text);
create function public.create_expense(expense_date date,category_id uuid,description text,supplier_id uuid,payee_name text,
  amount numeric,initial_payment numeric default 0,payment_method text default 'cash',reference text default null,
  notes text default null,target_flock uuid default null)
returns public.expenses language plpgsql security definer set search_path='' as $$
declare f uuid;r public.expenses;
begin
  f:=public.expense_access_farm(array['admin','manager']);
  if $6<=0 or $7<0 or $7>$6 then raise exception 'Invalid expense or payment amount' using errcode='23514';end if;
  if not exists(select 1 from public.expense_categories where id=$2 and farm_id=f and active)
    or ($4 is not null and not exists(select 1 from public.suppliers where id=$4 and farm_id=f and active)) then
    raise exception 'Invalid category or supplier' using errcode='42501';
  end if;
  if $11 is not null and not exists(select 1 from public.flocks where id=$11 and farm_id=f) then
    raise exception 'Selected flock was not found in this farm' using errcode='23503';
  end if;
  insert into public.expenses(farm_id,expense_number,expense_date,category_id,description,supplier_id,payee_name,amount,
    source_type,source_key,flock_id,notes,created_by)
  values(f,public.next_expense_number(f,$1),$1,$2,trim($3),$4,nullif(trim($5),''),$6,'manual','manual',$11,nullif(trim($10),''),auth.uid())
  returning * into r;
  if $7>0 then
    insert into public.expense_payments(farm_id,expense_id,payment_date,amount,payment_method,reference,created_by)
    values(f,r.id,$1,$7,$8,nullif(trim($9),''),auth.uid());
  end if;
  return r;
end;$$;

drop function public.update_expense(uuid,date,uuid,text,uuid,text,numeric,text);
create function public.update_expense(target_expense uuid,expense_date date,category_id uuid,description text,supplier_id uuid,
  payee_name text,amount numeric,notes text default null,target_flock uuid default null)
returns public.expenses language plpgsql security definer set search_path='' as $$
declare e public.expenses;r public.expenses;paid numeric;
begin
  select * into e from public.expenses where id=$1 for update;
  if e.id is null or e.status<>'active' or e.source_type<>'manual'
    or not public.has_farm_role(e.farm_id,array['admin','manager']) then
    raise exception 'Expense edit denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.expense_categories where id=$3 and farm_id=e.farm_id)
    or ($5 is not null and not exists(select 1 from public.suppliers where id=$5 and farm_id=e.farm_id)) then
    raise exception 'Invalid category or supplier' using errcode='42501';
  end if;
  if e.rearing_batch_id is not null and $9 is not null then
    raise exception 'Rearing batch attribution is managed from the batch record' using errcode='23514';
  end if;
  if $9 is not null and not exists(select 1 from public.flocks where id=$9 and farm_id=e.farm_id) then
    raise exception 'Selected flock was not found in this farm' using errcode='23503';
  end if;
  select coalesce(sum(p.amount),0) into paid from public.expense_payments p where p.expense_id=e.id and p.voided_at is null;
  if $7<paid or $7<=0 then raise exception 'Expense amount below active payments' using errcode='23514';end if;
  update public.expenses set expense_date=$2,category_id=$3,description=trim($4),supplier_id=$5,
    payee_name=nullif(trim($6),''),amount=$7,notes=nullif(trim($8),''),
    flock_id=case when rearing_batch_id is null then $9 else null end,updated_by=auth.uid()
  where id=e.id returning * into r;
  return r;
end;$$;

comment on column public.expenses.flock_id is 'Optional flock-level cost attribution for manual expenses; null means farm-wide. DOC batch expenses use rearing_batch_id instead.';

-- Source-generated flock costs inherit their real operational flock, so they
-- appear in the same flock cost view without creating a second expense.
create or replace function public.link_rearing_health_expense()
returns trigger language plpgsql security definer set search_path='' as $$
declare batch uuid;source_flock uuid;
begin
  if new.source_type='health_record' and new.source_key='health_cost' and new.source_id is not null then
    new.rearing_batch_id:=null;new.rearing_cost_kind:=null;new.flock_id:=null;
    select rearing_batch_id,flock_id into batch,source_flock from public.health_records
      where id=new.source_id and farm_id=new.farm_id;
    if batch is not null then new.rearing_batch_id:=batch;new.rearing_cost_kind:='health';
    elsif source_flock is not null then new.flock_id:=source_flock;end if;
  elsif new.source_type='daily_production' and new.source_id is not null then
    new.flock_id:=null;
    select flock_id into source_flock from public.daily_production_records
      where id=new.source_id and farm_id=new.farm_id;
    if source_flock is not null then new.flock_id:=source_flock;end if;
  end if;
  return new;
end;$$;
drop trigger expenses_link_rearing_health on public.expenses;
create trigger expenses_link_source_costs before insert or update on public.expenses
  for each row execute function public.link_rearing_health_expense();

update public.expenses e set flock_id=h.flock_id
from public.health_records h
where e.source_type='health_record' and e.source_key='health_cost' and e.source_id=h.id
  and e.farm_id=h.farm_id and h.flock_id is not null and h.rearing_batch_id is null and e.flock_id is null;
update public.expenses e set flock_id=p.flock_id
from public.daily_production_records p
where e.source_type='daily_production' and e.source_id=p.id and e.farm_id=p.farm_id
  and p.flock_id is not null and e.flock_id is null and e.rearing_batch_id is null;

revoke all on function public.create_expense(date,uuid,text,uuid,text,numeric,numeric,text,text,text,uuid),
  public.update_expense(uuid,date,uuid,text,uuid,text,numeric,text,uuid) from public,anon;
grant execute on function public.create_expense(date,uuid,text,uuid,text,numeric,numeric,text,text,text,uuid),
  public.update_expense(uuid,date,uuid,text,uuid,text,numeric,text,uuid) to authenticated;
