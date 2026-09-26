-- Historical per-bird plan rows remain nullable in the new total-kg model.
-- New and transitioned current plans are written with a daily_feed_kg value.
alter table public.flock_feeding_plans
  alter column daily_feed_kg drop not null;
