-- The feed forecast is an invoker-security view that references this view.
-- Give the privileged service role the explicit underlying view permission
-- required to query that forecast through PostgREST and verification jobs.
grant select on public.v_rearing_population to service_role;
