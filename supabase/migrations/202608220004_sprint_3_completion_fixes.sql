create or replace function public.update_egg_sale(target_sale uuid,customer_id uuid,crate_quantity integer,crate_price numeric,loose_quantity integer,loose_price numeric,discount numeric,notes text default null)returns public.sales language plpgsql security definer set search_path='' as $$
declare s public.sales;crate_size integer;subtotal numeric;total numeric;eggs integer;paid numeric;r public.sales;
begin
  select*into s from public.sales where id=target_sale for update;
  if s.id is null or s.status<>'completed'or not public.has_farm_role(s.farm_id,array['admin','manager'])then raise exception'Sale edit denied'using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(s.farm_id::text,0));
  if customer_id is not null and not exists(select 1 from public.customers c where c.id=customer_id and c.farm_id=s.farm_id and c.active)then raise exception'Invalid customer'using errcode='42501';end if;
  select coalesce(max(eggs_per_unit)filter(where item_type='crate'),(select f.crate_size from public.farms f where f.id=s.farm_id))into crate_size from public.sale_items where sale_id=s.id;
  eggs:=crate_quantity*crate_size+loose_quantity;subtotal:=round(crate_quantity*crate_price+loose_quantity*loose_price,2);total:=subtotal-discount;
  select coalesce(sum(amount),0)into paid from public.customer_payments where sale_id=s.id and voided_at is null;
  if eggs<=0 or discount<0 or discount>subtotal or total<paid then raise exception'Invalid sale edit or total below active payments'using errcode='23514';end if;
  if customer_id is null and paid<>total then raise exception'A customer is required for unpaid or partially paid sales'using errcode='23514';end if;
  delete from public.sale_items where sale_id=s.id;
  if crate_quantity>0 then insert into public.sale_items(sale_id,item_type,quantity,eggs_per_unit,price_per_unit,total_eggs,line_total)values(s.id,'crate',crate_quantity,crate_size,crate_price,crate_quantity*crate_size,round(crate_quantity*crate_price,2));end if;
  if loose_quantity>0 then insert into public.sale_items(sale_id,item_type,quantity,eggs_per_unit,price_per_unit,total_eggs,line_total)values(s.id,'loose_egg',loose_quantity,1,loose_price,loose_quantity,round(loose_quantity*loose_price,2));end if;
  update public.sales set customer_id=$2,subtotal=round($3*$4+$5*$6,2),discount=$7,total_amount=round($3*$4+$5*$6,2)-$7,notes=nullif(trim($8),''),updated_by=auth.uid()where id=s.id returning*into r;
  update public.egg_inventory_movements set quantity_eggs=eggs where source_type='egg_sale'and source_id=s.id and movement_type='sale';
  perform public.assert_nonnegative_egg_history(s.farm_id);return r;
end;$$;

create or replace view public.v_customer_balances with(security_invoker=true)as
select c.id customer_id,c.farm_id,
  coalesce((select sum(s.total_amount)from public.sales s where s.customer_id=c.id and s.status='completed'),0)::numeric(14,2) total_sales,
  coalesce((select sum(p.amount)from public.customer_payments p join public.sales s on s.id=p.sale_id where p.customer_id=c.id and p.voided_at is null and s.status='completed'),0)::numeric(14,2) total_payments,
  (coalesce((select sum(s.total_amount)from public.sales s where s.customer_id=c.id and s.status='completed'),0)-coalesce((select sum(p.amount)from public.customer_payments p join public.sales s on s.id=p.sale_id where p.customer_id=c.id and p.voided_at is null and s.status='completed'),0))::numeric(14,2) outstanding_balance
from public.customers c;
grant select on public.v_customer_balances to authenticated,service_role;

-- RLS policies call this helper as the querying role, so authenticated users
-- need EXECUTE even though direct application RPC access remains restricted.
grant execute on function public.has_farm_role(uuid,text[]) to authenticated;
