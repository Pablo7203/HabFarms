-- Post-v1.0 egg-grade expansion and transaction-derived farm performance summaries.
-- This migration is forward-only. It preserves all existing grade, inventory, and sale history.

create or replace function public.provision_default_egg_grades(target_farm uuid,target_actor uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.egg_grades(farm_id,system_code,name,description,is_unsorted,sort_order,created_by)
  values
    (target_farm,'unsorted','Unsorted','Eggs awaiting grading',true,0,target_actor),
    (target_farm,'smaller','Smaller',null,false,10,target_actor),
    (target_farm,'small','Small',null,false,20,target_actor),
    (target_farm,'medium','Medium',null,false,30,target_actor),
    (target_farm,'large','Large',null,false,40,target_actor),
    (target_farm,'bigger','Bigger',null,false,50,target_actor)
  on conflict(farm_id,system_code) do update set
    name=excluded.name,
    description=excluded.description,
    is_unsorted=excluded.is_unsorted,
    sort_order=excluded.sort_order;
end;$$;

do $$
declare x record;
begin
  for x in
    select f.id, (select fm.user_id from public.farm_members fm where fm.farm_id=f.id and fm.role='admin' and fm.active order by fm.created_at limit 1) actor
    from public.farms f
  loop
    if x.actor is not null then perform public.provision_default_egg_grades(x.id,x.actor); end if;
  end loop;
end $$;

-- A production record uses the same pre-loss population convention as the existing metrics view.
create or replace function public.assert_production_within_eligible_birds(target_flock uuid,target_date date,eggs integer,excluding_production uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare eligible integer;
begin
  select f.initial_birds + coalesce(sum(case when bm.direction='IN' then bm.quantity else -bm.quantity end) filter (where bm.movement_date<=target_date and (excluding_production is null or not (bm.source_type='daily_production' and bm.source_id=excluding_production))),0)::integer
  into eligible
  from public.flocks f left join public.bird_movements bm on bm.flock_id=f.id
  where f.id=target_flock group by f.id;
  if eggs>coalesce(eligible,0) then
    raise exception 'Production exceeds the available bird count for this flock and date. % eligible birds can produce a maximum of % eggs for this daily production record. Please verify the flock population, production date, or eggs collected.', coalesce(eligible,0), coalesce(eligible,0) using errcode='23514';
  end if;
end;$$;

create or replace function public.create_daily_production_graded(target_flock_id uuid,production_date date,eggs_collected integer,cracked_eggs integer,deaths integer,culls integer,feed_consumed_kg numeric,feed_type_id uuid,transport_cost numeric,other_cost numeric,notes text,grade_allocations jsonb default null) returns public.daily_production_records language plpgsql security definer set search_path='' as $$
declare r public.daily_production_records; f uuid; good integer; total integer; u uuid; a record;
begin
  perform public.assert_production_within_eligible_birds(target_flock_id,production_date,eggs_collected,null);
  r:=public.create_daily_production(target_flock_id,production_date,eggs_collected,cracked_eggs,deaths,culls,feed_consumed_kg,feed_type_id,transport_cost,other_cost,notes);
  f:=r.farm_id; good:=eggs_collected-cracked_eggs;
  delete from public.egg_inventory_movements where source_type='daily_production' and source_id=r.id;
  if grade_allocations is null or jsonb_array_length(grade_allocations)=0 then
    select id into u from public.egg_grades where farm_id=f and system_code='unsorted';
    if good>0 then
      insert into public.daily_production_grade_allocations(farm_id,production_record_id,egg_grade_id,quantity_eggs,created_by) values(f,r.id,u,good,auth.uid());
      insert into public.egg_inventory_movements(farm_id,egg_grade_id,movement_date,movement_type,direction,quantity_eggs,source_type,source_id,created_by) values(f,u,production_date,'production','IN',good,'daily_production',r.id,auth.uid());
    end if;
  else
    select coalesce(sum((x->>'quantity_eggs')::integer),0) into total from jsonb_array_elements(grade_allocations)x;
    if total<>good then raise exception 'Grade allocations must equal good eggs' using errcode='23514'; end if;
    for a in select (x->>'egg_grade_id')::uuid grade_id,(x->>'quantity_eggs')::integer qty from jsonb_array_elements(grade_allocations)x loop
      if a.qty<=0 or not exists(select 1 from public.egg_grades g where g.id=a.grade_id and g.farm_id=f and g.is_active and not g.is_unsorted) then raise exception 'Invalid production grade allocation' using errcode='23514'; end if;
      insert into public.daily_production_grade_allocations(farm_id,production_record_id,egg_grade_id,quantity_eggs,created_by) values(f,r.id,a.grade_id,a.qty,auth.uid());
      insert into public.egg_inventory_movements(farm_id,egg_grade_id,movement_date,movement_type,direction,quantity_eggs,source_type,source_id,created_by) values(f,a.grade_id,production_date,'production','IN',a.qty,'daily_production',r.id,auth.uid());
    end loop;
  end if;
  return r;
end;$$;

create or replace function public.update_daily_production_graded(target_production_id uuid,eggs_collected integer,cracked_eggs integer,deaths integer,culls integer,feed_consumed_kg numeric,feed_type_id uuid,transport_cost numeric,other_cost numeric,notes text,grade_allocations jsonb default null) returns public.daily_production_records language plpgsql security definer set search_path='' as $$
declare r public.daily_production_records; f uuid; d date; flock uuid; good integer; total integer; u uuid; a record;
begin
  select farm_id,production_date,flock_id into f,d,flock from public.daily_production_records where id=target_production_id;
  if flock is null then raise exception 'Production record not found' using errcode='42501'; end if;
  perform public.assert_production_within_eligible_birds(flock,d,eggs_collected,target_production_id);
  r:=public.update_daily_production(target_production_id,eggs_collected,cracked_eggs,deaths,culls,feed_consumed_kg,feed_type_id,transport_cost,other_cost,notes);
  good:=eggs_collected-cracked_eggs;
  delete from public.egg_inventory_movements where source_type='daily_production' and source_id=target_production_id;
  delete from public.daily_production_grade_allocations where production_record_id=target_production_id;
  if grade_allocations is null or jsonb_array_length(grade_allocations)=0 then
    select id into u from public.egg_grades where farm_id=f and system_code='unsorted';
    if good>0 then
      insert into public.daily_production_grade_allocations(farm_id,production_record_id,egg_grade_id,quantity_eggs,created_by) values(f,r.id,u,good,auth.uid());
      insert into public.egg_inventory_movements(farm_id,egg_grade_id,movement_date,movement_type,direction,quantity_eggs,source_type,source_id,created_by) values(f,u,d,'production','IN',good,'daily_production',r.id,auth.uid());
    end if;
  else
    select coalesce(sum((x->>'quantity_eggs')::integer),0) into total from jsonb_array_elements(grade_allocations)x;
    if total<>good then raise exception 'Grade allocations must equal good eggs' using errcode='23514'; end if;
    for a in select (x->>'egg_grade_id')::uuid grade_id,(x->>'quantity_eggs')::integer qty from jsonb_array_elements(grade_allocations)x loop
      if a.qty<=0 or not exists(select 1 from public.egg_grades g where g.id=a.grade_id and g.farm_id=f and g.is_active and not g.is_unsorted) then raise exception 'Invalid production grade allocation' using errcode='23514'; end if;
      insert into public.daily_production_grade_allocations(farm_id,production_record_id,egg_grade_id,quantity_eggs,created_by) values(f,r.id,a.grade_id,a.qty,auth.uid());
      insert into public.egg_inventory_movements(farm_id,egg_grade_id,movement_date,movement_type,direction,quantity_eggs,source_type,source_id,created_by) values(f,a.grade_id,d,'production','IN',a.qty,'daily_production',r.id,auth.uid());
    end loop;
  end if;
  perform public.assert_nonnegative_egg_history(f); return r;
end;$$;

create or replace function public.get_daily_farm_summary(summary_date date,target_flock uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f uuid; member_role text; production jsonb; inventory jsonb; birds jsonb; feed jsonb; commercial jsonb;
begin
  select farm_id,role into f,member_role from public.farm_members where user_id=auth.uid() and active order by created_at limit 1;
  if f is null or summary_date is null or (target_flock is not null and not exists(select 1 from public.flocks where id=target_flock and farm_id=f)) then raise exception 'Daily summary access denied' using errcode='42501'; end if;
  select jsonb_build_object('eggs_collected',coalesce(sum(p.eggs_collected),0),'cracked_eggs',coalesce(sum(p.cracked_eggs),0),'saleable_eggs',coalesce(sum(p.eggs_collected-p.cracked_eggs),0),'eligible_birds',coalesce(sum(m.live_birds),0),'hen_day_percentage',case when coalesce(sum(m.live_birds),0)=0 then null else round(sum(p.eggs_collected)::numeric/sum(m.live_birds)*100,2) end,'grade_allocation',coalesce((select jsonb_agg(jsonb_build_object('code',g.system_code,'name',g.name,'eggs',x.eggs) order by g.sort_order) from public.egg_grades g left join (select a.egg_grade_id,sum(a.quantity_eggs) eggs from public.daily_production_grade_allocations a join public.daily_production_records p2 on p2.id=a.production_record_id where p2.farm_id=f and p2.production_date=summary_date and (target_flock is null or p2.flock_id=target_flock) group by a.egg_grade_id)x on x.egg_grade_id=g.id where g.farm_id=f),'[]'::jsonb)) into production from public.daily_production_records p join public.v_daily_production_metrics m on m.production_id=p.id where p.farm_id=f and p.production_date=summary_date and (target_flock is null or p.flock_id=target_flock);
  select jsonb_build_object('opening_eligible_birds',coalesce(sum(m.live_birds),0),'deaths',coalesce((select sum(quantity) from public.bird_movements where farm_id=f and movement_date=summary_date and movement_type='death' and (target_flock is null or flock_id=target_flock)),0),'culls',coalesce((select sum(quantity) from public.bird_movements where farm_id=f and movement_date=summary_date and movement_type='cull' and (target_flock is null or flock_id=target_flock)),0),'closing_birds',coalesce((select sum(initial_birds + coalesce((select sum(case when bm.direction='IN' then bm.quantity else -bm.quantity end) from public.bird_movements bm where bm.flock_id=fl.id and bm.movement_date<=summary_date),0)) from public.flocks fl where fl.farm_id=f and (target_flock is null or fl.id=target_flock)),0)) into birds from public.daily_production_records p join public.v_daily_production_metrics m on m.production_id=p.id where p.farm_id=f and p.production_date=summary_date and (target_flock is null or p.flock_id=target_flock);
  select coalesce(jsonb_agg(jsonb_build_object('code',g.system_code,'name',g.name,'eggs',coalesce(x.eggs,0),'crates',floor(coalesce(x.eggs,0)/fa.crate_size),'loose_eggs',mod(coalesce(x.eggs,0),fa.crate_size)) order by g.sort_order),'[]'::jsonb) into inventory from public.egg_grades g join public.farms fa on fa.id=g.farm_id left join lateral(select coalesce(sum(case when m.direction='IN' then m.quantity_eggs else -m.quantity_eggs end),0)::bigint eggs from public.egg_inventory_movements m where m.farm_id=f and m.egg_grade_id=g.id and m.movement_date<=summary_date)x on true where g.farm_id=f;
  select jsonb_build_object('consumed_kg',coalesce(sum(quantity_kg) filter(where movement_type='consumption'),0),'consumption_cost',coalesce(sum(total_cost_snapshot) filter(where movement_type='consumption'),0)) into feed from public.feed_inventory_movements where farm_id=f and movement_date=summary_date;
  if member_role in ('admin','manager') then select jsonb_build_object('sales_revenue',coalesce((select sum(total_amount) from public.sales where farm_id=f and status='completed' and sale_date=summary_date),0),'cash_collected',coalesce((select sum(amount) from public.customer_payments where farm_id=f and voided_at is null and payment_date=summary_date),0),'expenses_incurred',coalesce((select sum(amount) from public.expenses where farm_id=f and status='active' and expense_date=summary_date),0),'operating_cost',coalesce((select sum(total_cost_snapshot) from public.feed_inventory_movements where farm_id=f and movement_date=summary_date and movement_type in ('consumption','wastage')),0)+coalesce((select sum(amount) from public.expenses where farm_id=f and status='active' and expense_date=summary_date),0),'operating_result',coalesce((select sum(total_amount) from public.sales where farm_id=f and status='completed' and sale_date=summary_date),0)-coalesce((select sum(total_cost_snapshot) from public.feed_inventory_movements where farm_id=f and movement_date=summary_date and movement_type in ('consumption','wastage')),0)-coalesce((select sum(amount) from public.expenses where farm_id=f and status='active' and expense_date=summary_date),0)) into commercial; else commercial:='{}'::jsonb; end if;
  return jsonb_build_object('date',summary_date,'birds',birds,'production',production,'inventory',inventory,'feed',feed,'commercial',commercial,'financial_access',member_role in ('admin','manager'));
end;$$;

create or replace function public.get_weekly_farm_summary(anchor_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f uuid; role text; tz text; crate integer; ws integer; today date; start_date date; end_date date; elapsed_end date; prod jsonb; mix jsonb; stock jsonb; costs jsonb; commercial jsonb; prices jsonb;
begin
  select fm.farm_id,fm.role,fa.timezone,fa.crate_size,fs.reporting_week_start into f,role,tz,crate,ws from public.farm_members fm join public.farms fa on fa.id=fm.farm_id join public.farm_settings fs on fs.farm_id=fm.farm_id where fm.user_id=auth.uid() and fm.active order by fm.created_at limit 1;
  if f is null or anchor_date is null then raise exception 'Weekly summary access denied' using errcode='42501'; end if;
  start_date:=anchor_date-((extract(dow from anchor_date)::integer-ws+7)%7); end_date:=start_date+6; today:=(now() at time zone tz)::date; elapsed_end:=least(end_date,today);
  select jsonb_build_object('eggs_collected',coalesce(sum(p.eggs_collected),0),'saleable_eggs',coalesce(sum(p.eggs_collected-p.cracked_eggs),0),'cracked_eggs',coalesce(sum(p.cracked_eggs),0),'eligible_hen_days',coalesce(sum(m.live_birds),0),'hen_day_percentage',case when coalesce(sum(m.live_birds),0)=0 then null else round(sum(p.eggs_collected)::numeric/sum(m.live_birds)*100,2) end,'deaths',coalesce((select sum(quantity) from public.bird_movements where farm_id=f and movement_type='death' and movement_date between start_date and end_date),0),'culls',coalesce((select sum(quantity) from public.bird_movements where farm_id=f and movement_type='cull' and movement_date between start_date and end_date),0),'recorded_days',count(distinct p.production_date),'expected_elapsed_days',greatest(0,elapsed_end-start_date+1),'complete',count(distinct p.production_date)=greatest(0,elapsed_end-start_date+1)) into prod from public.daily_production_records p join public.v_daily_production_metrics m on m.production_id=p.id where p.farm_id=f and p.production_date between start_date and elapsed_end;
  select coalesce(jsonb_agg(jsonb_build_object('code',g.system_code,'name',g.name,'eggs',coalesce(x.eggs,0),'share_percentage',case when coalesce(total.total_eggs,0)=0 then 0 else round(coalesce(x.eggs,0)::numeric/total.total_eggs*100,2) end) order by g.sort_order),'[]'::jsonb) into mix from public.egg_grades g left join (select a.egg_grade_id,sum(a.quantity_eggs) eggs from public.daily_production_grade_allocations a join public.daily_production_records p on p.id=a.production_record_id where p.farm_id=f and p.production_date between start_date and end_date group by a.egg_grade_id)x on x.egg_grade_id=g.id cross join lateral(select coalesce(sum(a2.quantity_eggs),0) total_eggs from public.daily_production_grade_allocations a2 join public.daily_production_records p2 on p2.id=a2.production_record_id where p2.farm_id=f and p2.production_date between start_date and end_date)total where g.farm_id=f;
  select coalesce(jsonb_agg(jsonb_build_object('code',g.system_code,'name',g.name,'eggs',coalesce(x.eggs,0),'crates',floor(coalesce(x.eggs,0)/crate),'loose_eggs',mod(coalesce(x.eggs,0),crate)) order by g.sort_order),'[]'::jsonb) into stock from public.egg_grades g left join lateral(select coalesce(sum(case when m.direction='IN' then m.quantity_eggs else -m.quantity_eggs end),0)::bigint eggs from public.egg_inventory_movements m where m.farm_id=f and m.egg_grade_id=g.id and m.movement_date<=end_date)x on true where g.farm_id=f;
  if role in ('admin','manager') then
    select jsonb_build_object('feed_consumption_cost',coalesce(sum(total_cost_snapshot) filter(where movement_type='consumption'),0),'feed_wastage_cost',coalesce(sum(total_cost_snapshot) filter(where movement_type='wastage'),0),'feed_consumed_kg',coalesce(sum(quantity_kg) filter(where movement_type='consumption'),0),'feed_purchased',coalesce((select sum(total_cost) from public.feed_purchases where farm_id=f and status='completed' and purchase_date between start_date and end_date),0),'other_operating_expenses',coalesce((select sum(amount) from public.expenses where farm_id=f and status='active' and expense_date between start_date and end_date),0)) into costs from public.feed_inventory_movements where farm_id=f and movement_date between start_date and end_date;
    select jsonb_build_object('revenue',coalesce((select sum(total_amount) from public.sales where farm_id=f and status='completed' and sale_date between start_date and end_date),0),'cash_collected',coalesce((select sum(amount) from public.customer_payments where farm_id=f and voided_at is null and payment_date between start_date and end_date),0),'receivables_at_period_end',coalesce((select sum(s.total_amount-coalesce((select sum(cp.amount) from public.customer_payments cp where cp.sale_id=s.id and cp.voided_at is null and cp.payment_date<=end_date),0)) from public.sales s where s.farm_id=f and s.status='completed' and s.sale_date<=end_date),0)) into commercial;
    select coalesce(jsonb_agg(jsonb_build_object('code',g.system_code,'name',g.name,'crate_price',p.crate_price,'margin_per_crate',case when saleable.saleable=0 then null else p.crate_price-(op.cost/saleable.saleable*crate) end,'margin_percentage',case when p.crate_price is null or p.crate_price=0 or saleable.saleable=0 then null else round((p.crate_price-(op.cost/saleable.saleable*crate))/p.crate_price*100,2) end) order by g.sort_order),'[]'::jsonb) into prices from public.egg_grades g left join lateral(select x.crate_price from public.egg_grade_prices x where x.egg_grade_id=g.id and x.effective_from<=end_date order by x.effective_from desc,x.created_at desc limit 1)p on true cross join lateral(select coalesce(sum(p3.eggs_collected-p3.cracked_eggs),0)::numeric saleable from public.daily_production_records p3 where p3.farm_id=f and p3.production_date between start_date and end_date)saleable cross join lateral(select coalesce(sum(total_cost_snapshot) filter(where movement_type in ('consumption','wastage')),0)+coalesce((select sum(amount) from public.expenses where farm_id=f and status='active' and expense_date between start_date and end_date),0) cost from public.feed_inventory_movements where farm_id=f and movement_date between start_date and end_date)op where g.farm_id=f and not g.is_unsorted;
  else costs:='{}'::jsonb; commercial:='{}'::jsonb; prices:='[]'::jsonb; end if;
  return jsonb_build_object('week_start',start_date,'week_end',end_date,'elapsed_end',elapsed_end,'production',prod,'egg_mix',mix,'stock',stock,'costs',costs,'commercial',commercial,'prices',prices,'crate_size',crate,'financial_access',role in ('admin','manager'));
end;$$;

revoke all on function public.assert_production_within_eligible_birds(uuid,date,integer,uuid),public.get_daily_farm_summary(date,uuid),public.get_weekly_farm_summary(date) from public,anon;
grant execute on function public.get_daily_farm_summary(date,uuid),public.get_weekly_farm_summary(date) to authenticated;
