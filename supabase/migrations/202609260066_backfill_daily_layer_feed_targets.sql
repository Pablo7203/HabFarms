-- Preserve each existing plan's prior target on its start date. After the
-- conversion, the target remains a fixed kg/day amount until another plan
-- takes effect, so population changes require an explicit plan adjustment.
update public.flock_feeding_plans p
set daily_feed_kg=round(
  (
    fl.initial_birds+coalesce((
      select sum(case when bm.direction='IN' then bm.quantity else -bm.quantity end)
      from public.bird_movements bm
      where bm.flock_id=fl.id
        and bm.movement_date<=greatest(p.effective_from,fl.start_date)
    ),0)
  )*p.grams_per_bird_per_day/1000,
  3
)
from public.flocks fl
where fl.id=p.flock_id and p.daily_feed_kg is null;
