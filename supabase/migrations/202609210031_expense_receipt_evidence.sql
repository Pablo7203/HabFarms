alter table public.purchase_receipts drop constraint purchase_receipts_source_type_check;
alter table public.purchase_receipts add constraint purchase_receipts_source_type_check check(source_type in ('feed_purchase','raw_material_purchase','expense'));
