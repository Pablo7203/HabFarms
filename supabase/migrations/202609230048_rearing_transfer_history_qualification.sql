-- Qualify the farm lookup because the table-returning function also exposes an
-- output column named id; this avoids PL/pgSQL's ambiguous-column error.
create or replace function public.get_rearing_transfer_history(target_batch uuid)
returns table(id uuid,transfer_date date,quantity integer,destination_flock_id uuid,destination_flock_name text,
  status text,total_cost_transferred numeric,unit_cost_snapshot numeric,remaining_cost_after numeric,created_by uuid,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare f uuid; show_cost boolean;
begin
  select b.farm_id into f from public.rearing_batches b where b.id=target_batch;
  if f is null or not public.is_farm_member(f) then
    raise exception 'Rearing access denied' using errcode='42501';
  end if;
  show_cost:=public.has_farm_role(f,array['admin','manager']);
  return query select t.id,t.transfer_date,t.quantity,t.destination_flock_id,fl.flock_name,t.status,
    case when show_cost then t.total_cost_transferred else null end,
    case when show_cost then t.unit_cost_snapshot else null end,
    case when show_cost then t.remaining_cost_after else null end,t.created_by,t.created_at
  from public.rearing_transfers t
  join public.flocks fl on fl.id=t.destination_flock_id and fl.farm_id=t.farm_id
  where t.source_batch_id=target_batch and t.farm_id=f and t.status in('posted','reversed')
  order by t.transfer_date desc,t.created_at desc;
end; $$;
