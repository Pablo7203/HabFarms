begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

select extensions.ok(
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='rearing_batches' and column_name='bird_purpose'),
  'rearing batches store bird purpose'
);
select extensions.ok(
  exists(select 1 from pg_constraint where conrelid='public.rearing_batches'::regclass
    and conname='rearing_batches_stage_check' and position('broiler' in lower(pg_get_constraintdef(oid)))>0),
  'rearing stage constraint supports purpose lifecycle stages'
);
select extensions.ok(
  has_table_privilege('authenticated','public.rearing_weight_samples','SELECT')
    and (select relrowsecurity from pg_class where oid='public.rearing_weight_samples'::regclass),
  'growth samples have RLS and authenticated read access'
);
select extensions.ok(
  has_table_privilege('authenticated','public.rearing_broiler_dispatches','SELECT')
    and (select relrowsecurity from pg_class where oid='public.rearing_broiler_dispatches'::regclass),
  'broiler dispatches have RLS and authenticated read access'
);
select extensions.ok(
  to_regprocedure('public.create_rearing_batch_for_purpose(uuid,text,text,uuid,date,date,integer,text,text)') is not null,
  'purpose-aware batch creation RPC exists'
);
select extensions.ok(
  to_regprocedure('public.record_rearing_weight_sample(uuid,date,integer,numeric,numeric,text)') is not null,
  'growth sample RPC exists'
);
select extensions.ok(
  position('select rb.* into b' in lower(pg_get_functiondef('public.record_rearing_weight_sample(uuid,date,integer,numeric,numeric,text)'::regprocedure)))>0,
  'growth sample RPC assigns the batch row to its composite variable by columns'
);
select extensions.ok(
  to_regprocedure('public.post_rearing_broiler_dispatch(uuid,date,integer,text,numeric,text)') is not null
    and to_regprocedure('public.reverse_rearing_broiler_dispatch(uuid,text)') is not null,
  'broiler dispatch and audited reversal RPCs exist'
);
select extensions.ok(
  not has_function_privilege('anon','public.reverse_rearing_broiler_dispatch(uuid,text)','EXECUTE'),
  'anonymous callers cannot reverse dispatches'
);
select extensions.ok(
  exists(select 1 from pg_trigger where tgname='rearing_transfer_layer_pullet_only' and tgenabled<>'D'),
  'broiler lots cannot enter layer transfer records'
);
select extensions.ok(
  position('broiler_dispatch' in lower(pg_get_functiondef('public.get_rearing_reconciliation(uuid)'::regprocedure)))>0,
  'population reconciliation includes broiler dispatch movements'
);
select extensions.ok(
  (select position('bird_purpose' in lower(pg_get_viewdef('public.v_rearing_population'::regclass,true)))>0
    and position('feeding_stage' in lower(pg_get_viewdef('public.v_rearing_population'::regclass,true)))>0),
  'population view exposes bird purpose and feed stage'
);
select extensions.ok(
  has_function_privilege('authenticated','public.get_rearing_reconciliation(uuid)','EXECUTE'),
  'authenticated members retain guarded reconciliation access'
);
select extensions.ok(
  position('purchase date cannot be in the future' in lower(pg_get_functiondef('public.update_feed_purchase(uuid,uuid,date,numeric,numeric,numeric,text)'::regprocedure)))>0,
  'feed purchase edit rejects future effective dates'
);

select * from extensions.finish();
rollback;
