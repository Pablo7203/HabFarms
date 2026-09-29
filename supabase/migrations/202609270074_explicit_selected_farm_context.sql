-- Bind legacy farm-resolving RPCs to the user's explicitly selected app farm.
-- The request header is untrusted input; every resolution is independently
-- checked against the authenticated user's active role and farm access.
create or replace function public.resolve_selected_farm(required_roles text[])
returns uuid
language plpgsql stable security definer set search_path=''
as $$
declare
  request_headers jsonb;
  selected_farm uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  begin
    request_headers := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
    selected_farm := nullif(request_headers->>'x-habfarms-active-farm','')::uuid;
  exception when invalid_text_representation then
    raise exception 'Invalid selected farm' using errcode='22023';
  end;
  if selected_farm is null then
    raise exception 'Explicit farm selection is required; select an active farm and retry' using errcode='22023';
  end if;
  if not public.has_farm_role(selected_farm,required_roles) then
    raise exception 'Selected farm access denied' using errcode='42501';
  end if;
  return selected_farm;
end;
$$;
revoke all on function public.resolve_selected_farm(text[]) from public,anon,authenticated;
grant execute on function public.resolve_selected_farm(text[]) to authenticated;

create or replace function public.feed_access_farm(required_roles text[])
returns uuid language sql stable security definer set search_path=''
as $$ select public.resolve_selected_farm(required_roles); $$;
create or replace function public.expense_access_farm(required_roles text[])
returns uuid language sql stable security definer set search_path=''
as $$ select public.resolve_selected_farm(required_roles); $$;
create or replace function public.reporting_farm(financial boolean default true)
returns uuid language sql stable security definer set search_path=''
as $$ select public.resolve_selected_farm(case when financial then array['admin','manager']::text[] else array['admin','manager','worker']::text[] end); $$;

-- Preserve each existing transaction/report body while replacing only its
-- implicit earliest-membership lookup. The migration aborts if any expected
-- source fragment is absent, preventing a silent partial rewrite on drift.
do $$
declare
  item record;
  original_definition text;
  updated_definition text;
begin
  for item in
    select * from (values
      ('public.create_customer(text,text,text,text,text,text,integer)'::regprocedure,
       'select farm_id into f from public.farm_members where user_id=auth.uid()and active and role in(''admin'',''manager'')order by created_at limit 1;',
       'f:=public.resolve_selected_farm(array[''admin'',''manager'']);'),
      ('public.post_egg_sale(uuid,date,integer,numeric,integer,numeric,numeric,numeric,text,text,integer)'::regprocedure,
       'select fm.farm_id,fa.crate_size into f,crate_size from public.farm_members fm join public.farms fa on fa.id=fm.farm_id where fm.user_id=auth.uid()and fm.active and fm.role in(''admin'',''manager'')order by fm.created_at limit 1;',
       'f:=public.resolve_selected_farm(array[''admin'',''manager'']);select crate_size into crate_size from public.farms where id=f;'),
      ('public.post_bird_sale(uuid,uuid,date,text,integer,numeric,numeric,text,integer,text)'::regprocedure,
       'select farm_id into f from public.farm_members where user_id=auth.uid() and active and role in (''admin'',''manager'') order by created_at limit 1;',
       'f:=public.resolve_selected_farm(array[''admin'',''manager'']);'),
      ('public.create_farm_invitation(text,text)'::regprocedure,
       'select farm_id into f from public.farm_members where user_id=auth.uid() and active and role=''admin'' order by created_at limit 1;',
       'f:=public.resolve_selected_farm(array[''admin'']);'),
      ('public.post_egg_grading(date,integer,jsonb,text)'::regprocedure,
       'select farm_id into f from public.farm_members where user_id=auth.uid()and active order by created_at limit 1;',
       'f:=public.resolve_selected_farm(array[''admin'',''manager'']);'),
      ('public.get_daily_farm_summary(date,uuid)'::regprocedure,
       'select farm_id,role into f,member_role from public.farm_members where user_id=auth.uid() and active order by created_at limit 1;',
       'f:=public.resolve_selected_farm(array[''admin'',''manager'',''worker'']);select role into member_role from public.farm_members where farm_id=f and user_id=auth.uid() and active;'),
      ('public.get_weekly_farm_summary(date)'::regprocedure,
       'select fm.farm_id,fm.role,fa.timezone,fa.crate_size,fs.reporting_week_start into f,role,tz,crate,ws from public.farm_members fm join public.farms fa on fa.id=fm.farm_id join public.farm_settings fs on fs.farm_id=fm.farm_id where fm.user_id=auth.uid() and fm.active order by fm.created_at limit 1;',
       'f:=public.resolve_selected_farm(array[''admin'',''manager'',''worker'']);select fm.role,fa.timezone,fa.crate_size,fs.reporting_week_start into role,tz,crate,ws from public.farm_members fm join public.farms fa on fa.id=fm.farm_id join public.farm_settings fs on fs.farm_id=fm.farm_id where fm.user_id=auth.uid() and fm.active and fm.farm_id=f;'),
      ('public.assert_flock_plan_scope(uuid,uuid)'::regprocedure,
       'select farm_id into f from public.farm_members where user_id=auth.uid() and active order by created_at limit 1;',
       'f:=public.resolve_selected_farm(array[''admin'',''manager'']);'),
      ('public.create_health_reminder(uuid,text,text,date,text)'::regprocedure,
       'select farm_id into f from public.farm_members where user_id=auth.uid() and active order by created_at limit 1;',
       'f:=public.resolve_selected_farm(array[''admin'',''manager'']);'),
      ('public.get_feed_plan_summary(date,date,uuid)'::regprocedure,
       'select farm_id into f from public.farm_members where user_id=auth.uid() and active order by created_at limit 1;',
       'f:=public.resolve_selected_farm(array[''admin'',''manager'',''worker'']);'),
      ('public.get_hen_day_target_summary(date,date,uuid)'::regprocedure,
       'select farm_id into f from public.farm_members where user_id=auth.uid() and active order by created_at limit 1;',
       'f:=public.resolve_selected_farm(array[''admin'',''manager'',''worker'']);')
    ) as expected(signature,old_selector,new_selector)
  loop
    original_definition:=pg_get_functiondef(item.signature);
    if position(item.old_selector in original_definition)=0 then
      raise exception 'Expected farm selector not found in %',item.signature;
    end if;
    updated_definition:=replace(original_definition,item.old_selector,item.new_selector);
    if updated_definition=original_definition then
      raise exception 'Farm selector rewrite did not change %',item.signature;
    end if;
    execute updated_definition;
  end loop;
end;
$$;

create or replace function public.get_collection_dashboard()
returns table(overdue_total numeric,overdue_count bigint,due_today_total numeric,due_today_count bigint,upcoming_7_days_total numeric,upcoming_7_days_count bigint,total_outstanding numeric)
language sql stable security invoker set search_path=''
as $$
  select coalesce(sum(outstanding_balance)filter(where collection_status='overdue'),0),
    count(*)filter(where collection_status='overdue'),
    coalesce(sum(outstanding_balance)filter(where collection_status='due_today'),0),
    count(*)filter(where collection_status='due_today'),
    coalesce(sum(outstanding_balance)filter(where collection_status='upcoming'and days_until_due<=7),0),
    count(*)filter(where collection_status='upcoming'and days_until_due<=7),
    coalesce(sum(outstanding_balance)filter(where outstanding_balance>0),0)
  from public.v_credit_collections
  where farm_id=public.resolve_selected_farm(array['admin','manager']);
$$;
