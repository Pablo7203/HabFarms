-- Phase 3 follow-up: do not conceal cost reconciliation failures, and keep
-- the batch lifecycle consistent with its authoritative post-transfer balance.

create or replace function public.get_rearing_transfer_preview(target_batch uuid,target_date date)
returns table(available_birds integer,source_cost numeric,already_transferred_cost numeric,remaining_cost numeric,cost_complete boolean)
language plpgsql stable security definer set search_path='' as $$
declare f uuid; arrival date; tz text; farm_today date; gross numeric; transferred numeric; available integer;
begin
  select b.farm_id,b.arrival_date,fa.timezone into f,arrival,tz
  from public.rearing_batches b join public.farms fa on fa.id=b.farm_id where b.id=target_batch;
  if f is null or not public.has_farm_role(f,array['admin','manager']) then
    raise exception 'Rearing transfer preview access denied' using errcode='42501';
  end if;
  farm_today:=(now() at time zone tz)::date;
  if target_date is null or target_date<arrival or target_date>farm_today then
    raise exception 'Choose a transfer date from arrival through today' using errcode='23514';
  end if;
  select coalesce(sum(case when m.direction='IN' then m.quantity else -m.quantity end),0)::integer
    into available from public.rearing_movements m
    where m.rearing_batch_id=target_batch and m.farm_id=f and m.movement_date<=target_date;
  gross:=public.rearing_cost_total_at(target_batch,target_date);
  select coalesce(sum(t.total_cost_transferred),0)::numeric into transferred
    from public.rearing_transfers t where t.source_batch_id=target_batch and t.farm_id=f
      and t.status='posted' and t.transfer_date<=target_date;
  if gross<transferred then
    raise exception 'Historical rearing cost is below the amount already transferred. Reconcile the batch before continuing.' using errcode='23514';
  end if;
  return query select available,gross,transferred,round(gross-transferred,2),
    not exists(select 1 from public.rearing_feed_consumptions c
      join public.feed_inventory_movements m on m.id=c.movement_id and m.farm_id=c.farm_id
      where c.rearing_batch_id=target_batch and c.farm_id=f and c.active
        and c.consumption_date<=target_date and m.total_cost_snapshot is null);
end; $$;

create or replace function public.get_rearing_cost_summary(target_batch uuid)
returns table(rearing_batch_id uuid,feed_consumed_kg numeric,feed_cost numeric,acquisition_cost numeric,health_cost numeric,
  other_direct_cost numeric,accumulated_rearing_cost numeric,cash_paid_against_linked_expenses numeric,
  outstanding_linked_expenses numeric,current_surviving_birds integer,cost_per_surviving_pullet numeric)
language plpgsql stable security definer set search_path='' as $$
declare f uuid; total_cost numeric; transferred numeric;
begin
  select rb.farm_id into f from public.rearing_batches rb where rb.id=target_batch;
  if f is null or not public.has_farm_role(f,array['admin','manager']) then
    raise exception 'Financial access denied' using errcode='42501';
  end if;
  return query with feed as(
    select coalesce(sum(c.quantity_kg),0)::numeric feed_kg,coalesce(sum(m.total_cost_snapshot),0)::numeric cost
    from public.rearing_feed_consumptions c join public.feed_inventory_movements m on m.id=c.movement_id and m.farm_id=c.farm_id
    where c.rearing_batch_id=target_batch and c.farm_id=f and c.active
  ), expenses_by_kind as(
    select coalesce(sum(e.amount) filter(where e.rearing_cost_kind='acquisition'),0)::numeric acquisition,
      coalesce(sum(e.amount) filter(where e.rearing_cost_kind='health'),0)::numeric health,
      coalesce(sum(e.amount) filter(where e.rearing_cost_kind='other_direct'),0)::numeric other_cost,
      coalesce(sum(p.paid),0)::numeric paid,
      coalesce(sum(e.amount-coalesce(p.paid,0)),0)::numeric outstanding
    from public.expenses e left join lateral(
      select sum(x.amount) paid from public.expense_payments x where x.expense_id=e.id and x.voided_at is null
    ) p on true where e.rearing_batch_id=target_batch and e.farm_id=f and e.status='active'
  ), population as(
    select current_birds from public.v_rearing_population where batch_id=target_batch
  ), transfers as(
    select coalesce(sum(t.total_cost_transferred),0)::numeric transferred
    from public.rearing_transfers t where t.source_batch_id=target_batch and t.farm_id=f and t.status='posted'
  ), totals as(
    select feed.*,expenses_by_kind.*,population.current_birds,transfers.transferred,
      feed.cost+expenses_by_kind.acquisition+expenses_by_kind.health+expenses_by_kind.other_cost total
    from feed cross join expenses_by_kind cross join population cross join transfers
  )
  select target_batch,totals.feed_kg,totals.cost,totals.acquisition,totals.health,totals.other_cost,totals.total,
    totals.paid,totals.outstanding,totals.current_birds,
    case when totals.current_birds>0 then round((totals.total-totals.transferred)/totals.current_birds,2) else null end
  from totals;
  select public.rearing_cost_total_at(target_batch,(now() at time zone (select timezone from public.farms where id=f))::date)
    into total_cost;
  select coalesce(sum(t.total_cost_transferred),0) into transferred from public.rearing_transfers t
    where t.source_batch_id=target_batch and t.farm_id=f and t.status='posted';
  if total_cost<transferred then
    raise exception 'Historical rearing cost is below transferred cost; cost summary requires reconciliation.' using errcode='23514';
  end if;
end; $$;

create or replace function public.reconcile_rearing_transfer_lifecycle()
returns trigger language plpgsql security definer set search_path='' as $$
declare live_birds integer; fully_transferred boolean;
begin
  if new.status not in('transferred','partially_transferred') then return new; end if;
  if not exists(select 1 from public.rearing_transfers t where t.source_batch_id=new.id and t.status='posted') then
    return new;
  end if;
  select coalesce(p.current_birds,0) into live_birds
    from public.v_rearing_population p where p.batch_id=new.id;
  select exists(select 1 from public.rearing_transfers t where t.source_batch_id=new.id
      and t.status='posted' and t.source_birds_after=0) into fully_transferred;
  if coalesce(live_birds,0)=0 then
    new.status:=case when fully_transferred then 'transferred' else 'closed' end;
  else
    new.status:='partially_transferred';
  end if;
  return new;
end; $$;
drop trigger if exists rearing_batch_transfer_lifecycle_consistency on public.rearing_batches;
create trigger rearing_batch_transfer_lifecycle_consistency
  before update of status on public.rearing_batches
  for each row execute function public.reconcile_rearing_transfer_lifecycle();

revoke all on function public.reconcile_rearing_transfer_lifecycle() from public,anon,authenticated;
