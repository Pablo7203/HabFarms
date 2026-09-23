-- Keep non-ledger planning and reminder records from being attached to a
-- transferred/closed rearing batch. Lock the batch row so a concurrent full
-- transfer and one of these writes cannot pass the status check out of order.
create or replace function public.guard_closed_rearing_batch_operations()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  batch uuid;
  batch_status text;
begin
  batch:=coalesce(new.rearing_batch_id,old.rearing_batch_id);
  if batch is not null then
    select b.status into batch_status
    from public.rearing_batches b
    where b.id=batch
    for update;

    if batch_status in ('transferred','closed') then
      raise exception 'This rearing batch is closed to new operational records'
        using errcode='23514';
    end if;
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists rearing_feed_plan_no_closed_write on public.rearing_feed_plans;
create trigger rearing_feed_plan_no_closed_write
  before insert or update or delete on public.rearing_feed_plans
  for each row execute function public.guard_closed_rearing_batch_operations();

drop trigger if exists rearing_reminder_no_closed_write on public.health_reminders;
create trigger rearing_reminder_no_closed_write
  before insert or update or delete on public.health_reminders
  for each row execute function public.guard_closed_rearing_batch_operations();
