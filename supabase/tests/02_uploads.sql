-- 02_uploads.sql - begin / append / finalize: conservation, same file twice,
-- and the overlap rule for HH2 exports.
begin;
select plan(18);
insert into auth.users (id, email) values ('10000000-0000-4000-8000-000000000002', 'editor@example.com'), ('10000000-0000-4000-8000-000000000003', 'viewer@example.com');
insert into public.members (workspace_id, email, user_id, role, display_name) values
  ('00000000-0000-4000-8000-000000000001', 'editor@example.com', '10000000-0000-4000-8000-000000000002', 'editor', 'Shane'),
  ('00000000-0000-4000-8000-000000000001', 'viewer@example.com', '10000000-0000-4000-8000-000000000003', 'viewer', null);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","email":"viewer@example.com","role":"authenticated"}', true);
set local role authenticated;
select throws_matching($$ select public.begin_upload('00000000-0000-4000-8000-000000000001', 'hh2_labor', repeat('a', 64), 'x.xlsx', 10) $$, 'only an editor', 'a viewer cannot record');
reset role;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","email":"editor@example.com","role":"authenticated"}', true);
set local role authenticated;
create temp table t1 as select public.begin_upload('00000000-0000-4000-8000-000000000001', 'hh2_labor', repeat('a', 64), 'LaborDetails_9_1_2026_to_9_7_2026.xlsx', 10,
  '{"period":{"start":"2026-09-01","end":"2026-09-07"},"employees":["FB5001","FB5002"]}'::jsonb) as r;
select is((select r ->> 'existing' from t1), 'false', 'a new file begins');
select is((select jsonb_array_length(r -> 'overlaps') from t1), 0, 'and overlaps nothing yet');
select is(public.append_labor_lines((select (r ->> 'upload_id')::uuid from t1),
  '[{"row_index":2,"employee_number":"FB5001","work_date":"2026-09-01","job_number":"50-60-225121","pay_type":"REG","pay_type_name":"Regular","hours_x100":800},
    {"row_index":3,"employee_number":"FB5002","work_date":"2026-09-02","job_number":"50-60-225121","pay_type":"UNION O/T","pay_type_name":"O/T","hours_x100":250}]'::jsonb), 2, 'two lines appended');
select throws_matching($$ select public.finalize_upload((select (r ->> 'upload_id')::uuid from t1), '{"rows":2,"hours_x100":1000}'::jsonb) $$,
  'conservation: the file says 2 rows and 1000', 'a mismatch is refused');
select is((select status from public.uploads where id = (select (r ->> 'upload_id')::uuid from t1)), 'pending'::app.upload_status, 'and nothing of it is recorded (it stays pending until the next try)');

create temp table t2 as select public.begin_upload('00000000-0000-4000-8000-000000000001', 'hh2_labor', repeat('a', 64), 'LaborDetails_9_1_2026_to_9_7_2026.xlsx', 10,
  '{"period":{"start":"2026-09-01","end":"2026-09-07"},"employees":["FB5001","FB5002"]}'::jsonb) as r;
select is((select r ->> 'existing' from t2), 'false', 'the pending try is cleaned up and the file begins again');
select is((select count(*) from public.uploads where sha256 = decode(repeat('a', 64), 'hex')), 1::bigint, 'one upload row per file');
select is(public.append_labor_lines((select (r ->> 'upload_id')::uuid from t2),
  '[{"row_index":2,"employee_number":"FB5001","work_date":"2026-09-01","job_number":"50-60-225121","pay_type":"REG","pay_type_name":"Regular","hours_x100":800},
    {"row_index":3,"employee_number":"FB5002","work_date":"2026-09-02","job_number":"50-60-225121","pay_type":"UNION O/T","pay_type_name":"O/T","hours_x100":250}]'::jsonb), 2, 'appended again');
select is((select public.finalize_upload((select (r ->> 'upload_id')::uuid from t2), '{"rows":2,"hours_x100":1050}'::jsonb) ->> 'status'), 'recorded', 'the counts agree and it records');
select is((select count(*) from public.v_labor_priced), 2::bigint, 'its lines are live');

create temp table t3 as select public.begin_upload('00000000-0000-4000-8000-000000000001', 'hh2_labor', repeat('a', 64), 'copy.xlsx', 10) as r;
select is((select r ->> 'existing' from t3), 'true', 'the same bytes again are already on file');
select is((select r ->> 'recorded_by_name' from t3), 'Shane', 'and the card can say by whom');

-- a re-pull of the same week for the same people must replace, with a reason
create temp table t4 as select public.begin_upload('00000000-0000-4000-8000-000000000001', 'hh2_labor', repeat('b', 64), 'LaborDetails_9_1_2026_to_9_7_2026 (1).xlsx', 10,
  '{"period":{"start":"2026-09-01","end":"2026-09-07"},"employees":["FB5001"]}'::jsonb) as r;
select is((select jsonb_array_length(r -> 'overlaps') from t4), 1, 'begin reports the overlap');
select public.append_labor_lines((select (r ->> 'upload_id')::uuid from t4), '[{"row_index":2,"employee_number":"FB5001","work_date":"2026-09-01","job_number":"50-60-225121","pay_type":"REG","pay_type_name":"Regular","hours_x100":900}]'::jsonb);
select throws_matching($$ select public.finalize_upload((select (r ->> 'upload_id')::uuid from t4), '{"rows":1,"hours_x100":900}'::jsonb) $$, 'overlaps 1 file', 'finalize refuses without a reason');
select is((select public.finalize_upload((select (r ->> 'upload_id')::uuid from t4), '{"rows":1,"hours_x100":900}'::jsonb, '{"reason":"re-pulled after a timecard correction"}'::jsonb) ->> 'status'), 'recorded', 'with a reason it records');
select is((select status from public.uploads where id = (select (r ->> 'upload_id')::uuid from t2)), 'superseded'::app.upload_status, 'and the earlier file is superseded');

-- another payroll group's export for the same week is simply another file
create temp table t5 as select public.begin_upload('00000000-0000-4000-8000-000000000001', 'hh2_labor', repeat('c', 64), 'LaborDetails_9_1_2026_to_9_7_2026_TTR.xlsx', 10,
  '{"period":{"start":"2026-09-01","end":"2026-09-07"},"employees":["TTR-10001"]}'::jsonb) as r;
select is((select jsonb_array_length(r -> 'overlaps') from t5), 0, 'the TTR export for the same week overlaps nothing');
reset role;
select * from finish();
rollback;
