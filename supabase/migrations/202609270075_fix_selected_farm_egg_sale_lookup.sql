-- Qualify the farm column so it cannot collide with the post_egg_sale local.
do $$
declare
  signature regprocedure := 'public.post_egg_sale(uuid,date,integer,numeric,integer,numeric,numeric,numeric,text,text,integer)'::regprocedure;
  definition text;
  corrected text;
begin
  definition:=pg_get_functiondef(signature);
  corrected:=replace(definition,
    'select crate_size into crate_size from public.farms where id=f;',
    'select farm_row.crate_size into crate_size from public.farms as farm_row where farm_row.id=f;');
  if corrected=definition and position('select farm_row.crate_size into crate_size' in definition)=0 then
    raise exception 'Expected selected-farm crate-size lookup not found in %',signature;
  end if;
  if corrected<>definition then execute corrected; end if;
end;
$$;
