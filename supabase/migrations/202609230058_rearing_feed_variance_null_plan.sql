-- Preserve the distinction between an absent feed target and a zero target.
-- Actual consumption remains visible when no matching plan exists, but a
-- variance is only meaningful when an effective target was configured.
create or replace function public.get_rearing_feed_plan_variance(target_batch uuid,target_from date,target_to date)
returns table(report_date date,feed_type_id uuid,feed_name text,planned_kg numeric,actual_kg numeric,variance_kg numeric)
language plpgsql stable security definer set search_path='' as $$
declare f uuid;
begin
  select farm_id into f from public.rearing_batches where id=target_batch;
  if f is null or target_from>target_to or target_to-target_from>366 or not public.is_farm_member(f) then
    raise exception 'Invalid rearing feed report request' using errcode='42501';
  end if;
  return query
  with dates as (
    select generate_series(target_from,target_to,interval '1 day')::date d
  ), pop as (
    select d.d,coalesce((
      select sum(case when m.direction='IN' then m.quantity else -m.quantity end)::integer
      from public.rearing_movements m
      where m.rearing_batch_id=target_batch and m.farm_id=f and m.movement_date<=d.d
    ),0) birds
    from dates d
  ), planned as (
    select p.d,pn.feed_type_id,ft.name,
      round(p.birds*pn.grams_per_bird_per_day/1000,3) qty
    from pop p
    join public.rearing_feed_plans pn on pn.rearing_batch_id=target_batch and pn.farm_id=f
      and pn.effective_from<=p.d and (pn.effective_to is null or pn.effective_to>=p.d)
    join public.feed_types ft on ft.id=pn.feed_type_id
  ), actual as (
    select c.consumption_date d,c.feed_type_id,ft.name,sum(c.quantity_kg)::numeric qty
    from public.rearing_feed_consumptions c
    join public.feed_types ft on ft.id=c.feed_type_id
    where c.farm_id=f and c.rearing_batch_id=target_batch and c.active
      and c.consumption_date between target_from and target_to
    group by c.consumption_date,c.feed_type_id,ft.name
  ), joined as (
    select coalesce(p.d,a.d) d,coalesce(p.feed_type_id,a.feed_type_id) id,
      coalesce(p.name,a.name) name,p.qty::numeric planned,coalesce(a.qty,0)::numeric actual
    from planned p full join actual a on a.d=p.d and a.feed_type_id=p.feed_type_id
  )
  select j.d,j.id,j.name,j.planned,j.actual,
    case when j.planned is null then null else j.actual-j.planned end
  from joined j order by j.d,j.name;
end; $$;

revoke all on function public.get_rearing_feed_plan_variance(uuid,date,date) from public,anon;
grant execute on function public.get_rearing_feed_plan_variance(uuid,date,date) to authenticated;

comment on function public.get_rearing_feed_plan_variance(uuid,date,date) is
  'Returns null planned quantity and variance when no effective batch feed target exists; actual ledger consumption remains visible.';
