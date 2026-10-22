-- SELECT of a composite alias can be expanded as a single composite value.
-- Assign its columns explicitly so the first uuid field is not cast from the
-- full row text during the locked batch lookup.
create or replace function public.record_rearing_weight_sample(
  target_batch uuid,
  target_date date,
  target_sample_size integer,
  target_average_weight_kg numeric,
  target_uniformity_percentage numeric,
  target_notes text default null
) returns public.rearing_weight_samples
language plpgsql
security definer
set search_path=''
as $$
declare
  b public.rearing_batches;
  farm_today date;
  created public.rearing_weight_samples;
  available integer;
begin
  select rb.* into b
  from public.rearing_batches rb
  where rb.id=target_batch
  for update;

  if b.id is not null then
    select (now() at time zone f.timezone)::date into farm_today
    from public.farms f where f.id=b.farm_id;
  end if;

  if b.id is null or not public.has_farm_role(b.farm_id,array['admin','manager','worker']) then
    raise exception 'Rearing weight sample access denied' using errcode='42501';
  end if;

  if target_date is null or target_date<b.arrival_date or target_date>farm_today
    or target_sample_size is null or target_sample_size<=0
    or target_average_weight_kg is null or target_average_weight_kg<=0 or target_average_weight_kg>50
    or target_uniformity_percentage is not null and target_uniformity_percentage not between 0 and 100
    or char_length(coalesce(target_notes,''))>2000 then
    raise exception 'Check the sample date, sample size, average weight, and uniformity' using errcode='23514';
  end if;

  available:=public.rearing_balance_at(b.id,target_date);
  if target_sample_size>available then
    raise exception 'Sample size exceeds birds available on that date' using errcode='23514';
  end if;

  insert into public.rearing_weight_samples(
    farm_id,rearing_batch_id,sample_date,sample_size,average_weight_kg,uniformity_percentage,notes,created_by
  ) values (
    b.farm_id,b.id,target_date,target_sample_size,target_average_weight_kg,
    target_uniformity_percentage,nullif(trim(target_notes),''),auth.uid()
  ) returning * into created;

  insert into public.audit_logs(farm_id,actor_user_id,action,entity_type,entity_id,summary,metadata)
  values (
    b.farm_id,auth.uid(),'rearing_weight_sample.created','rearing_weight_samples',created.id,
    'Rearing weight sample recorded',
    jsonb_build_object(
      'batch_code',b.batch_code,'sample_date',target_date,'sample_size',target_sample_size,
      'average_weight_kg',target_average_weight_kg,'uniformity_percentage',target_uniformity_percentage
    )
  );

  return created;
end;
$$;

notify pgrst,'reload schema';
