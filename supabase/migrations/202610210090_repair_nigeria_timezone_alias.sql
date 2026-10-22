-- Repair the invalid timezone value that can crash farm-local date formatting.
-- Africa/Lagos is the IANA timezone for Nigeria.
update public.farms
set timezone = 'Africa/Lagos'
where lower(trim(timezone)) = 'africa/nigeria';
