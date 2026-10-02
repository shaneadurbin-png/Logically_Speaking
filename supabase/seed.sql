-- seed.sql - a workspace to start from. Put YOUR sign-in email in the
-- members row before `supabase db reset`; the page claims it after the
-- first OTP sign-in. Everything here can be changed in Settings.
insert into public.workspaces (id, name) values ('00000000-0000-4000-8000-000000000001', 'Liberty Builds');
insert into public.members (workspace_id, email, role, display_name) values
  ('00000000-0000-4000-8000-000000000001', 'owner@example.com', 'owner', 'Owner');

-- a few jobs to start with; every other job turns up in the first HH2 export and is added from Settings in one click
insert into public.jobs (workspace_id, job_number, short_name, name, campus, region, rate_table_code, tax_bp, markup_bp) values
  ('00000000-0000-4000-8000-000000000001', '50-60-225121', 'DC4', 'CDR1 East DC4', 'CDR E1', 'Cedar Rapids, IA', '#225121', 700, 1000),
  ('00000000-0000-4000-8000-000000000001', '50-60-225120', 'DC5', 'CDR1 East DC5', 'CDR E1', 'Cedar Rapids, IA', '#225120', 700, 1000),
  ('00000000-0000-4000-8000-000000000001', '50-60-226021', 'DC7', 'CDR1 East DC7', 'CDR E1', 'Cedar Rapids, IA', '#226021', 700, 1000),
  ('00000000-0000-4000-8000-000000000001', '50-60-225104', 'Site', 'CDR1 East TM (Campus)', 'CDR E1', 'Cedar Rapids, IA', '#225104', 700, 1000);

insert into public.vendors (workspace_id, vendor_key, name, feed, taxable, liberty_owned) values
  ('00000000-0000-4000-8000-000000000001', 'united_rentals', 'United Rentals', 'onrent', true, false),
  ('00000000-0000-4000-8000-000000000001', 'sunbelt', 'Sunbelt Rentals', 'onrent', true, false),
  ('00000000-0000-4000-8000-000000000001', 'herc', 'Herc Rentals', 'onrent', true, false),
  ('00000000-0000-4000-8000-000000000001', 'equipmentshare', 'EquipmentShare', 'onrent', true, false),
  ('00000000-0000-4000-8000-000000000001', 'mcw', 'Mission Critical Warehouse', 'onrent', false, true);

-- the vendors' names for the CDR jobs, from the 2026-10-01 exports
insert into public.vendor_job_map (workspace_id, vendor_key, vendor_job_ref, job_number) values
  ('00000000-0000-4000-8000-000000000001', 'united_rentals', 'CDR-SCCI-DC4', '50-60-225121'),
  ('00000000-0000-4000-8000-000000000001', 'united_rentals', 'CDR-SCCI-DC5', '50-60-225120'),
  ('00000000-0000-4000-8000-000000000001', 'united_rentals', 'CDR-SCCI-DC7', '50-60-226021'),
  ('00000000-0000-4000-8000-000000000001', 'united_rentals', 'CDR-SCCI-SITE', '50-60-225104'),
  ('00000000-0000-4000-8000-000000000001', 'sunbelt', 'LIBERTY - CEDAR RAPIDS LT1', '50-60-225104'),
  ('00000000-0000-4000-8000-000000000001', 'sunbelt', 'QTS DC4', '50-60-225121');

-- One rate table per CDR job, with the Iowa CBA numbers the labor skill carried (7/1/2026 on, both pay-ID forms).
-- Replace them by dropping Sage's rate table export on Update; every other job gets its table the same way.
insert into public.rate_tables (workspace_id, code, description) values
  ('00000000-0000-4000-8000-000000000001', '#225121', 'CDR1 East DC4 (Iowa CBA, placeholder until the Sage export)'),
  ('00000000-0000-4000-8000-000000000001', '#225120', 'CDR1 East DC5 (Iowa CBA, placeholder until the Sage export)'),
  ('00000000-0000-4000-8000-000000000001', '#226021', 'CDR1 East DC7 (Iowa CBA, placeholder until the Sage export)'),
  ('00000000-0000-4000-8000-000000000001', '#225104', 'CDR1 East TM (Iowa CBA, placeholder until the Sage export)');
insert into public.billable_rates (workspace_id, rate_table_code, certified_class, pay_id, rate_cents, effective, note)
select '00000000-0000-4000-8000-000000000001', t.code, r.certified_class, r.pay_id, r.rate_cents, daterange('2026-07-01', null, '[)'), 'Iowa CBA 2025-26 from the labor skill; replace with the Sage export'
from public.rate_tables t cross join (values
  ('#LAB-J', 'UNION REG', 8725), ('#LAB-J', 'REG', 8725), ('#LAB-J', 'UNION O/T', 12000), ('#LAB-J', 'O/T', 12000), ('#LAB-J', 'UNION D/T', 14950), ('#LAB-J', 'DOUBLETIME', 14950),
  ('#LAB-GF', 'UNION REG', 10825), ('#LAB-GF', 'REG', 10825), ('#LAB-GF', 'UNION O/T', 14625), ('#LAB-GF', 'O/T', 14625),
  ('#CARP-J', 'UNION REG', 9850), ('#CARP-J', 'REG', 9850), ('#CARP-J', 'UNION O/T', 12750), ('#CARP-J', 'O/T', 12750), ('#CARP-J', 'UNION D/T', 15650), ('#CARP-J', 'DOUBLETIME', 15650)
) as r(certified_class, pay_id, rate_cents)
where t.workspace_id = '00000000-0000-4000-8000-000000000001';

insert into public.pay_type_policy (workspace_id, pay_type_name, policy) values
  ('00000000-0000-4000-8000-000000000001', 'Vacation', 'held_pto'), ('00000000-0000-4000-8000-000000000001', 'Holiday', 'held_pto'),
  ('00000000-0000-4000-8000-000000000001', 'Sick Time', 'held_pto'), ('00000000-0000-4000-8000-000000000001', 'Flex Paid Time Off', 'held_pto'),
  ('00000000-0000-4000-8000-000000000001', 'Birthday Time Off', 'held_pto'), ('00000000-0000-4000-8000-000000000001', 'Floating Hol', 'held_pto');

-- the haulers: Sourgum invoices one pull at a time, Waste Management bills a lump
insert into public.waste_vendors (workspace_id, pattern, name, bills_per_haul, haul_rate_cents, container_yd)
  select w.id, v.pattern, v.name, v.per_haul, v.rate, v.yd from public.workspaces w,
  (values ('sourgum', 'Sourgum Waste', true, 68500, 30), ('waste management', 'Waste Management', false, null::int, 40)) as v(pattern, name, per_haul, rate, yd)
  where w.name = 'Liberty Builds'
  on conflict do nothing;
