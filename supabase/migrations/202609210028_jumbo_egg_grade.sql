-- Add Jumbo as a standard grade without changing historical egg inventory or prices.
create or replace function public.provision_default_egg_grades(target_farm uuid,target_actor uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.egg_grades(farm_id,system_code,name,description,is_unsorted,sort_order,created_by)
  values
    (target_farm,'unsorted','Unsorted','Eggs awaiting grading',true,0,target_actor),
    (target_farm,'smaller','Smaller',null,false,10,target_actor),
    (target_farm,'small','Small',null,false,20,target_actor),
    (target_farm,'medium','Medium',null,false,30,target_actor),
    (target_farm,'large','Large',null,false,40,target_actor),
    (target_farm,'bigger','Bigger',null,false,50,target_actor),
    (target_farm,'jumbo','Jumbo','Largest premium egg grade',false,60,target_actor)
  on conflict(farm_id,system_code) do update set name=excluded.name,description=excluded.description,is_unsorted=excluded.is_unsorted,sort_order=excluded.sort_order;
end;$$;

insert into public.egg_grades(farm_id,system_code,name,description,is_unsorted,sort_order,created_by)
select f.id,'jumbo','Jumbo','Largest premium egg grade',false,60,m.user_id
from public.farms f
join lateral (select user_id from public.farm_members where farm_id=f.id and role='admin' and active order by created_at limit 1) m on true
on conflict(farm_id,system_code) do update set name=excluded.name,description=excluded.description,is_unsorted=excluded.is_unsorted,sort_order=excluded.sort_order;
