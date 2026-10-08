-- Admin corrections keep the sale, payment history, and dated inventory ledger
-- in sync. Existing manager update RPCs remain available without date edits.
create or replace function public.admin_update_graded_egg_sale(
  target_sale uuid,
  customer_id uuid,
  new_sale_date date,
  items jsonb,
  discount numeric,
  notes text default null,
  credit_days integer default null
) returns public.sales
language plpgsql security definer set search_path=''
as $$
declare
  sale public.sales;
  farm_crate_size integer;
  computed_subtotal numeric := 0;
  computed_total numeric;
  active_paid numeric;
  result public.sales;
  item record;
  grade public.egg_grades;
  new_credit integer;
  new_due date;
  old_grade_ids uuid[];
  affected_grade uuid;
  farm_timezone text;
begin
  select * into sale from public.sales where id=target_sale for update;
  if sale.id is null or sale.sale_type <> 'egg' or sale.status <> 'completed'
    or not public.has_farm_role(sale.farm_id,array['admin']) then
    raise exception 'Sale edit denied' using errcode='42501';
  end if;
  select f.crate_size,f.timezone into farm_crate_size,farm_timezone
    from public.farms f where f.id=sale.farm_id;
  if new_sale_date is null or new_sale_date > (now() at time zone farm_timezone)::date then
    raise exception 'Sale date cannot be in the future' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(sale.farm_id::text,0));
  select coalesce(array_agg(distinct si.egg_grade_id),array[]::uuid[]) into old_grade_ids
    from public.sale_items si where si.sale_id=sale.id;
  if customer_id is not null and not exists(
    select 1 from public.customers c where c.id=customer_id and c.farm_id=sale.farm_id and c.active
  ) then raise exception 'Invalid customer' using errcode='42501'; end if;
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)=0 then
    raise exception 'Add at least one sale item' using errcode='22023';
  end if;

  for item in select (x->>'egg_grade_id')::uuid as grade_id,x->>'unit' as unit,
    (x->>'quantity')::integer as quantity,(x->>'price_per_unit')::numeric as price
    from jsonb_array_elements(items) x
  loop
    select * into grade from public.egg_grades
      where id=item.grade_id and farm_id=sale.farm_id and is_active;
    if grade.id is null or item.unit not in ('crate','loose_egg')
      or item.quantity is null or item.quantity<=0 or item.price is null or item.price<0 then
      raise exception 'Invalid egg sale item or missing sale price' using errcode='23514';
    end if;
    computed_subtotal:=computed_subtotal+round(item.quantity*item.price,2);
  end loop;

  computed_subtotal:=round(computed_subtotal,2);
  computed_total:=computed_subtotal-discount;
  select coalesce(sum(p.amount),0) into active_paid
    from public.customer_payments p where p.sale_id=sale.id and p.voided_at is null;
  if discount is null or discount<0 or discount>computed_subtotal or computed_total<active_paid then
    raise exception 'Invalid sale edit or total below active payments' using errcode='23514';
  end if;
  new_credit:=coalesce(credit_days,sale.credit_days);
  if computed_total>active_paid and (new_credit is null or new_credit not between 1 and 365) then
    raise exception 'Credit terms are required for unpaid or partially paid sales' using errcode='23514';
  end if;
  if computed_total>active_paid and new_credit is not null then new_due:=new_sale_date+new_credit; end if;

  delete from public.sale_items where sale_id=sale.id;
  delete from public.egg_inventory_movements
    where source_type='egg_sale' and source_id=sale.id and movement_type='sale';
  for item in select (x->>'egg_grade_id')::uuid as grade_id,x->>'unit' as unit,
    (x->>'quantity')::integer as quantity,(x->>'price_per_unit')::numeric as price
    from jsonb_array_elements(items) x
  loop
    select * into grade from public.egg_grades where id=item.grade_id and farm_id=sale.farm_id;
    insert into public.sale_items(
      sale_id,egg_grade_id,egg_grade_code_snapshot,egg_grade_name_snapshot,
      item_type,quantity,eggs_per_unit,price_per_unit,total_eggs,line_total
    ) values(
      sale.id,grade.id,grade.system_code,grade.name,item.unit,item.quantity,
      case when item.unit='crate' then farm_crate_size else 1 end,item.price,
      item.quantity*case when item.unit='crate' then farm_crate_size else 1 end,
      round(item.quantity*item.price,2)
    );
  end loop;

  insert into public.egg_inventory_movements(
    farm_id,egg_grade_id,movement_date,movement_type,direction,quantity_eggs,
    source_type,source_id,created_by
  )
  select sale.farm_id,si.egg_grade_id,new_sale_date,'sale','OUT',sum(si.total_eggs)::integer,
    'egg_sale',sale.id,auth.uid()
  from public.sale_items si where si.sale_id=sale.id group by si.egg_grade_id;

  update public.sales set customer_id=admin_update_graded_egg_sale.customer_id,
    sale_date=new_sale_date,subtotal=computed_subtotal,discount=admin_update_graded_egg_sale.discount,
    total_amount=computed_total,notes=nullif(trim(admin_update_graded_egg_sale.notes),''),
    credit_days=new_credit,payment_due_date=new_due,updated_by=auth.uid()
    where id=sale.id returning * into result;

  for affected_grade in
    select distinct affected.id from (
      select unnest(old_grade_ids) as id
      union all
      select (x->>'egg_grade_id')::uuid from jsonb_array_elements(items) x
    ) affected where affected.id is not null
  loop
    perform public.assert_nonnegative_egg_grade_history(sale.farm_id,affected_grade);
  end loop;

  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
  values(sale.farm_id,auth.uid(),'sales.corrected','sales',sale.id,'Egg Sale Corrected',jsonb_build_object(
    'previous_sale_date',sale.sale_date,'new_sale_date',new_sale_date,
    'previous_total',sale.total_amount,'new_total',computed_total,
    'previous_customer_id',sale.customer_id,'new_customer_id',customer_id
  ));
  return result;
end;
$$;

revoke all on function public.admin_update_graded_egg_sale(uuid,uuid,date,jsonb,numeric,text,integer) from public,anon;
grant execute on function public.admin_update_graded_egg_sale(uuid,uuid,date,jsonb,numeric,text,integer) to authenticated;
