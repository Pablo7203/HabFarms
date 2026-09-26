-- Preserve old per-bird plans for historical dates. For each active flock,
-- create a total-kg plan effective from that farm's local current date. The
-- new target starts equal to the old target at today's bird population.
do $$
declare
  plan_row record;
begin
  update public.flock_feeding_plans p
  set daily_feed_kg=null
  from public.farms fa
  where fa.id=p.farm_id
    and p.effective_from<(now() at time zone fa.timezone)::date;

  for plan_row in
    select distinct on (p.flock_id)
      p.id,p.farm_id,p.flock_id,p.feed_type_id,p.grams_per_bird_per_day,
      p.effective_from,p.effective_to,p.notes,p.created_by,
      (now() at time zone fa.timezone)::date farm_today,
      s.current_live_birds
    from public.flock_feeding_plans p
    join public.farms fa on fa.id=p.farm_id
    join public.v_current_flock_status s on s.farm_id=p.farm_id and s.flock_id=p.flock_id
      and s.status='active' and s.current_live_birds>0
    where p.effective_from<=(now() at time zone fa.timezone)::date
      and (p.effective_to is null or p.effective_to>=(now() at time zone fa.timezone)::date)
    order by p.flock_id,p.effective_from desc
  loop
    if plan_row.effective_from=plan_row.farm_today then
      update public.flock_feeding_plans
      set daily_feed_kg=round(plan_row.current_live_birds*plan_row.grams_per_bird_per_day/1000,3),
          updated_at=now()
      where id=plan_row.id;
    else
      update public.flock_feeding_plans
      set effective_to=plan_row.farm_today-1,daily_feed_kg=null,updated_at=now()
      where id=plan_row.id;

      insert into public.flock_feeding_plans(
        farm_id,flock_id,feed_type_id,grams_per_bird_per_day,daily_feed_kg,
        effective_from,effective_to,notes,created_by
      ) values(
        plan_row.farm_id,plan_row.flock_id,plan_row.feed_type_id,plan_row.grams_per_bird_per_day,
        round(plan_row.current_live_birds*plan_row.grams_per_bird_per_day/1000,3),
        plan_row.farm_today,plan_row.effective_to,plan_row.notes,plan_row.created_by
      );
    end if;
  end loop;
end; $$;
