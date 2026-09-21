-- Private evidence files for cash/bank purchase receipts. The object path begins
-- with the owning farm id, allowing Storage RLS to enforce farm isolation.
create table public.purchase_receipts(
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  source_type text not null check(source_type in ('feed_purchase','raw_material_purchase')),
  source_id uuid not null,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check(mime_type like 'image/%'),
  byte_size bigint not null check(byte_size > 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_type,source_id)
);
alter table public.purchase_receipts enable row level security;
create policy purchase_receipts_read on public.purchase_receipts for select to authenticated using(public.has_farm_role(farm_id,array['admin','manager']));
create policy purchase_receipts_write on public.purchase_receipts for insert to authenticated with check(public.has_farm_role(farm_id,array['admin','manager']) and created_by=auth.uid());
create policy purchase_receipts_update on public.purchase_receipts for update to authenticated using(public.has_farm_role(farm_id,array['admin','manager'])) with check(public.has_farm_role(farm_id,array['admin','manager']));
grant select,insert,update on public.purchase_receipts to authenticated;

insert into storage.buckets(id,name,public,file_size_limit)
values('purchase-receipts','purchase-receipts',false,10485760)
on conflict(id) do update set public=false,file_size_limit=10485760;
create policy purchase_receipt_objects_read on storage.objects for select to authenticated using(bucket_id='purchase-receipts' and public.has_farm_role((storage.foldername(name))[1]::uuid,array['admin','manager']));
create policy purchase_receipt_objects_write on storage.objects for insert to authenticated with check(bucket_id='purchase-receipts' and public.has_farm_role((storage.foldername(name))[1]::uuid,array['admin','manager']));
create policy purchase_receipt_objects_update on storage.objects for update to authenticated using(bucket_id='purchase-receipts' and public.has_farm_role((storage.foldername(name))[1]::uuid,array['admin','manager']));
create policy purchase_receipt_objects_delete on storage.objects for delete to authenticated using(bucket_id='purchase-receipts' and public.has_farm_role((storage.foldername(name))[1]::uuid,array['admin','manager']));
