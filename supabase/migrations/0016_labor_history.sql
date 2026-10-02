-- 0016_labor_history.sql - the weekly cost workbook's Labor sheet is the labor
-- HISTORY: loaded once as the baseline, the weekly HH2 files add to it. A row
-- from it keeps the cost the old workbook gave it (cost_given_cents) and the
-- class it carried then (class_given); pricing takes the given cost as the
-- row's cost instead of looking a rate up, and the class carried on the row
-- stands over the person's. Jobs seen on time sheets are catalogued by the
-- page on Record (upsert, never overwriting Settings).
alter table public.labor_lines
  add column cost_given_cents bigint,
  add column class_given text,
  add column source_layout text;

create or replace function public.append_labor_lines(p_upload uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare u public.uploads; n int;
begin
  u := app.pending_upload(p_upload, 'hh2_labor');
  insert into public.labor_lines (workspace_id, upload_id, row_index, employee_number, work_date, payroll_group, payroll_service_id,
    job_number, job_name, child_job, child_job_name, cost_code, cost_code_name, pay_type, pay_type_name, hours, cost_given_cents, class_given, source_layout)
  select u.workspace_id, p_upload, r.row_index, r.employee_number, r.work_date, r.payroll_group, r.payroll_service_id,
    r.job_number, r.job_name, nullif(r.child_job, ''), nullif(r.child_job_name, ''), r.cost_code, r.cost_code_name, r.pay_type, r.pay_type_name,
    (r.hours_x100::numeric / 100), r.cost_given_cents, r.class_given, r.source_layout
  from jsonb_to_recordset(p_rows) as r(row_index int, employee_number text, work_date date, payroll_group text, payroll_service_id text,
    job_number text, job_name text, child_job text, child_job_name text, cost_code text, cost_code_name text, pay_type text, pay_type_name text, hours_x100 bigint,
    cost_given_cents bigint, class_given text, source_layout text);
  get diagnostics n = row_count;
  return n;
end $$;

-- the same view as 0013, with the given cost and class, and four columns appended
create or replace view app.labor_priced as
with base as (
  select l.id, l.workspace_id, l.upload_id, l.row_index, l.employee_number, l.work_date, l.payroll_group, l.payroll_service_id, l.job_number, l.job_name,
    l.child_job, l.child_job_name, l.cost_code, l.cost_code_name, l.pay_type, l.pay_type_name, l.hours, l.week_ending,
    coalesce(l.class_given, e.certified_class, pc.certified_class) as certified_class,
    coalesce(p.policy, case when l.pay_type_name in ('Vacation', 'Holiday', 'Sick Time', 'Flex Paid Time Off', 'Birthday Time Off', 'Floating Hol')
      then 'held_pto' else 'rated' end) as policy,
    (j.id is not null) as job_known,
    j.rate_table_code,
    l.cost_given_cents, l.class_given, l.source_layout
  from public.labor_lines l
  join app.uploads_live u on u.id = l.upload_id
  left join public.employees e on e.workspace_id = l.workspace_id and e.employee_number = l.employee_number
  left join lateral (
    select x.certified_class from public.prefix_classes x
    where x.workspace_id = l.workspace_id and left(upper(l.employee_number), length(x.prefix)) = x.prefix
    order by length(x.prefix) desc limit 1
  ) pc on true
  left join public.pay_type_policy p on p.workspace_id = l.workspace_id and p.pay_type_name = l.pay_type_name
  left join public.jobs j on j.workspace_id = l.workspace_id and j.job_number = l.job_number
)
select b.id, b.workspace_id, b.upload_id, b.row_index, b.employee_number, b.work_date, b.payroll_group, b.payroll_service_id, b.job_number, b.job_name,
  b.child_job, b.child_job_name, b.cost_code, b.cost_code_name, b.pay_type, b.pay_type_name, b.hours, b.week_ending,
  b.certified_class, b.policy, b.job_known, b.rate_table_code,
  r.id as rate_id, r.rate_cents,
  case when not b.job_known then 'held:unknown job'
       when b.policy = 'excluded' then 'excluded'
       when b.policy = 'held_pto' then 'held:PTO pay type'
       when b.cost_given_cents is not null then 'priced'
       when b.rate_table_code is null then 'held:no rate table'
       when b.certified_class is null then 'held:no class'
       when r.id is null then 'held:no rate'
       else 'priced' end as status,
  case when not b.job_known or b.policy <> 'rated' then null
       when b.cost_given_cents is not null then b.cost_given_cents
       when b.rate_table_code is not null and b.certified_class is not null and r.id is not null then round(b.hours * r.rate_cents)::bigint end as cost_cents,
  b.cost_given_cents, b.class_given, b.source_layout,
  case when not b.job_known or b.policy <> 'rated' then null
       when b.cost_given_cents is not null then 'given'
       when b.rate_table_code is not null and b.certified_class is not null and r.id is not null then 'rate' end as price_source
from base b
left join lateral (
  select r.id, r.rate_cents from public.billable_rates r
  where b.cost_given_cents is null
    and r.workspace_id = b.workspace_id and r.rate_table_code = b.rate_table_code and r.certified_class = b.certified_class
    and r.pay_id = b.pay_type and r.retired_at is null and r.effective @> b.work_date
  limit 1
) r on true;

create or replace view public.v_labor_priced as
  select * from app.labor_priced where app.can_edit(workspace_id);
