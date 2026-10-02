-- 0006_views.sql - how the page reads.
--
-- Every public view runs with its owner's rights and SCOPES ITSELF: line
-- views to editors (app.can_edit), aggregates to members (app.is_member).
-- Row Level Security on the tables still guards direct reads; the views do
-- not lean on it, because a security-invoker view nested in an owner view
-- filters as the caller and would empty every aggregate for a viewer. The
-- unscoped pricing lives in schema app, which the API does not expose.
--
-- Aggregates carry no names and no employee numbers. The pricing rules are
-- the same as app/labor_model.js; the tests hold the two to each other.

create view app.uploads_live as
  select * from public.uploads where status = 'recorded' and superseded_by is null;

create view public.v_uploads_live as
  select * from app.uploads_live where app.is_member(workspace_id);

create view app.labor_priced as
with base as (
  select l.*,
    coalesce(e.certified_class, case upper(substr(l.employee_number, 1, 3))
      when 'FB2' then '#LAB-J' when 'FB5' then '#LAB-J' when 'TTR' then '#LAB-J' when 'FB7' then '#CARP-J' when 'FB8' then '#CARP-J' end) as certified_class,
    coalesce(p.policy, case when l.pay_type_name in ('Vacation', 'Holiday', 'Sick Time', 'Flex Paid Time Off', 'Birthday Time Off', 'Floating Hol')
      then 'held_pto' else 'rated' end) as policy,
    (j.id is not null) as job_known,
    j.rate_table_code
  from public.labor_lines l
  join app.uploads_live u on u.id = l.upload_id
  left join public.employees e on e.workspace_id = l.workspace_id and e.employee_number = l.employee_number
  left join public.pay_type_policy p on p.workspace_id = l.workspace_id and p.pay_type_name = l.pay_type_name
  left join public.jobs j on j.workspace_id = l.workspace_id and j.job_number = l.job_number
)
select b.*, r.id as rate_id, r.rate_cents,
  case when not b.job_known then 'held:unknown job'
       when b.policy = 'excluded' then 'excluded'
       when b.policy = 'held_pto' then 'held:PTO pay type'
       when b.rate_table_code is null then 'held:no rate table'
       when b.certified_class is null then 'held:no class'
       when r.id is null then 'held:no rate'
       else 'priced' end as status,
  case when b.job_known and b.policy = 'rated' and b.rate_table_code is not null and b.certified_class is not null and r.id is not null
       then round(b.hours * r.rate_cents)::bigint end as cost_cents
from base b
left join lateral (
  select r.id, r.rate_cents from public.billable_rates r
  where r.workspace_id = b.workspace_id and r.rate_table_code = b.rate_table_code and r.certified_class = b.certified_class
    and r.pay_id = b.pay_type and r.retired_at is null and r.effective @> b.work_date
  limit 1
) r on true;

-- editors: every line, priced
create view public.v_labor_priced as
  select * from app.labor_priced where app.can_edit(workspace_id);

-- everyone in the workspace: aggregates, no names, no employee numbers
create view public.v_labor_job_month as
  select workspace_id, job_number, date_trunc('month', work_date)::date as month,
    count(*) as rows_n, sum(hours) as hours,
    coalesce(sum(hours) filter (where status = 'priced'), 0) as priced_hours,
    coalesce(sum(cost_cents), 0)::bigint as cost_cents,
    coalesce(sum(hours) filter (where status like 'held:%'), 0) as held_hours,
    count(*) filter (where status like 'held:%') as held_rows,
    max(work_date) as through
  from app.labor_priced
  where app.is_member(workspace_id)
  group by 1, 2, 3;

create view public.v_labor_class_month as
  select workspace_id, job_number, date_trunc('month', work_date)::date as month, certified_class, pay_type as pay_id, pay_type_name, status,
    count(*) as rows_n, sum(hours) as hours, coalesce(sum(cost_cents), 0)::bigint as cost_cents, max(rate_cents) as rate_cents
  from app.labor_priced
  where app.is_member(workspace_id)
  group by 1, 2, 3, 4, 5, 6, 7;

-- editors: what Settings has to answer, grouped
create view public.v_labor_held as
  select workspace_id, job_number, max(job_name) as job_name, max(rate_table_code) as rate_table_code, status, certified_class, pay_type as pay_id, pay_type_name, employee_number,
    count(*) as rows_n, sum(hours) as hours, min(work_date) as first_day, max(work_date) as last_day
  from app.labor_priced
  where status like 'held:%' and app.can_edit(workspace_id)
  group by 1, 2, 5, 6, 7, 8, 9;

-- rentals: every live line with its snapshot
create view app.rental_live as
  select s.vendor_key, s.as_of, l.*
  from public.onrent_lines l
  join public.onrent_snapshots s on s.id = l.snapshot_id
  join app.uploads_live u on u.id = s.upload_id;

-- every rental ever seen: first and last snapshot, and when it went off rent
create view app.rental_items as
with ident as (
  select workspace_id, vendor_key, equipment_no, contract_no, vendor_job_ref, seq,
    min(as_of) as first_seen, max(as_of) as last_seen, count(*) as snapshots
  from app.rental_live group by 1, 2, 3, 4, 5, 6
)
select i.*, m.job_number,
  (select min(s2.as_of) from public.onrent_snapshots s2 join app.uploads_live u2 on u2.id = s2.upload_id
    where s2.workspace_id = i.workspace_id and s2.vendor_key = i.vendor_key and s2.as_of > i.last_seen) as off_rent_date,
  ll.description, ll.qty, ll.on_rent_date, ll.rate_period, ll.rate_cents, ll.monthly_rent_cents, ll.liberty_owned, ll.po, ll.line_ref, ll.raw
from ident i
left join public.vendor_job_map m on m.workspace_id = i.workspace_id and m.vendor_key = i.vendor_key and m.vendor_job_ref = i.vendor_job_ref
left join lateral (
  select l.* from app.rental_live l
  where l.workspace_id = i.workspace_id and l.vendor_key = i.vendor_key and l.equipment_no = i.equipment_no
    and l.contract_no = i.contract_no and l.vendor_job_ref = i.vendor_job_ref and l.seq = i.seq
  order by l.as_of desc limit 1
) ll on true;

create view public.v_rental_items as
  select * from app.rental_items where app.can_edit(workspace_id);

-- a month's rentals per job and vendor: the latest snapshot on or before the
-- month's end, at run-rate; rent + tax + markup under the vendor's settings
create view public.v_rental_month as
with snaps as (
  -- two reports from one vendor as of the same day: the one recorded last stands
  select s.*, u.finalized_at from public.onrent_snapshots s join app.uploads_live u on u.id = s.upload_id
), span as (
  select workspace_id, vendor_key, date_trunc('month', min(as_of))::date as m0,
    greatest(date_trunc('month', max(as_of))::date, date_trunc('month', now())::date) as m1
  from snaps group by 1, 2
), months as (
  select sp.workspace_id, sp.vendor_key, gs::date as month
  from span sp cross join lateral generate_series(sp.m0, sp.m1, interval '1 month') gs
), pick as (
  select mo.*, (select s.id from snaps s where s.workspace_id = mo.workspace_id and s.vendor_key = mo.vendor_key
                  and s.as_of <= (mo.month + interval '1 month - 1 day')::date order by s.as_of desc, s.finalized_at desc nulls last limit 1) as snapshot_id
  from months mo
), lines as (
  select p.workspace_id, p.vendor_key, p.month, p.snapshot_id, s.as_of,
    coalesce(m.job_number, 'unmapped') as job_number, l.monthly_rent_cents, l.liberty_owned
  from pick p
  join snaps s on s.id = p.snapshot_id
  join public.onrent_lines l on l.snapshot_id = p.snapshot_id
  left join public.vendor_job_map m on m.workspace_id = l.workspace_id and m.vendor_key = p.vendor_key and m.vendor_job_ref = l.vendor_job_ref
), agg as (
  select workspace_id, vendor_key, month, snapshot_id, as_of, job_number,
    count(*) as lines, count(*) filter (where monthly_rent_cents is null) as no_monthly,
    coalesce(sum(monthly_rent_cents) filter (where not liberty_owned), 0)::bigint as rent_cents,
    coalesce(sum(monthly_rent_cents) filter (where liberty_owned), 0)::bigint as liberty_owned_cents
  from lines group by 1, 2, 3, 4, 5, 6
), priced as (
  -- tax is the job's (its site), markup is the job's; a vendor can be untaxed; lines under no job carry neither
  select a.*, vs.taxable, vs.tax_bp, vs.markup_bp, vs.markup_base,
    case when vs.taxable then round((a.rent_cents * vs.tax_bp)::numeric / 10000)::bigint else 0 end as tax_cents
  from agg a
  left join lateral (
    select coalesce(v.taxable, true) and j.id is not null as taxable, coalesce(j.tax_bp, 0) as tax_bp, coalesce(j.markup_bp, 0) as markup_bp,
      coalesce(j.markup_base, 'rent_plus_tax') as markup_base
    from (select 1) x
    left join public.vendors v on v.workspace_id = a.workspace_id and v.vendor_key = a.vendor_key
    left join public.jobs j on j.workspace_id = a.workspace_id and j.job_number = a.job_number
  ) vs on true
)
select p.*,
  round(((p.rent_cents + case when p.markup_base = 'rent_plus_tax' then p.tax_cents else 0 end) * p.markup_bp)::numeric / 10000)::bigint as markup_cents,
  p.rent_cents + p.tax_cents + round(((p.rent_cents + case when p.markup_base = 'rent_plus_tax' then p.tax_cents else 0 end) * p.markup_bp)::numeric / 10000)::bigint as total_cents
from priced p
where app.is_member(p.workspace_id);

-- purchases: documents. A Purchase Pro export is a snapshot of every PO, so
-- the latest recorded export stands for all of them; tickets and form entries
-- from other sources stand on their own. A decision never edits a document.
create view app.purchase_docs_live as
with latest_po as (
  select distinct on (workspace_id) workspace_id, id from app.uploads_live where kind = 'purchase_orders' order by workspace_id, as_of desc nulls last, finalized_at desc, id
)
select d.* from public.purchase_docs d
left join public.uploads u on u.id = d.upload_id
where d.superseded_by is null
  and (d.source <> 'drop' or u.kind is distinct from 'purchase_orders' or d.upload_id in (select id from latest_po));

create view app.purchase_docs_resolved as
select d.id, d.workspace_id, d.upload_id, d.source, d.direction, d.vendor_key, d.vendor_name_raw, d.doc_kind, d.doc_number, d.doc_date, d.description, d.order_type,
  d.cancelled, d.quote, d.total_cents,
  coalesce(dd.job_number, d.job_number) as job_number,
  coalesce(dd.cost_code, d.cost_code) as cost_code,
  coalesce(dd.bucket, cc.bucket, d.bucket) as bucket,
  case when d.cancelled or d.quote then 'excluded'
       when dd.decision = 'exclude' then 'excluded'
       when d.total_cents is null then 'needs_decision'
       when dd.decision in ('confirm', 'assign') then 'confirmed'
       when j.id is null then 'needs_decision'
       else d.status::text end as status,
  (j.id is not null) as job_known
from app.purchase_docs_live d
-- the latest decision on this document, or on the same PO number from an earlier export:
-- a Purchase Pro export recreates every PO, and a decision is about the PO, not the export
left join lateral (
  select x.* from public.purchase_decisions x
  join public.purchase_docs xd on xd.id = x.doc_id
  where x.line_id is null and x.workspace_id = d.workspace_id
    and (x.doc_id = d.id or (d.doc_kind = 'purchase_order' and xd.doc_kind = 'purchase_order' and xd.source = d.source and xd.doc_number = d.doc_number))
  order by x.decided_at desc, x.id desc limit 1) dd on true
left join public.cost_codes cc on cc.workspace_id = d.workspace_id and cc.code = coalesce(dd.cost_code, d.cost_code)
left join public.jobs j on j.workspace_id = d.workspace_id and j.job_number = coalesce(dd.job_number, d.job_number);

create view public.v_purchase_docs as
  select * from app.purchase_docs_resolved where app.is_member(workspace_id);

-- purchases: a line's job, cost code and status after the latest decision
create view app.purchase_lines_resolved as
select l.id, l.workspace_id, l.doc_id, d.source, d.direction, d.vendor_key, d.doc_kind, d.doc_number, d.doc_date, l.line_no, l.description, l.qty, l.uom, l.unit_cents, l.amount_cents,
  coalesce(dl.job_number, dd.job_number, l.job_number, d.job_number) as job_number,
  coalesce(dl.cost_code, dd.cost_code, l.cost_code, d.cost_code) as cost_code,
  coalesce(dl.bucket, dd.bucket, cc.bucket) as bucket,
  case when coalesce(dl.decision, dd.decision) = 'exclude' then 'excluded'
       when coalesce(dl.decision, dd.decision) in ('confirm', 'assign') then 'confirmed'
       else l.status::text end as status
from public.purchase_lines l
join public.purchase_docs d on d.id = l.doc_id and d.superseded_by is null
left join lateral (select * from public.purchase_decisions x where x.line_id = l.id order by x.decided_at desc limit 1) dl on true
left join lateral (select * from public.purchase_decisions x where x.doc_id = l.doc_id and x.line_id is null order by x.decided_at desc limit 1) dd on true
left join public.cost_codes cc on cc.workspace_id = l.workspace_id and cc.code = coalesce(dl.cost_code, dd.cost_code, l.cost_code, d.cost_code);

create view public.v_purchase_lines as
  select * from app.purchase_lines_resolved where app.is_member(workspace_id);

create view public.v_purchase_month as
  select workspace_id, job_number, date_trunc('month', doc_date)::date as month, bucket, status, direction, order_type,
    count(*) as lines, coalesce(sum(total_cents), 0)::bigint as amount_cents
  from app.purchase_docs_resolved
  where app.is_member(workspace_id) and doc_date is not null
  group by 1, 2, 3, 4, 5, 6, 7;

-- the GRforecast import shape: one row per job, month and bucket
create view public.v_month_buckets as
  select workspace_id, job_number, month, 'LABOR'::app.bucket as bucket, cost_cents as cents from public.v_labor_job_month
  union all
  select workspace_id, job_number, month, 'EQUIPMENT'::app.bucket, sum(total_cents)::bigint from public.v_rental_month where job_number <> 'unmapped' group by 1, 2, 3
  union all
  select workspace_id, job_number, month, bucket, sum(amount_cents)::bigint from public.v_purchase_month
  where bucket is not null and status in ('auto', 'confirmed') and direction = 'cost' group by 1, 2, 3, 4;

-- one row per job and month: the tiles
create view public.v_job_month as
with l as (
  select workspace_id, job_number, month, cost_cents as labor_cents, hours as labor_hours, held_hours as labor_held_hours, held_rows as labor_held_rows, through as labor_through
  from public.v_labor_job_month
), r as (
  select workspace_id, job_number, month, sum(total_cents)::bigint as rental_cents, sum(liberty_owned_cents)::bigint as rental_lo_cents,
    sum(lines)::int as rental_lines, sum(no_monthly)::int as rental_no_monthly, max(as_of) as rental_as_of
  from public.v_rental_month where job_number <> 'unmapped' group by 1, 2, 3
), p as (
  select workspace_id, job_number, month,
    coalesce(sum(amount_cents) filter (where status in ('auto', 'confirmed') and direction = 'cost'), 0)::bigint as purchase_cents,
    coalesce(sum(amount_cents) filter (where status in ('auto', 'confirmed') and direction = 'cost' and order_type = 'Rental'), 0)::bigint as purchase_rental_cents,
    coalesce(sum(amount_cents) filter (where status in ('auto', 'confirmed') and direction = 'cost' and bucket = 'NON_BILLABLE'), 0)::bigint as purchase_nb_cents,
    coalesce(sum(amount_cents) filter (where status = 'needs_decision' and direction = 'cost'), 0)::bigint as pending_cents,
    coalesce(sum(lines) filter (where status = 'needs_decision'), 0)::int as pending_lines
  from public.v_purchase_month group by 1, 2, 3
)
select coalesce(l.workspace_id, r.workspace_id, p.workspace_id) as workspace_id,
  coalesce(l.job_number, r.job_number, p.job_number) as job_number,
  coalesce(l.month, r.month, p.month) as month,
  coalesce(l.labor_cents, 0) as labor_cents, coalesce(l.labor_hours, 0) as labor_hours, coalesce(l.labor_held_hours, 0) as labor_held_hours,
  coalesce(l.labor_held_rows, 0) as labor_held_rows, l.labor_through,
  coalesce(r.rental_cents, 0) as rental_cents, coalesce(r.rental_lo_cents, 0) as rental_lo_cents, coalesce(r.rental_lines, 0) as rental_lines,
  coalesce(r.rental_no_monthly, 0) as rental_no_monthly, r.rental_as_of,
  coalesce(p.purchase_cents, 0) as purchase_cents, coalesce(p.purchase_rental_cents, 0) as purchase_rental_cents, coalesce(p.purchase_nb_cents, 0) as purchase_nb_cents,
  coalesce(p.pending_cents, 0) as pending_cents, coalesce(p.pending_lines, 0) as pending_lines,
  coalesce(l.labor_cents, 0) + coalesce(r.rental_cents, 0) + coalesce(r.rental_lo_cents, 0) + coalesce(p.purchase_cents, 0) as total_cents
from l
full join r on r.workspace_id = l.workspace_id and r.job_number = l.job_number and r.month = l.month
full join p on p.workspace_id = coalesce(l.workspace_id, r.workspace_id) and p.job_number = coalesce(l.job_number, r.job_number) and p.month = coalesce(l.month, r.month);

-- how fresh each feed is, per workspace
create view public.v_freshness as
  select w.id as workspace_id,
    (select max(upper(u.period) - 1) from app.uploads_live u where u.workspace_id = w.id and u.kind = 'hh2_labor') as hh2_through,
    (select max(u.recorded_at) from app.uploads_live u where u.workspace_id = w.id and u.kind = 'hh2_labor') as hh2_recorded_at,
    (select coalesce(jsonb_object_agg(x.vendor_key, x.as_of), '{}'::jsonb) from (
       select s.vendor_key, max(s.as_of) as as_of from public.onrent_snapshots s join app.uploads_live u on u.id = s.upload_id
       where s.workspace_id = w.id group by 1) x) as onrent_as_of,
    (select max(u.as_of) from app.uploads_live u where u.workspace_id = w.id and u.kind = 'purchase_orders') as po_as_of,
    (select max(received_at) from public.inbox_messages m where m.workspace_id = w.id) as last_inbox_at,
    (select count(*) from public.inbox_messages m where m.workspace_id = w.id and m.parse_status in ('pending', 'needs_decision')) as inbox_pending,
    (select count(*) from app.uploads_live u where u.workspace_id = w.id) as uploads_live
  from public.workspaces w
  where app.is_member(w.id);
