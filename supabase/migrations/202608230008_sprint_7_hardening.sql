-- Sprint 7: append-only audit history, hardening indexes, and privilege verification support.
-- Sprint 6 attached the shared updated-at trigger to cash adjustments without a target column.
alter table public.cash_adjustments add column updated_at timestamptz not null default now();

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid references public.farms(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  event_time timestamptz not null default now(),
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

create index audit_logs_farm_event_idx on public.audit_logs(farm_id,event_time desc,id desc);
create index audit_logs_farm_actor_idx on public.audit_logs(farm_id,actor_user_id,event_time desc);
create index audit_logs_farm_action_idx on public.audit_logs(farm_id,action,event_time desc);
create index audit_logs_farm_entity_idx on public.audit_logs(farm_id,entity_type,entity_id,event_time desc);
create index production_farm_date_page_idx on public.daily_production_records(farm_id,production_date desc,id desc);
create index sales_farm_date_page_idx on public.sales(farm_id,sale_date desc,id desc);
create index customers_farm_name_page_idx on public.customers(farm_id,name,id);
create index feed_purchases_farm_date_page_idx on public.feed_purchases(farm_id,purchase_date desc,id desc);
create index cash_adjustments_farm_date_page_idx on public.cash_adjustments(farm_id,adjustment_date desc,id desc);

alter table public.audit_logs enable row level security;
create policy audit_logs_admin_read on public.audit_logs for select to authenticated
using(public.has_farm_role(farm_id,array['admin']));

revoke all on table public.audit_logs from public,anon,authenticated;
grant select on table public.audit_logs to authenticated;
grant all on table public.audit_logs to service_role;

create function public.write_business_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  current_row jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  previous_row jsonb:=case when tg_op='INSERT' then null else to_jsonb(old) end;
  farm uuid;
  entity uuid;
  event_action text;
  event_summary text;
  safe_metadata jsonb;
begin
  farm:=nullif(current_row->>'farm_id','')::uuid;
  if farm is null and tg_table_name='farm_settings' then farm:=nullif(current_row->>'farm_id','')::uuid; end if;
  if farm is null and tg_table_name='farms' then farm:=nullif(current_row->>'id','')::uuid; end if;
  entity:=nullif(coalesce(current_row->>'id',current_row->>'farm_id'),'')::uuid;
  event_action:=case
    when tg_op='INSERT' then tg_table_name||'.created'
    when (current_row->>'status'='voided' and coalesce(previous_row->>'status','')<>'voided') or (current_row->>'voided_at' is not null and previous_row->>'voided_at' is null) then tg_table_name||'.voided'
    when tg_table_name='farm_members' and current_row->>'role' is distinct from previous_row->>'role' then 'farm_members.role_updated'
    when tg_table_name='farm_members' and current_row->>'active' is distinct from previous_row->>'active' then 'farm_members.access_updated'
    when tg_op='DELETE' then tg_table_name||'.deleted'
    else tg_table_name||'.updated' end;
  event_summary:=replace(initcap(replace(event_action,'_',' ')),'.',' ');
  safe_metadata:=jsonb_strip_nulls(jsonb_build_object(
    'number',coalesce(current_row->>'sale_number',current_row->>'purchase_number',current_row->>'expense_number'),
    'name',coalesce(current_row->>'flock_name',current_row->>'name',current_row->>'product_name'),
    'amount',coalesce(current_row->>'total_amount',current_row->>'total_cost',current_row->>'amount',current_row->>'cost'),
    'previous_amount',coalesce(previous_row->>'total_amount',previous_row->>'total_cost',previous_row->>'amount',previous_row->>'cost'),
    'status',current_row->>'status','previous_status',previous_row->>'status',
    'role',current_row->>'role','previous_role',previous_row->>'role'));
  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
  values(farm,auth.uid(),event_action,tg_table_name,entity,event_summary,safe_metadata);
  return case when tg_op='DELETE' then old else new end;
end;$$;

do $$declare table_name text;begin
  foreach table_name in array array['farms','farm_settings','farm_members','flocks','bird_movements','daily_production_records','customers','sales','customer_payments','feed_types','suppliers','feed_purchases','feed_purchase_payments','feed_inventory_movements','expenses','expense_payments','health_records','cash_adjustments']
  loop execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.write_business_audit()',table_name,table_name); end loop;
end$$;

revoke all on function public.write_business_audit() from public,anon,authenticated;

create function public.health_check() returns integer language sql stable security invoker set search_path='' as $$select 1$$;
revoke all on function public.health_check() from public;
grant execute on function public.health_check() to anon,authenticated;
