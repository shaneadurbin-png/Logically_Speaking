-- 01_rls.sql - who may see and do what. Runs under `supabase test db` (pgTAP)
-- and under tests/db/run.sh (the shim). Everything rolls back.
begin;
select plan(25);

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'owner@example.com'),
  ('10000000-0000-4000-8000-000000000002', 'editor@example.com'),
  ('10000000-0000-4000-8000-000000000003', 'viewer@example.com'),
  ('10000000-0000-4000-8000-000000000009', 'stranger@example.com');
insert into public.members (workspace_id, email, role) values
  ('00000000-0000-4000-8000-000000000001', 'editor@example.com', 'editor'),
  ('00000000-0000-4000-8000-000000000001', 'viewer@example.com', 'viewer');

-- a stranger sees nothing
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000009","email":"stranger@example.com","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.workspaces), 0::bigint, 'a stranger sees no workspace');
select is((select count(*) from public.jobs), 0::bigint, 'a stranger sees no jobs');
select lives_ok($$ select public.create_workspace('Mine') $$, 'anyone signed in can start a workspace');
select is((select count(*) from public.workspaces), 1::bigint, 'and is its owner');
reset role;

-- the invited viewer claims their membership by email, then sees aggregates and never names
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","email":"viewer@example.com","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.claim_membership()), 1::bigint, 'an invite by email is claimed at sign-in');
select is((select user_id from public.members where email = 'viewer@example.com'), '10000000-0000-4000-8000-000000000003'::uuid, 'the membership now carries the user id');
select is((select count(*) from public.workspaces), 1::bigint, 'a viewer sees the workspace');
select is((select count(*) from public.jobs), 4::bigint, 'a viewer sees the jobs');
select is((select count(*) from public.employees), 0::bigint, 'a viewer never reads employees');
select is((select count(*) from public.labor_lines), 0::bigint, 'a viewer never reads labor lines');
select is((select count(*) from public.billable_rates), 64::bigint, 'a viewer sees the rates');
select throws_matching($$ insert into public.jobs (workspace_id, job_number, short_name) values ('00000000-0000-4000-8000-000000000001', '50-60-999999', 'X') $$,
  'row-level security', 'a viewer cannot add a job');
select throws_matching($$ select public.retire_rate((select id from public.billable_rates limit 1)) $$, 'not allowed', 'a viewer cannot retire a rate');
reset role;

-- the editor
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","email":"editor@example.com","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ insert into public.jobs (workspace_id, job_number, short_name) values ('00000000-0000-4000-8000-000000000001', '50-60-999999', 'X') $$, 'an editor adds a job');
select is((select count(*) from public.audit_log where table_name = 'jobs' and op = 'INSERT' and actor_email = 'editor@example.com'), 1::bigint, 'and the audit log says who');
select throws_matching($$ insert into public.members (workspace_id, email, role) values ('00000000-0000-4000-8000-000000000001', 'x@example.com', 'viewer') $$,
  'row-level security', 'an editor cannot invite');
select throws_matching($$ insert into public.billable_rates (workspace_id, rate_table_code, certified_class, pay_id, rate_cents, effective)
  values ('00000000-0000-4000-8000-000000000001', '#225121', '#LAB-J', 'REG', 9000, daterange('2027-01-01', null)) $$,
  'conflicting key value|exclusion', 'two live rates for one key may not overlap');
update public.billable_rates set note = 'touched' where rate_table_code = '#225121';
select is((select count(*) from public.billable_rates where note = 'touched'), 0::bigint, 'an editor cannot update a rate at all (no policy)');
select lives_ok($$ select public.retire_rate((select id from public.billable_rates where rate_table_code = '#225121' and certified_class = '#LAB-J' and pay_id = 'REG')) $$, 'an editor retires a rate');
select lives_ok($$ insert into public.billable_rates (workspace_id, rate_table_code, certified_class, pay_id, rate_cents, effective)
  values ('00000000-0000-4000-8000-000000000001', '#225121', '#LAB-J', 'REG', 9000, daterange('2026-07-01', null)) $$, 'and adds the new one');
reset role;

-- the owner
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","email":"owner@example.com","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ insert into public.members (workspace_id, email, role) values ('00000000-0000-4000-8000-000000000001', 'pm@suffolk.example', 'viewer') $$, 'an owner invites');
select throws_matching($$ update public.members set role = 'editor' where email = 'owner@example.com' $$, 'at least one owner', 'the last owner cannot be demoted');
reset role;

-- actuals are never edited, even by the owner of the tables; a rate is never changed in place
insert into public.uploads (id, workspace_id, kind, sha256, file_name, byte_size, status) values
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'hh2_labor', decode(repeat('9', 64), 'hex'), 'x.xlsx', 1, 'recorded'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'onrent', decode(repeat('8', 64), 'hex'), 'y.csv', 1, 'recorded');
insert into public.labor_lines (workspace_id, upload_id, row_index, employee_number, work_date, job_number, pay_type_name, hours)
  values ('00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 2, 'FB5001', '2026-09-01', '50-60-225121', 'Regular', 8);
insert into public.onrent_snapshots (id, workspace_id, upload_id, vendor_key, layout, as_of, line_count, rent_cents)
  values ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'sunbelt', 'generic', '2026-09-26', 1, 100);
insert into public.onrent_lines (workspace_id, snapshot_id, row_index, equipment_no, contract_no, vendor_job_ref, monthly_rent_cents)
  values ('00000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 2, 'E', 'C', 'J', 100);
select throws_matching($$ delete from public.labor_lines $$, 'never edited', 'labor lines cannot be deleted');
select throws_matching($$ update public.onrent_lines set qty = 2 $$, 'never edited', 'rental lines cannot be updated');
select throws_matching($$ update public.billable_rates set rate_cents = 1 where rate_table_code = '#225120' and certified_class = '#LAB-J' and pay_id = 'REG' $$,
  'never changed', 'a rate is never changed in place');

select * from finish();
rollback;
