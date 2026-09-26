-- Expand layer-flock feed plans with an explicit total daily quantity.
-- Existing rows are backfilled separately in the next migration.
alter table public.flock_feeding_plans
  add column daily_feed_kg numeric(14,3);
