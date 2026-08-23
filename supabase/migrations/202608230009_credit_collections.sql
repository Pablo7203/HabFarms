-- Credit terms and collections tracking. Existing receivables remain unscheduled.
alter table public.customers add column default_credit_days integer;
alter table public.customers add constraint customers_default_credit_days_check check(default_credit_days is null or default_credit_days between 1 and 365);
alter table public.sales add column credit_days integer;
alter table public.sales add column payment_due_date date;
alter table public.sales add constraint sales_credit_days_check check(credit_days is null or credit_days between 1 and 365);
alter table public.sales add constraint sales_payment_due_date_check check(payment_due_date is null or payment_due_date>=sale_date);
create index sales_farm_due_idx on public.sales(farm_id,payment_due_date) where status='completed';
create index sales_farm_customer_due_idx on public.sales(farm_id,customer_id,payment_due_date) where status='completed';

drop function public.create_customer(text,text,text,text,text,text);
create function public.create_customer(name text,phone text,email text,location text,customer_type text,notes text,default_credit_days integer default null) returns public.customers language plpgsql security definer set search_path='' as $$
declare f uuid;r public.customers;begin
  select farm_id into f from public.farm_members where user_id=auth.uid()and active and role in('admin','manager')order by created_at limit 1;
  if f is null then raise exception'Commercial access denied'using errcode='42501';end if;
  if default_credit_days is not null and default_credit_days not between 1 and 365 then raise exception'Credit days must be between 1 and 365'using errcode='23514';end if;
  insert into public.customers(farm_id,name,phone,email,location,customer_type,notes,default_credit_days,created_by)values(f,trim(name),nullif(trim(phone),''),nullif(trim(email),''),nullif(trim(location),''),customer_type,nullif(trim(notes),''),default_credit_days,auth.uid())returning*into r;return r;
end;$$;

drop function public.update_customer(uuid,text,text,text,text,text,boolean,text);
create function public.update_customer(target_customer uuid,name text,phone text,email text,location text,customer_type text,active boolean,notes text,default_credit_days integer default null) returns public.customers language plpgsql security definer set search_path='' as $$
declare f uuid;r public.customers;begin
  select farm_id into f from public.customers where id=target_customer for update;
  if f is null or not public.has_farm_role(f,array['admin','manager'])then raise exception'Customer access denied'using errcode='42501';end if;
  if default_credit_days is not null and default_credit_days not between 1 and 365 then raise exception'Credit days must be between 1 and 365'using errcode='23514';end if;
  update public.customers set name=trim(update_customer.name),phone=nullif(trim(update_customer.phone),''),email=nullif(trim(update_customer.email),''),location=nullif(trim(update_customer.location),''),customer_type=update_customer.customer_type,active=update_customer.active,notes=nullif(trim(update_customer.notes),''),default_credit_days=update_customer.default_credit_days,updated_by=auth.uid()where id=target_customer returning*into r;return r;
end;$$;

drop function public.post_egg_sale(uuid,date,integer,numeric,integer,numeric,numeric,numeric,text,text);
create function public.post_egg_sale(customer_id uuid,sale_date date,crate_quantity integer,crate_price numeric,loose_quantity integer,loose_price numeric,discount numeric,amount_paid numeric,payment_method text,notes text default null,credit_days integer default null) returns public.sales language plpgsql security definer set search_path='' as $$
declare f uuid;crate_size integer;subtotal numeric(14,2);total numeric(14,2);eggs integer;available bigint;r public.sales;sn text;due_date date;begin
  select fm.farm_id,fa.crate_size into f,crate_size from public.farm_members fm join public.farms fa on fa.id=fm.farm_id where fm.user_id=auth.uid()and fm.active and fm.role in('admin','manager')order by fm.created_at limit 1;
  if f is null then raise exception'Commercial access denied'using errcode='42501';end if;perform pg_advisory_xact_lock(hashtextextended(f::text,0));
  if customer_id is not null and not exists(select 1 from public.customers c where c.id=customer_id and c.farm_id=f and c.active)then raise exception'Customer does not belong to this farm'using errcode='42501';end if;
  if coalesce(crate_quantity,0)<0 or coalesce(loose_quantity,0)<0 or(coalesce(crate_quantity,0)=0 and coalesce(loose_quantity,0)=0)or crate_price<0 or loose_price<0 then raise exception'Invalid sale items'using errcode='22023';end if;
  eggs:=coalesce(crate_quantity,0)*crate_size+coalesce(loose_quantity,0);subtotal:=round(coalesce(crate_quantity,0)*crate_price+coalesce(loose_quantity,0)*loose_price,2);
  if discount<0 or discount>subtotal then raise exception'Invalid discount'using errcode='22023';end if;total:=subtotal-discount;
  if amount_paid<0 or amount_paid>total then raise exception'Payment exceeds sale total'using errcode='23514';end if;
  if customer_id is null and amount_paid<>total then raise exception'A customer is required for unpaid or partially paid sales'using errcode='23514';end if;
  if amount_paid<total and(credit_days is null or credit_days not between 1 and 365)then raise exception'Credit terms are required for unpaid or partially paid sales'using errcode='23514';end if;
  if amount_paid<total then due_date:=sale_date+credit_days;elsif credit_days is not null then if credit_days not between 1 and 365 then raise exception'Credit days must be between 1 and 365'using errcode='23514';end if;due_date:=sale_date+credit_days;end if;
  select coalesce(sum(case when direction='IN'then quantity_eggs else-quantity_eggs end),0)into available from public.egg_inventory_movements where farm_id=f;if eggs>available then raise exception'Only % eggs are currently available',available using errcode='23514';end if;
  sn:='SALE-'||to_char(sale_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.sales(farm_id,sale_number,customer_id,sale_date,subtotal,discount,total_amount,notes,credit_days,payment_due_date,created_by)values(f,sn,customer_id,sale_date,subtotal,discount,total,nullif(trim(notes),''),credit_days,due_date,auth.uid())returning*into r;
  if crate_quantity>0 then insert into public.sale_items(sale_id,item_type,quantity,eggs_per_unit,price_per_unit,total_eggs,line_total)values(r.id,'crate',crate_quantity,crate_size,crate_price,crate_quantity*crate_size,round(crate_quantity*crate_price,2));end if;
  if loose_quantity>0 then insert into public.sale_items(sale_id,item_type,quantity,eggs_per_unit,price_per_unit,total_eggs,line_total)values(r.id,'loose_egg',loose_quantity,1,loose_price,loose_quantity,round(loose_quantity*loose_price,2));end if;
  insert into public.egg_inventory_movements(farm_id,movement_date,movement_type,direction,quantity_eggs,source_type,source_id,created_by)values(f,sale_date,'sale','OUT',eggs,'egg_sale',r.id,auth.uid());perform public.assert_nonnegative_egg_history(f);
  if amount_paid>0 then insert into public.customer_payments(farm_id,customer_id,sale_id,payment_date,amount,payment_method,created_by)values(f,customer_id,r.id,sale_date,amount_paid,payment_method,auth.uid());end if;return r;
end;$$;

drop function public.update_egg_sale(uuid,uuid,integer,numeric,integer,numeric,numeric,text);
create function public.update_egg_sale(target_sale uuid,customer_id uuid,crate_quantity integer,crate_price numeric,loose_quantity integer,loose_price numeric,discount numeric,notes text default null,credit_days integer default null) returns public.sales language plpgsql security definer set search_path='' as $$
declare s public.sales;crate_size integer;new_subtotal numeric;new_total numeric;eggs integer;paid numeric;r public.sales;new_credit integer;new_due date;begin
  select*into s from public.sales where id=target_sale for update;if s.id is null or s.status<>'completed'or not public.has_farm_role(s.farm_id,array['admin','manager'])then raise exception'Sale edit denied'using errcode='42501';end if;perform pg_advisory_xact_lock(hashtextextended(s.farm_id::text,0));
  if customer_id is not null and not exists(select 1 from public.customers c where c.id=customer_id and c.farm_id=s.farm_id and c.active)then raise exception'Invalid customer'using errcode='42501';end if;
  select coalesce(max(eggs_per_unit)filter(where item_type='crate'),(select f.crate_size from public.farms f where f.id=s.farm_id))into crate_size from public.sale_items where sale_id=s.id;
  eggs:=crate_quantity*crate_size+loose_quantity;new_subtotal:=round(crate_quantity*crate_price+loose_quantity*loose_price,2);new_total:=new_subtotal-discount;select coalesce(sum(amount),0)into paid from public.customer_payments where sale_id=s.id and voided_at is null;
  if eggs<=0 or discount<0 or discount>new_subtotal or new_total<paid then raise exception'Invalid sale edit or total below active payments'using errcode='23514';end if;
  if customer_id is null and paid<>new_total then raise exception'A customer is required for unpaid or partially paid sales'using errcode='23514';end if;
  new_credit:=coalesce(credit_days,s.credit_days);if new_total>paid and(new_credit is null or new_credit not between 1 and 365)then raise exception'Credit terms are required for unpaid or partially paid sales'using errcode='23514';end if;
  if new_credit is not null then new_due:=s.sale_date+new_credit;end if;
  delete from public.sale_items where sale_id=s.id;if crate_quantity>0 then insert into public.sale_items(sale_id,item_type,quantity,eggs_per_unit,price_per_unit,total_eggs,line_total)values(s.id,'crate',crate_quantity,crate_size,crate_price,crate_quantity*crate_size,round(crate_quantity*crate_price,2));end if;if loose_quantity>0 then insert into public.sale_items(sale_id,item_type,quantity,eggs_per_unit,price_per_unit,total_eggs,line_total)values(s.id,'loose_egg',loose_quantity,1,loose_price,loose_quantity,round(loose_quantity*loose_price,2));end if;
  update public.sales set customer_id=$2,subtotal=new_subtotal,discount=$7,total_amount=new_total,notes=nullif(trim($8),''),credit_days=new_credit,payment_due_date=new_due,updated_by=auth.uid()where id=s.id returning*into r;
  update public.egg_inventory_movements set quantity_eggs=eggs where source_type='egg_sale'and source_id=s.id and movement_type='sale';perform public.assert_nonnegative_egg_history(s.farm_id);return r;
end;$$;

create function public.update_sale_credit_terms(target_sale uuid,new_credit_days integer,new_due_date date,change_reason text) returns public.sales language plpgsql security definer set search_path='' as $$
declare s public.sales;r public.sales;derived_days integer;begin
  if auth.uid()is null then raise exception'Authentication required'using errcode='42501';end if;
  select*into s from public.sales where id=target_sale for update;
  if s.id is null or s.status<>'completed'or s.customer_id is null or not public.has_farm_role(s.farm_id,array['admin','manager'])then raise exception'Credit terms access denied'using errcode='42501';end if;
  if char_length(trim(coalesce(change_reason,'')))<3 then raise exception'Change reason is required'using errcode='23514';end if;
  if new_due_date is not null then derived_days:=new_due_date-s.sale_date;else derived_days:=new_credit_days;new_due_date:=s.sale_date+new_credit_days;end if;
  if derived_days not between 1 and 365 or new_due_date<>s.sale_date+derived_days then raise exception'Credit terms must be 1 to 365 days from the sale date'using errcode='23514';end if;
  update public.sales set credit_days=derived_days,payment_due_date=new_due_date,updated_by=auth.uid()where id=s.id returning*into r;
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)values(s.farm_id,auth.uid(),'sales.credit_terms_updated','sales',s.id,'Sale Credit Terms Updated',jsonb_build_object('previous_due_date',s.payment_due_date,'new_due_date',new_due_date,'previous_credit_days',s.credit_days,'new_credit_days',derived_days,'reason',trim(change_reason)));
  return r;
end;$$;

create or replace view public.v_sales_receivables with(security_invoker=true)as select s.id sale_id,s.sale_number,s.farm_id,s.customer_id,s.sale_date,s.total_amount,coalesce(sum(p.amount)filter(where p.voided_at is null),0)::numeric(14,2)total_paid,(s.total_amount-coalesce(sum(p.amount)filter(where p.voided_at is null),0))::numeric(14,2)outstanding_balance,case when coalesce(sum(p.amount)filter(where p.voided_at is null),0)=0 then'unpaid'when coalesce(sum(p.amount)filter(where p.voided_at is null),0)<s.total_amount then'partial'else'paid'end payment_status,s.status,s.credit_days,s.payment_due_date from public.sales s left join public.customer_payments p on p.sale_id=s.id group by s.id;

create view public.v_credit_collections with(security_invoker=true)as
select r.farm_id,r.sale_id,r.sale_number,r.customer_id,c.name customer_name,r.sale_date,r.credit_days,r.payment_due_date,r.total_amount sale_total,r.total_paid,r.outstanding_balance,r.payment_status,
case when r.outstanding_balance<=0 then'paid'when r.payment_due_date is null then'unscheduled'when r.payment_due_date>(now()at time zone f.timezone)::date then'upcoming'when r.payment_due_date=(now()at time zone f.timezone)::date then'due_today'else'overdue'end collection_status,
case when r.outstanding_balance>0 and r.payment_due_date>(now()at time zone f.timezone)::date then r.payment_due_date-(now()at time zone f.timezone)::date else 0 end days_until_due,
case when r.outstanding_balance>0 and r.payment_due_date<(now()at time zone f.timezone)::date then(now()at time zone f.timezone)::date-r.payment_due_date else 0 end days_overdue
from public.v_sales_receivables r join public.farms f on f.id=r.farm_id left join public.customers c on c.id=r.customer_id where r.status='completed';

create function public.get_collection_dashboard() returns table(overdue_total numeric,overdue_count bigint,due_today_total numeric,due_today_count bigint,upcoming_7_days_total numeric,upcoming_7_days_count bigint,total_outstanding numeric) language sql stable security invoker set search_path='' as $$
select coalesce(sum(outstanding_balance)filter(where collection_status='overdue'),0),count(*)filter(where collection_status='overdue'),coalesce(sum(outstanding_balance)filter(where collection_status='due_today'),0),count(*)filter(where collection_status='due_today'),coalesce(sum(outstanding_balance)filter(where collection_status='upcoming'and days_until_due<=7),0),count(*)filter(where collection_status='upcoming'and days_until_due<=7),coalesce(sum(outstanding_balance)filter(where outstanding_balance>0),0)from public.v_credit_collections;
$$;

grant select on public.v_credit_collections to authenticated,service_role;
revoke all on function public.create_customer(text,text,text,text,text,text,integer)from public,anon;grant execute on function public.create_customer(text,text,text,text,text,text,integer)to authenticated;
revoke all on function public.update_customer(uuid,text,text,text,text,text,boolean,text,integer)from public,anon;grant execute on function public.update_customer(uuid,text,text,text,text,text,boolean,text,integer)to authenticated;
revoke all on function public.post_egg_sale(uuid,date,integer,numeric,integer,numeric,numeric,numeric,text,text,integer)from public,anon;grant execute on function public.post_egg_sale(uuid,date,integer,numeric,integer,numeric,numeric,numeric,text,text,integer)to authenticated;
revoke all on function public.update_egg_sale(uuid,uuid,integer,numeric,integer,numeric,numeric,text,integer)from public,anon;grant execute on function public.update_egg_sale(uuid,uuid,integer,numeric,integer,numeric,numeric,text,integer)to authenticated;
revoke all on function public.update_sale_credit_terms(uuid,integer,date,text)from public,anon;grant execute on function public.update_sale_credit_terms(uuid,integer,date,text)to authenticated;
revoke all on function public.get_collection_dashboard()from public,anon;grant execute on function public.get_collection_dashboard()to authenticated;
