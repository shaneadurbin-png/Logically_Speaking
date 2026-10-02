-- 0015_month_grace.sql - a month with no on-rent report by its last day takes
-- the first report after it, within seven days. The weekly package is pulled a
-- day or two into the next month, and that report is the best word on what
-- was on rent at month end (a report by the month's end still wins). The same
-- rule as rentals_model.snapshotForMonth; the two views below are 0006's
-- v_rental_month and 0012's rental_month_lines with only the pick changed.

create or replace view public.v_rental_month as
with snaps as (
  -- two reports from one vendor as of the same day: the one recorded last stands
  select s.*, u.finalized_at from public.onrent_snapshots s join app.uploads_live u on u.id = s.upload_id
), span as (
  select workspace_id, vendor_key, date_trunc('month', min(as_of) - interval '7 days')::date as m0,
    greatest(date_trunc('month', max(as_of))::date, date_trunc('month', now())::date) as m1
  from snaps group by 1, 2
), months as (
  select sp.workspace_id, sp.vendor_key, gs::date as month
  from span sp cross join lateral generate_series(sp.m0, sp.m1, interval '1 month') gs
), pick as (
  select mo.*, coalesce(
    (select s.id from snaps s where s.workspace_id = mo.workspace_id and s.vendor_key = mo.vendor_key
       and s.as_of <= (mo.month + interval '1 month - 1 day')::date order by s.as_of desc, s.finalized_at desc nulls last limit 1),
    (select s.id from snaps s where s.workspace_id = mo.workspace_id and s.vendor_key = mo.vendor_key
       and s.as_of > (mo.month + interval '1 month - 1 day')::date and s.as_of <= (mo.month + interval '1 month - 1 day')::date + 7
       order by s.as_of asc, s.finalized_at desc nulls last limit 1)) as snapshot_id
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

create or replace view app.rental_month_lines as
with snaps as (
  select s.*, u.finalized_at from public.onrent_snapshots s join app.uploads_live u on u.id = s.upload_id
), span as (
  select workspace_id, vendor_key, date_trunc('month', min(as_of) - interval '7 days')::date as m0,
    greatest(date_trunc('month', max(as_of))::date, date_trunc('month', now())::date) as m1
  from snaps group by 1, 2
), months as (
  select sp.workspace_id, sp.vendor_key, gs::date as month from span sp cross join lateral generate_series(sp.m0, sp.m1, interval '1 month') gs
), pick as (
  select mo.*, coalesce(
    (select s.id from snaps s where s.workspace_id = mo.workspace_id and s.vendor_key = mo.vendor_key
       and s.as_of <= (mo.month + interval '1 month - 1 day')::date order by s.as_of desc, s.finalized_at desc nulls last limit 1),
    (select s.id from snaps s where s.workspace_id = mo.workspace_id and s.vendor_key = mo.vendor_key
       and s.as_of > (mo.month + interval '1 month - 1 day')::date and s.as_of <= (mo.month + interval '1 month - 1 day')::date + 7
       order by s.as_of asc, s.finalized_at desc nulls last limit 1)) as snapshot_id
  from months mo
)
select p.workspace_id, p.vendor_key, p.month, p.snapshot_id, s.as_of, coalesce(m.job_number, 'unmapped') as job_number,
  l.id as line_id, l.equipment_no, l.contract_no, l.vendor_job_ref, l.seq, l.description, l.qty, l.monthly_rent_cents, l.liberty_owned
from pick p
join snaps s on s.id = p.snapshot_id
join public.onrent_lines l on l.snapshot_id = p.snapshot_id
left join public.vendor_job_map m on m.workspace_id = l.workspace_id and m.vendor_key = p.vendor_key and m.vendor_job_ref = l.vendor_job_ref;
