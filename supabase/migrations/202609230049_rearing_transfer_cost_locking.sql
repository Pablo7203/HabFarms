-- Serialize linked cost writes against point-of-lay transfers. Transfer posting
-- locks the batch first; cost writes now take the same lock before checking the
-- immutable historical-transfer cutoff.
create or replace function public.guard_rearing_cost_against_posted_transfer()
returns trigger language plpgsql security definer set search_path='' as $$
declare batch_id uuid; effective_date date; old_batch uuid; old_date date;
begin
  if tg_table_name='expenses' then
    batch_id:=coalesce(new.rearing_batch_id,old.rearing_batch_id);
    effective_date:=coalesce(new.expense_date,old.expense_date);
    old_batch:=old.rearing_batch_id; old_date:=old.expense_date;
    if tg_op='UPDATE' and new.rearing_batch_id is not distinct from old_batch and new.expense_date is not distinct from old_date
      and new.amount is not distinct from old.amount and new.status is not distinct from old.status
      and new.rearing_cost_kind is not distinct from old.rearing_cost_kind then return new; end if;
  else
    batch_id:=coalesce(new.rearing_batch_id,old.rearing_batch_id);
    effective_date:=coalesce(new.consumption_date,old.consumption_date);
    old_batch:=old.rearing_batch_id; old_date:=old.consumption_date;
    if tg_op='UPDATE' and new.rearing_batch_id is not distinct from old_batch and new.consumption_date is not distinct from old_date
      and new.active is not distinct from old.active and new.quantity_kg is not distinct from old.quantity_kg then return new; end if;
  end if;
  if batch_id is not null then
    perform 1 from public.rearing_batches b where b.id=batch_id for update;
    if exists(select 1 from public.rearing_transfers t where t.source_batch_id=batch_id
      and t.status='posted' and t.transfer_date>=effective_date) then
      raise exception 'This cost date is on/before a posted pullet transfer. Use the audited transfer correction workflow instead of changing its cost basis.' using errcode='23514';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;

create or replace function public.guard_rearing_cost_insert_date()
returns trigger language plpgsql security definer set search_path='' as $$
declare batch_id uuid; effective_date date;
begin
  if tg_table_name='expenses' then batch_id:=new.rearing_batch_id; effective_date:=new.expense_date;
  else batch_id:=new.rearing_batch_id; effective_date:=new.consumption_date; end if;
  if batch_id is not null then
    perform 1 from public.rearing_batches b where b.id=batch_id for update;
    if exists(select 1 from public.rearing_transfers t where t.source_batch_id=batch_id
      and t.status='posted' and t.transfer_date>=effective_date) then
      raise exception 'This cost date is on/before a posted pullet transfer. Record new costs on their actual effective date; old transfer snapshots cannot be rewritten.' using errcode='23514';
    end if;
  end if;
  return new;
end; $$;
