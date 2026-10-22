begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(3);

select extensions.ok(
  exists(select 1 from pg_trigger where tgname='sales_normalize_due_date' and tgenabled<>'D'),
  'sale due dates are normalized when a sale is inserted or edited'
);
select extensions.ok(
  exists(select 1 from pg_trigger where tgname='customer_payments_sync_sale_due_date' and tgenabled<>'D'),
  'payment changes synchronize the linked sale due date'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.normalize_sale_due_date()','EXECUTE')
    and not has_function_privilege('authenticated','public.sync_sale_due_date_after_payment_change()','EXECUTE'),
  'due-date trigger helpers are not callable by authenticated clients'
);

select * from extensions.finish();
rollback;
