-- Bird Sales extend the existing commercial sale header. Egg sales remain unchanged.
alter table public.sales add column sale_type text not null default 'egg' check (sale_type in ('egg','bird'));

create table public.bird_sale_details (
  sale_id uuid primary key references public.sales(id) on delete restrict,
  farm_id uuid not null references public.farms(id) on delete cascade,
  flock_id uuid not null references public.flocks(id) on delete restrict,
  category text not null check (category in ('live_bird','spent_layer','cull_bird')),
  quantity integer not null check (quantity > 0),
  price_per_bird numeric(14,2) not null check (price_per_bird > 0),
  line_total numeric(14,2) not null check (line_total > 0),
  bird_movement_id uuid unique references public.bird_movements(id) on delete restrict,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  check (line_total = round(quantity * price_per_bird, 2))
);
create index bird_sale_details_farm_flock_idx on public.bird_sale_details(farm_id, flock_id);

alter table public.bird_sale_details enable row level security;
create policy bird_sale_details_read_members on public.bird_sale_details for select to authenticated using (public.is_farm_member(farm_id));

create function public.post_bird_sale(customer_id uuid, target_flock_id uuid, sale_date date, sale_category text, quantity integer, price_per_bird numeric, amount_paid numeric, payment_method text, credit_days integer default null, notes text default null)
returns public.sales language plpgsql security definer set search_path='' as $$
declare f uuid; flock public.flocks; s public.sales; movement public.bird_movements; total numeric(14,2); due_date date; available integer; sn text;
begin
  select farm_id into f from public.farm_members where user_id=auth.uid() and active and role in ('admin','manager') order by created_at limit 1;
  if f is null then raise exception 'Commercial access denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(f::text,0));
  select * into flock from public.flocks where id=target_flock_id and farm_id=f for update;
  if flock.id is null or flock.status <> 'active' then raise exception 'Flock is not available for sale' using errcode='42501'; end if;
  if customer_id is null or not exists(select 1 from public.customers where id=customer_id and farm_id=f and active) then raise exception 'A valid customer is required' using errcode='42501'; end if;
  if sale_category not in ('live_bird','spent_layer','cull_bird') or quantity <= 0 or price_per_bird <= 0 or amount_paid < 0 then raise exception 'Invalid bird sale values' using errcode='23514'; end if;
  available := public.flock_balance_at(target_flock_id, sale_date);
  if quantity > available then raise exception 'Bird sale quantity exceeds birds available on the sale date' using errcode='23514'; end if;
  total := round(quantity * price_per_bird,2);
  if amount_paid > total then raise exception 'The payment exceeds the sale total' using errcode='23514'; end if;
  if amount_paid < total and credit_days is null then raise exception 'Credit terms are required for an unpaid balance' using errcode='23514'; end if;
  if credit_days is not null and (credit_days < 1 or credit_days > 365) then raise exception 'Credit days must be between 1 and 365' using errcode='23514'; end if;
  due_date := case when amount_paid < total then sale_date + credit_days else null end;
  sn := 'SALE-' || to_char(sale_date,'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.sales(farm_id,sale_number,sale_type,customer_id,sale_date,subtotal,discount,total_amount,notes,credit_days,payment_due_date,created_by) values(f,sn,'bird',customer_id,sale_date,total,0,total,nullif(trim(notes),''),case when amount_paid < total then credit_days else null end,due_date,auth.uid()) returning * into s;
  insert into public.bird_movements(farm_id,flock_id,movement_date,movement_type,quantity,direction,source_type,source_id,notes,created_by) values(f,target_flock_id,sale_date,'bird_sale',quantity,'OUT','bird_sale',s.id,nullif(trim(notes),''),auth.uid()) returning * into movement;
  perform public.assert_nonnegative_flock_history(target_flock_id);
  insert into public.bird_sale_details(sale_id,farm_id,flock_id,category,quantity,price_per_bird,line_total,bird_movement_id,notes,created_by) values(s.id,f,target_flock_id,sale_category,quantity,price_per_bird,total,movement.id,nullif(trim(notes),''),auth.uid());
  if amount_paid > 0 then insert into public.customer_payments(farm_id,customer_id,sale_id,payment_date,amount,payment_method,created_by) values(f,customer_id,s.id,sale_date,amount_paid,payment_method,auth.uid()); end if;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata) values(f,auth.uid(),'bird_sales.created','sales',s.id,'Bird Sale Created',jsonb_build_object('flock_id',target_flock_id,'category',sale_category,'quantity',quantity,'price_per_bird',price_per_bird,'total',total,'movement_id',movement.id));
  return s;
end; $$;

create or replace function public.void_bird_sale(target_sale uuid, reason text) returns void language plpgsql security definer set search_path='' as $$
declare s public.sales; d public.bird_sale_details;
begin
  select * into s from public.sales where id=target_sale for update;
  if s.id is null or s.sale_type <> 'bird' or s.status <> 'completed' or not public.has_farm_role(s.farm_id,array['admin']) or char_length(trim(reason)) < 3 then raise exception 'Bird sale void denied' using errcode='42501'; end if;
  if exists(select 1 from public.customer_payments where sale_id=s.id and voided_at is null) then raise exception 'Active payments must be voided first' using errcode='23514'; end if;
  select * into d from public.bird_sale_details where sale_id=s.id for update;
  perform pg_advisory_xact_lock(hashtextextended(s.farm_id::text,0));
  update public.sales set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=trim(reason),updated_by=auth.uid() where id=s.id;
  insert into public.bird_movements(farm_id,flock_id,movement_date,movement_type,quantity,direction,source_type,source_id,notes,created_by) values(s.farm_id,d.flock_id,s.sale_date,'addition',d.quantity,'IN','bird_sale_reversal',s.id,trim(reason),auth.uid());
  perform public.assert_nonnegative_flock_history(d.flock_id);
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata) values(s.farm_id,auth.uid(),'bird_sales.voided','sales',s.id,'Bird Sale Voided',jsonb_build_object('flock_id',d.flock_id,'quantity',d.quantity,'reason',trim(reason)));
end; $$;

grant select on public.bird_sale_details to authenticated;
grant execute on function public.post_bird_sale(uuid,uuid,date,text,integer,numeric,numeric,text,integer,text), public.void_bird_sale(uuid,text) to authenticated;

create or replace view public.v_sales_receivables with(security_invoker=true) as
select s.id sale_id,s.sale_number,s.farm_id,s.customer_id,s.sale_date,s.total_amount,coalesce(sum(p.amount)filter(where p.voided_at is null),0)::numeric(14,2) total_paid,(s.total_amount-coalesce(sum(p.amount)filter(where p.voided_at is null),0))::numeric(14,2) outstanding_balance,case when coalesce(sum(p.amount)filter(where p.voided_at is null),0)=0 then'unpaid'when coalesce(sum(p.amount)filter(where p.voided_at is null),0)<s.total_amount then'partial'else'paid'end payment_status,s.status,s.credit_days,s.payment_due_date,s.sale_type from public.sales s left join public.customer_payments p on p.sale_id=s.id group by s.id;
create or replace view public.v_credit_collections with(security_invoker=true) as
select r.farm_id,r.sale_id,r.sale_number,r.customer_id,c.name customer_name,r.sale_date,r.credit_days,r.payment_due_date,r.total_amount sale_total,r.total_paid,r.outstanding_balance,r.payment_status,case when r.outstanding_balance<=0 then'paid'when r.payment_due_date is null then'unscheduled'when r.payment_due_date>(now()at time zone f.timezone)::date then'upcoming'when r.payment_due_date=(now()at time zone f.timezone)::date then'due_today'else'overdue'end collection_status,case when r.outstanding_balance>0 and r.payment_due_date>(now()at time zone f.timezone)::date then r.payment_due_date-(now()at time zone f.timezone)::date else 0 end days_until_due,case when r.outstanding_balance>0 and r.payment_due_date<(now()at time zone f.timezone)::date then(now()at time zone f.timezone)::date-r.payment_due_date else 0 end days_overdue,r.sale_type from public.v_sales_receivables r join public.farms f on f.id=r.farm_id left join public.customers c on c.id=r.customer_id where r.status='completed';
