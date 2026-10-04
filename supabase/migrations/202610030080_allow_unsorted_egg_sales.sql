-- Allow the Unsorted grade to be sold at the price entered on the sale line.
-- Unsorted eggs intentionally have no effective-dated catalog price.
create or replace function public.post_graded_egg_sale(
  customer_id uuid,
  sale_date date,
  items jsonb,
  discount numeric,
  amount_paid numeric,
  payment_method text,
  notes text default null,
  credit_days integer default null
) returns public.sales
language plpgsql security definer set search_path=''
as $$
declare
  target_farm_id uuid;
  farm_crate_size integer;
  subtotal numeric := 0;
  total numeric;
  r public.sales;
  sale_number text;
  due_date date;
  item record;
  grade public.egg_grades;
begin
  target_farm_id := public.resolve_selected_farm(array['admin','manager']);
  select f.crate_size into farm_crate_size from public.farms f where f.id=target_farm_id;
  perform pg_advisory_xact_lock(hashtextextended(target_farm_id::text, 0));
  if customer_id is not null and not exists (
    select 1 from public.customers c where c.id = customer_id and c.farm_id = target_farm_id and c.active
  ) then raise exception 'Customer does not belong to this farm' using errcode='42501'; end if;
  if jsonb_typeof(items) is distinct from 'array' then
    raise exception 'Add at least one sale item' using errcode='22023';
  end if;
  if jsonb_array_length(items) = 0 then raise exception 'Add at least one sale item' using errcode='22023'; end if;

  for item in
    select (x->>'egg_grade_id')::uuid as grade_id, x->>'unit' as unit,
           (x->>'quantity')::integer as quantity, (x->>'price_per_unit')::numeric as price
    from jsonb_array_elements(items) x
  loop
    select * into grade from public.egg_grades
    where id = item.grade_id and farm_id = target_farm_id and is_active;
    if grade.id is null or item.unit not in ('crate', 'loose_egg')
       or item.quantity <= 0 or item.price is null or item.price < 0 then
      raise exception 'Invalid egg sale item or missing sale price' using errcode='23514';
    end if;
    subtotal := subtotal + round(item.quantity * item.price, 2);
  end loop;

  subtotal := round(subtotal, 2);
  total := subtotal - discount;
  if discount < 0 or discount > subtotal or amount_paid < 0 or amount_paid > total then
    raise exception 'Invalid sale total or payment' using errcode='23514';
  end if;
  if customer_id is null and amount_paid <> total then
    raise exception 'A customer is required for unpaid or partially paid sales' using errcode='23514';
  end if;
  if amount_paid < total and (credit_days is null or credit_days not between 1 and 365) then
    raise exception 'Credit terms are required for unpaid or partially paid sales' using errcode='23514';
  end if;
  if credit_days is not null then due_date := sale_date + credit_days; end if;

  sale_number := 'SALE-' || to_char(sale_date, 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.sales(
    farm_id, sale_number, customer_id, sale_date, subtotal, discount, total_amount,
    notes, credit_days, payment_due_date, created_by
  ) values (
    target_farm_id, sale_number, customer_id, sale_date, subtotal, discount, total,
    nullif(trim(notes), ''), credit_days, due_date, auth.uid()
  ) returning * into r;

  for item in
    select (x->>'egg_grade_id')::uuid as grade_id, x->>'unit' as unit,
           (x->>'quantity')::integer as quantity, (x->>'price_per_unit')::numeric as price
    from jsonb_array_elements(items) x
  loop
    select * into grade from public.egg_grades where id = item.grade_id and farm_id = target_farm_id;
    insert into public.sale_items(
      sale_id, egg_grade_id, egg_grade_code_snapshot, egg_grade_name_snapshot,
      item_type, quantity, eggs_per_unit, price_per_unit, total_eggs, line_total
    ) values (
      r.id, grade.id, grade.system_code, grade.name, item.unit, item.quantity,
      case when item.unit = 'crate' then farm_crate_size else 1 end,
      item.price,
      item.quantity * case when item.unit = 'crate' then farm_crate_size else 1 end,
      round(item.quantity * item.price, 2)
    );
    insert into public.egg_inventory_movements(
      farm_id, egg_grade_id, movement_date, movement_type, direction,
      quantity_eggs, source_type, source_id, created_by
    ) values (
      target_farm_id, grade.id, sale_date, 'sale', 'OUT',
      item.quantity * case when item.unit = 'crate' then farm_crate_size else 1 end,
      'egg_sale', r.id, auth.uid()
    ) on conflict(source_type, source_id, movement_type, egg_grade_id) where source_id is not null
      do update set quantity_eggs = public.egg_inventory_movements.quantity_eggs + excluded.quantity_eggs;
    perform public.assert_nonnegative_egg_grade_history(target_farm_id, grade.id);
  end loop;

  if amount_paid > 0 then
    insert into public.customer_payments(farm_id, customer_id, sale_id, payment_date, amount, payment_method, created_by)
    values (target_farm_id, customer_id, r.id, sale_date, amount_paid, payment_method, auth.uid());
  end if;
  return r;
end;
$$;

-- Editing a sale must retain the same grade eligibility as creating one. In
-- particular, an Unsorted line remains editable; it does not need catalog
-- pricing because the agreed line price is stored on the sale item.
create or replace function public.update_graded_egg_sale(
  target_sale uuid,
  customer_id uuid,
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
begin
  select * into sale from public.sales where id=target_sale for update;
  if sale.id is null or sale.status<>'completed'
    or not public.has_farm_role(sale.farm_id,array['admin','manager']) then
    raise exception 'Sale edit denied' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(sale.farm_id::text,0));
  select f.crate_size into farm_crate_size from public.farms f where f.id=sale.farm_id;
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
      or item.quantity<=0 or item.price is null or item.price<0 then
      raise exception 'Invalid egg sale item or missing sale price' using errcode='23514';
    end if;
    computed_subtotal:=computed_subtotal+round(item.quantity*item.price,2);
  end loop;

  computed_subtotal:=round(computed_subtotal,2);
  computed_total:=computed_subtotal-discount;
  select coalesce(sum(amount),0) into active_paid
  from public.customer_payments where sale_id=sale.id and voided_at is null;
  if discount<0 or discount>computed_subtotal or computed_total<active_paid then
    raise exception 'Invalid sale edit or total below active payments' using errcode='23514';
  end if;
  new_credit:=coalesce(credit_days,sale.credit_days);
  if computed_total>active_paid and (new_credit is null or new_credit not between 1 and 365) then
    raise exception 'Credit terms are required for unpaid or partially paid sales' using errcode='23514';
  end if;
  if new_credit is not null then new_due:=sale.sale_date+new_credit; end if;

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
    insert into public.egg_inventory_movements(
      farm_id,egg_grade_id,movement_date,movement_type,direction,quantity_eggs,
      source_type,source_id,created_by
    ) values(
      sale.farm_id,grade.id,sale.sale_date,'sale','OUT',
      item.quantity*case when item.unit='crate' then farm_crate_size else 1 end,
      'egg_sale',sale.id,auth.uid()
    ) on conflict(source_type,source_id,movement_type,egg_grade_id) where source_id is not null
      do update set quantity_eggs=public.egg_inventory_movements.quantity_eggs+excluded.quantity_eggs;
    perform public.assert_nonnegative_egg_grade_history(sale.farm_id,grade.id);
  end loop;

  update public.sales set customer_id=$2,subtotal=computed_subtotal,discount=$4,
    total_amount=computed_total,notes=nullif(trim($5),''),credit_days=new_credit,
    payment_due_date=new_due,updated_by=auth.uid()
  where id=sale.id returning * into result;
  return result;
end;
$$;

create or replace function public.update_graded_egg_sale(
  target_sale uuid,
  customer_id uuid,
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
begin
  select * into sale from public.sales where id = target_sale for update;
  if sale.id is null or sale.status <> 'completed'
     or not public.has_farm_role(sale.farm_id, array['admin', 'manager']) then
    raise exception 'Sale edit denied' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(sale.farm_id::text, 0));
  select f.crate_size into farm_crate_size from public.farms f where f.id = sale.farm_id;
  if customer_id is not null and not exists (
    select 1 from public.customers c where c.id = customer_id and c.farm_id = sale.farm_id and c.active
  ) then raise exception 'Invalid customer' using errcode='42501'; end if;
  if jsonb_typeof(items) is distinct from 'array' then
    raise exception 'Add at least one sale item' using errcode='22023';
  end if;
  if jsonb_array_length(items) = 0 then raise exception 'Add at least one sale item' using errcode='22023'; end if;

  for item in
    select (x->>'egg_grade_id')::uuid as grade_id, x->>'unit' as unit,
           (x->>'quantity')::integer as quantity, (x->>'price_per_unit')::numeric as price
    from jsonb_array_elements(items) x
  loop
    select * into grade from public.egg_grades
    where id = item.grade_id and farm_id = sale.farm_id and is_active;
    if grade.id is null or item.unit not in ('crate', 'loose_egg')
       or item.quantity <= 0 or item.price is null or item.price < 0 then
      raise exception 'Invalid egg sale item or missing sale price' using errcode='23514';
    end if;
    computed_subtotal := computed_subtotal + round(item.quantity * item.price, 2);
  end loop;

  computed_subtotal := round(computed_subtotal, 2);
  computed_total := computed_subtotal - discount;
  select coalesce(sum(amount), 0) into active_paid
  from public.customer_payments where sale_id = sale.id and voided_at is null;
  if computed_total < active_paid or discount < 0 or discount > computed_subtotal then
    raise exception 'Invalid sale edit or total below active payments' using errcode='23514';
  end if;
  new_credit := coalesce(credit_days, sale.credit_days);
  if computed_total > active_paid and (new_credit is null or new_credit not between 1 and 365) then
    raise exception 'Credit terms are required for unpaid or partially paid sales' using errcode='23514';
  end if;
  if new_credit is not null then new_due := sale.sale_date + new_credit; end if;

  delete from public.sale_items where sale_id = sale.id;
  delete from public.egg_inventory_movements
  where source_type = 'egg_sale' and source_id = sale.id and movement_type = 'sale';
  for item in
    select (x->>'egg_grade_id')::uuid as grade_id, x->>'unit' as unit,
           (x->>'quantity')::integer as quantity, (x->>'price_per_unit')::numeric as price
    from jsonb_array_elements(items) x
  loop
    select * into grade from public.egg_grades where id = item.grade_id and farm_id = sale.farm_id;
    insert into public.sale_items(
      sale_id, egg_grade_id, egg_grade_code_snapshot, egg_grade_name_snapshot,
      item_type, quantity, eggs_per_unit, price_per_unit, total_eggs, line_total
    ) values (
      sale.id, grade.id, grade.system_code, grade.name, item.unit, item.quantity,
      case when item.unit = 'crate' then farm_crate_size else 1 end,
      item.price,
      item.quantity * case when item.unit = 'crate' then farm_crate_size else 1 end,
      round(item.quantity * item.price, 2)
    );
    insert into public.egg_inventory_movements(
      farm_id, egg_grade_id, movement_date, movement_type, direction,
      quantity_eggs, source_type, source_id, created_by
    ) values (
      sale.farm_id, grade.id, sale.sale_date, 'sale', 'OUT',
      item.quantity * case when item.unit = 'crate' then farm_crate_size else 1 end,
      'egg_sale', sale.id, auth.uid()
    ) on conflict(source_type, source_id, movement_type, egg_grade_id) where source_id is not null
      do update set quantity_eggs = public.egg_inventory_movements.quantity_eggs + excluded.quantity_eggs;
    perform public.assert_nonnegative_egg_grade_history(sale.farm_id, grade.id);
  end loop;

  update public.sales set
    customer_id = $2, subtotal = computed_subtotal, discount = $4, total_amount = computed_total,
    notes = nullif(trim($5), ''), credit_days = new_credit, payment_due_date = new_due,
    updated_by = auth.uid()
  where id = sale.id returning * into result;
  return result;
end;
$$;
