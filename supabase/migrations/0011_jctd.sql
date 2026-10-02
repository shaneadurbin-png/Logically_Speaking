-- 0011_jctd.sql - the Job Cost To Date feed: every transaction on a job as
-- Sage holds it, the recurring charges found on it, and the ones an editor
-- has confirmed as monthly rentals (the rentals no on-rent report covers).
--
-- The latest JCTD per job stands for all of its history: it is cumulative.
-- Lines are editors' (a payroll line carries an employee number); the
-- candidates and the confirmed charges carry vendors and equipment, so
-- every member sees them. The rules in app.recurring_candidates are the
-- ones in app/recurring_model.js; tests/db holds the two to each other.

create table public.jctd_lines (
  id bigserial primary key,
  workspace_id uuid not null references public.workspaces on delete cascade,
  upload_id uuid not null references public.uploads on delete cascade,
  row_index int not null,
  job_number text not null,
  cost_code text,
  cost_code_name text,
  cat text,
  trans_type text not null check (trans_type in ('PR cost', 'AP cost', 'JC cost', 'IV cost')),
  period_end date,
  trans_date date not null,
  acct_date date,
  date_stamp date,
  units numeric(14, 4),
  unit_cost_cents bigint,
  amount_cents bigint not null,
  pay_id text,
  employee_number text,
  batch text,
  vendor_code text,
  vendor_name text,
  invoice text,
  item text,
  description text,                      -- blank on payroll rows: the name lives in employees
  unique (upload_id, row_index)
);
create index jctd_lines_idx on public.jctd_lines (workspace_id, job_number, trans_date);
create trigger forbid before update or delete on public.jctd_lines for each row execute function app.forbid();

-- a charge confirmed as a monthly rental: counted every month it is in force
create table public.recurring_charges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  job_number text not null,
  candidate_key text,                    -- job|vendor|line|amount, as app.recurring_candidates names it; null when typed in by hand
  vendor_code text,
  vendor_name text not null,
  description text not null,
  cost_code text,
  monthly_cents bigint not null check (monthly_cents >= 0),
  units int not null default 1 check (units >= 1),
  liberty_owned boolean not null default false,       -- rent only, no markup
  amount_includes_tax boolean not null default true,  -- an invoiced amount already carries the tax
  start_month date not null check (start_month = date_trunc('month', start_month)::date),
  end_month date check (end_month is null or (end_month = date_trunc('month', end_month)::date and end_month >= start_month)),
  source text not null default 'jctd' check (source in ('jctd', 'po', 'manual')),
  note text,
  confirmed_by uuid default auth.uid(),
  confirmed_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create index recurring_charges_idx on public.recurring_charges (workspace_id, job_number);
create trigger audit after insert or update or delete on public.recurring_charges for each row execute function app.audit();
create trigger touch before update on public.recurring_charges for each row execute function app.touch();

-- "not a rental": a candidate an editor set aside, so it does not come back
create table public.recurring_dismissals (
  workspace_id uuid not null references public.workspaces on delete cascade,
  job_number text not null,
  candidate_key text not null,
  reason text not null,
  decided_by uuid default auth.uid(),
  decided_at timestamptz not null default now(),
  primary key (workspace_id, job_number, candidate_key)
);
create trigger audit after insert or update or delete on public.recurring_dismissals for each row execute function app.audit();

alter table public.jctd_lines enable row level security;
alter table public.recurring_charges enable row level security;
alter table public.recurring_dismissals enable row level security;
create policy jctd_lines_select on public.jctd_lines for select using (app.can_edit(workspace_id));
create policy recurring_charges_select on public.recurring_charges for select using (app.is_member(workspace_id));
create policy recurring_charges_insert on public.recurring_charges for insert with check (app.can_edit(workspace_id));
create policy recurring_charges_update on public.recurring_charges for update using (app.can_edit(workspace_id)) with check (app.can_edit(workspace_id));
create policy recurring_charges_delete on public.recurring_charges for delete using (app.can_edit(workspace_id));
create policy recurring_dismissals_select on public.recurring_dismissals for select using (app.is_member(workspace_id));
create policy recurring_dismissals_insert on public.recurring_dismissals for insert with check (app.can_edit(workspace_id));
create policy recurring_dismissals_delete on public.recurring_dismissals for delete using (app.can_edit(workspace_id));

-- the lines of the latest recorded JCTD per job
create view app.jctd_live as
  with latest as (
    select distinct on (workspace_id, summary ->> 'job_number') id
    from app.uploads_live where kind = 'jctd'
    order by workspace_id, summary ->> 'job_number', as_of desc nulls last, finalized_at desc, id)
  select l.* from public.jctd_lines l join latest u on u.id = l.upload_id;

-- "POLARIS RANGER C~1M03/29-04/25" -> "POLARIS RANGER C~1M"; "(Rev)26-004809" -> "26-004809"; same as RecurringModel.normDesc
create function app.norm_desc(s text) returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(upper(btrim(coalesce(s, ''))),
    '^\(REV\)\s*', ''), '\d{1,2}/\d{1,2}(/\d{2,4})?\s*-\s*\d{1,2}/\d{1,2}(/\d{2,4})?', ' ', 'g'), '\m\d{1,2}/\d{1,2}/\d{2,4}\M', ' ', 'g'), '\s+', ' ', 'g'))
$$;
create function app.month_index(d date) returns int language sql immutable as $$ select (extract(year from d) * 12 + extract(month from d))::int $$;

-- the charges that come back every month: equipment lines (vendor invoices and Liberty's internal charges) with one exact
-- amount, in two or more months with at most one month missing; reversals net against the earliest charge on the invoice
create view app.recurring_candidates as
with eq as (
  select l.workspace_id, l.job_number, coalesce(nullif(l.vendor_code, ''), case when l.trans_type = 'IV cost' then 'LIBERTY' end) as vendor,
    l.vendor_name, l.trans_type, l.cost_code, coalesce(l.invoice, '') as invoice, app.norm_desc(l.description) as line, abs(l.amount_cents) as amt, l.amount_cents, l.trans_date, l.row_index
  from app.jctd_live l
  where l.trans_type in ('AP cost', 'IV cost') and l.cat = 'EQU' and l.amount_cents <> 0
), credits as (
  select workspace_id, job_number, vendor, invoice, line, amt, count(*) as n from eq where amount_cents < 0 group by 1, 2, 3, 4, 5, 6
), kept as (
  select e.* from (
    select e.*, row_number() over (partition by e.workspace_id, e.job_number, e.vendor, e.invoice, e.line, e.amt order by e.trans_date, e.row_index) as rn
    from eq e where e.amount_cents > 0 and e.vendor is not null) e
  left join credits c on c.workspace_id = e.workspace_id and c.job_number = e.job_number and c.vendor = e.vendor and c.invoice = e.invoice and c.line = e.line and c.amt = e.amt
  where e.rn > coalesce(c.n, 0)
), by_month as (
  select workspace_id, job_number, vendor, line, amt as amount_cents, date_trunc('month', trans_date)::date as month, count(*) as n,
    min(trans_date) as first_date, max(trans_date) as last_date, max(vendor_name) as vendor_name, bool_or(trans_type = 'IV cost') as liberty_owned, min(cost_code) as cost_code
  from kept group by 1, 2, 3, 4, 5, 6
), grouped as (
  select workspace_id, job_number, vendor, line, amount_cents,
    count(*)::int as months_seen, min(month) as first_month, max(month) as last_month, sum(n)::int as lines, max(n)::int as max_n,
    (array_agg(n::int order by month desc))[1] as units, min(first_date) as first_date, max(last_date) as last_date,
    max(vendor_name) as vendor_name, bool_or(liberty_owned) as liberty_owned, min(cost_code) as cost_code,
    array_agg(to_char(month, 'YYYY-MM') order by month) as months
  from by_month group by 1, 2, 3, 4, 5
), latest as (
  select workspace_id, job_number, date_trunc('month', max(trans_date))::date as latest_month from eq group by 1, 2
)
select g.workspace_id, g.job_number, g.job_number || '|' || g.vendor || '|' || g.line || '|' || g.amount_cents as key, g.vendor as vendor_code,
  coalesce(nullif(g.vendor_name, ''), case when g.vendor = 'LIBERTY' then 'Liberty-owned (internal)' else g.vendor end) as vendor_name,
  g.line as description, g.cost_code, g.amount_cents, g.units, g.amount_cents * g.units as monthly_cents, g.months, g.months_seen, g.first_month, g.last_month,
  g.first_date, g.last_date, g.lines, g.liberty_owned,
  (not g.liberty_owned and exists (select 1 from public.vendors v where v.workspace_id = g.workspace_id and v.feed in ('onrent', 'both')
     and position(lower(v.name) in lower(coalesce(g.vendor_name, ''))) > 0)) as on_feed,
  app.month_index(lm.latest_month) - app.month_index(g.last_month) <= 1 as current
from grouped g
join latest lm on lm.workspace_id = g.workspace_id and lm.job_number = g.job_number
where g.months_seen >= 2
  and (app.month_index(g.last_month) - app.month_index(g.first_month) + 1) - g.months_seen <= 1
  and g.max_n <= g.units * 2;

-- what still waits for a decision: not confirmed, not set aside
create view public.v_recurring_candidates as
  select c.* from app.recurring_candidates c
  where app.is_member(c.workspace_id)
    and not exists (select 1 from public.recurring_charges r where r.workspace_id = c.workspace_id and r.job_number = c.job_number and r.candidate_key = c.key)
    and not exists (select 1 from public.recurring_dismissals d where d.workspace_id = c.workspace_id and d.job_number = c.job_number and d.candidate_key = c.key);

-- a confirmed charge, month by month while in force: markup on the amount under the job's rule; tax only when the amount
-- does not already carry it; Liberty-owned is rent only
create view public.v_recurring_month as
with span as (
  select r.*, generate_series(r.start_month, least(coalesce(r.end_month, date_trunc('month', now())::date), date_trunc('month', now())::date), interval '1 month')::date as month
  from public.recurring_charges r
), priced as (
  select s.*, j.id as job_id, coalesce(j.markup_base, 'rent_plus_tax') as markup_base, coalesce(j.markup_bp, 0) as markup_bp,
    case when not s.amount_includes_tax and j.id is not null then round((s.monthly_cents * j.tax_bp)::numeric / 10000)::bigint else 0 end as tax_cents
  from span s left join public.jobs j on j.workspace_id = s.workspace_id and j.job_number = s.job_number
)
select p.workspace_id, p.job_number, p.month, p.id as charge_id, p.candidate_key, p.vendor_code, p.vendor_name, p.description, p.cost_code, p.units, p.liberty_owned, p.amount_includes_tax,
  p.start_month, p.end_month, p.source, p.monthly_cents as rent_cents, p.tax_cents,
  case when p.liberty_owned then 0 else round(((p.monthly_cents + case when p.markup_base = 'rent_plus_tax' then p.tax_cents else 0 end) * p.markup_bp)::numeric / 10000)::bigint end as markup_cents,
  p.monthly_cents + p.tax_cents + case when p.liberty_owned then 0 else round(((p.monthly_cents + case when p.markup_base = 'rent_plus_tax' then p.tax_cents else 0 end) * p.markup_bp)::numeric / 10000)::bigint end as total_cents
from priced p
where app.is_member(p.workspace_id);

-- the tiles, again: rentals gain the confirmed recurring charges; purchases are the material POs (a rental PO is a
-- commitment to a rental vendor, the rental itself is on a feed or a recurring charge)
drop view public.v_month_buckets;
drop view public.v_job_month;
create view public.v_job_month as
with l as (
  select workspace_id, job_number, month, cost_cents as labor_cents, hours as labor_hours, held_hours as labor_held_hours, held_rows as labor_held_rows, through as labor_through
  from public.v_labor_job_month
), r as (
  select workspace_id, job_number, month, sum(total_cents)::bigint as rental_cents, sum(liberty_owned_cents)::bigint as rental_lo_cents,
    sum(lines)::int as rental_lines, sum(no_monthly)::int as rental_no_monthly, max(as_of) as rental_as_of
  from public.v_rental_month where job_number <> 'unmapped' group by 1, 2, 3
), o as (
  select workspace_id, job_number, month, sum(total_cents)::bigint as offfeed_cents, count(*)::int as offfeed_lines
  from public.v_recurring_month group by 1, 2, 3
), p as (
  select workspace_id, job_number, month,
    coalesce(sum(amount_cents) filter (where status in ('auto', 'confirmed') and direction = 'cost' and order_type is distinct from 'Rental'), 0)::bigint as purchase_cents,
    coalesce(sum(amount_cents) filter (where status in ('auto', 'confirmed') and direction = 'cost' and order_type = 'Rental'), 0)::bigint as purchase_rental_cents,
    coalesce(sum(amount_cents) filter (where status in ('auto', 'confirmed') and direction = 'cost' and order_type is distinct from 'Rental' and bucket = 'NON_BILLABLE'), 0)::bigint as purchase_nb_cents,
    coalesce(sum(amount_cents) filter (where status = 'needs_decision' and direction = 'cost'), 0)::bigint as pending_cents,
    coalesce(sum(lines) filter (where status = 'needs_decision'), 0)::int as pending_lines
  from public.v_purchase_month group by 1, 2, 3
), k as (
  select workspace_id, job_number, month from l union select workspace_id, job_number, month from r
  union select workspace_id, job_number, month from o union select workspace_id, job_number, month from p
)
select k.workspace_id, k.job_number, k.month,
  coalesce(l.labor_cents, 0) as labor_cents, coalesce(l.labor_hours, 0) as labor_hours, coalesce(l.labor_held_hours, 0) as labor_held_hours,
  coalesce(l.labor_held_rows, 0) as labor_held_rows, l.labor_through,
  coalesce(r.rental_cents, 0) as rental_cents, coalesce(r.rental_lo_cents, 0) as rental_lo_cents, coalesce(r.rental_lines, 0) as rental_lines,
  coalesce(r.rental_no_monthly, 0) as rental_no_monthly, r.rental_as_of,
  coalesce(o.offfeed_cents, 0) as offfeed_cents, coalesce(o.offfeed_lines, 0) as offfeed_lines,
  coalesce(p.purchase_cents, 0) as purchase_cents, coalesce(p.purchase_rental_cents, 0) as purchase_rental_cents, coalesce(p.purchase_nb_cents, 0) as purchase_nb_cents,
  coalesce(p.pending_cents, 0) as pending_cents, coalesce(p.pending_lines, 0) as pending_lines,
  coalesce(l.labor_cents, 0) + coalesce(r.rental_cents, 0) + coalesce(r.rental_lo_cents, 0) + coalesce(o.offfeed_cents, 0) + coalesce(p.purchase_cents, 0) as total_cents
from k
left join l on l.workspace_id = k.workspace_id and l.job_number = k.job_number and l.month = k.month
left join r on r.workspace_id = k.workspace_id and r.job_number = k.job_number and r.month = k.month
left join o on o.workspace_id = k.workspace_id and o.job_number = k.job_number and o.month = k.month
left join p on p.workspace_id = k.workspace_id and p.job_number = k.job_number and p.month = k.month;

create view public.v_month_buckets as
  select workspace_id, job_number, month, 'LABOR'::app.bucket as bucket, cost_cents as cents from public.v_labor_job_month
  union all
  select workspace_id, job_number, month, 'EQUIPMENT'::app.bucket, sum(total_cents)::bigint from public.v_rental_month where job_number <> 'unmapped' group by 1, 2, 3
  union all
  select workspace_id, job_number, month, 'EQUIPMENT'::app.bucket, sum(total_cents)::bigint from public.v_recurring_month group by 1, 2, 3
  union all
  select workspace_id, job_number, month, bucket, sum(amount_cents)::bigint from public.v_purchase_month
  where bucket is not null and status in ('auto', 'confirmed') and direction = 'cost' and order_type is distinct from 'Rental' group by 1, 2, 3, 4;

create or replace view public.v_freshness as
  select w.id as workspace_id,
    (select max(upper(u.period) - 1) from app.uploads_live u where u.workspace_id = w.id and u.kind = 'hh2_labor') as hh2_through,
    (select max(u.recorded_at) from app.uploads_live u where u.workspace_id = w.id and u.kind = 'hh2_labor') as hh2_recorded_at,
    (select coalesce(jsonb_object_agg(x.vendor_key, x.as_of), '{}'::jsonb) from (
       select s.vendor_key, max(s.as_of) as as_of from public.onrent_snapshots s join app.uploads_live u on u.id = s.upload_id
       where s.workspace_id = w.id group by 1) x) as onrent_as_of,
    (select max(u.as_of) from app.uploads_live u where u.workspace_id = w.id and u.kind = 'purchase_orders') as po_as_of,
    (select max(received_at) from public.inbox_messages m where m.workspace_id = w.id) as last_inbox_at,
    (select count(*) from public.inbox_messages m where m.workspace_id = w.id and m.parse_status in ('pending', 'needs_decision')) as inbox_pending,
    (select count(*) from app.uploads_live u where u.workspace_id = w.id) as uploads_live,
    (select max(upper(u.period) - 1) from app.uploads_live u where u.workspace_id = w.id and u.kind = 'jctd') as jctd_through,
    (select count(distinct u.summary ->> 'job_number') from app.uploads_live u where u.workspace_id = w.id and u.kind = 'jctd') as jctd_jobs
  from public.workspaces w
  where app.is_member(w.id);

grant select on public.v_recurring_candidates, public.v_recurring_month, public.v_job_month, public.v_month_buckets, public.v_freshness to authenticated, service_role;

-- the RPCs: lines in batches while pending, then the recount
create function public.append_jctd_lines(p_upload uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare u public.uploads; n int;
begin
  u := app.pending_upload(p_upload, 'jctd');
  insert into public.jctd_lines (workspace_id, upload_id, row_index, job_number, cost_code, cost_code_name, cat, trans_type, period_end, trans_date, acct_date, date_stamp,
    units, unit_cost_cents, amount_cents, pay_id, employee_number, batch, vendor_code, vendor_name, invoice, item, description)
  select u.workspace_id, p_upload, r.row_index, r.job_number, r.cost_code, r.cost_code_name, r.cat, r.trans_type, r.period_end, r.trans_date, r.acct_date, r.date_stamp,
    r.units, r.unit_cost_cents, r.amount_cents, r.pay_id, r.employee_number, r.batch, r.vendor_code, r.vendor_name, r.invoice, r.item, coalesce(r.description, '')
  from jsonb_to_recordset(p_rows) as r(row_index int, job_number text, cost_code text, cost_code_name text, cat text, trans_type text, period_end date, trans_date date, acct_date date, date_stamp date,
    units numeric, unit_cost_cents bigint, amount_cents bigint, pay_id text, employee_number text, batch text, vendor_code text, vendor_name text, invoice text, item text, description text);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.finalize_upload(p_upload uuid, p_expect jsonb, p_supersede jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u public.uploads; n bigint; h bigint; c bigint; ov jsonb := '[]'::jsonb; old uuid; reason text;
begin
  u := app.pending_upload(p_upload, null);
  if u.kind = 'hh2_labor' then
    select count(*), coalesce(sum(round(hours * 100)), 0) into n, h from public.labor_lines where upload_id = p_upload;
    if n <> (p_expect ->> 'rows')::bigint or h <> (p_expect ->> 'hours_x100')::bigint then
      raise exception 'conservation: the file says % rows and % hundredths of an hour; the database holds % and %. Not recorded.', p_expect ->> 'rows', p_expect ->> 'hours_x100', n, h;
    end if;
    ov := app.hh2_overlaps(u.workspace_id, p_upload, u.period, (select coalesce(jsonb_agg(distinct employee_number), '[]'::jsonb) from public.labor_lines where upload_id = p_upload));
  elsif u.kind = 'onrent' then
    select count(*), coalesce(sum(monthly_rent_cents), 0) into n, c from public.onrent_lines l join public.onrent_snapshots s on s.id = l.snapshot_id where s.upload_id = p_upload;
    if n <> (p_expect ->> 'lines')::bigint or c <> (p_expect ->> 'rent_cents')::bigint then
      raise exception 'conservation: the file says % lines and % cents of rent; the database holds % and %. Not recorded.', p_expect ->> 'lines', p_expect ->> 'rent_cents', n, c;
    end if;
    update public.onrent_snapshots set line_count = n, rent_cents = c where upload_id = p_upload;
  elsif u.kind = 'purchase_orders' then
    select count(*), coalesce(sum(total_cents) filter (where not cancelled and not quote), 0) into n, c from public.purchase_docs where upload_id = p_upload;
    if n <> (p_expect ->> 'pos')::bigint or c <> (p_expect ->> 'committed_cents')::bigint then
      raise exception 'conservation: the file says % POs and % cents committed; the database holds % and %. Not recorded.', p_expect ->> 'pos', p_expect ->> 'committed_cents', n, c;
    end if;
  elsif u.kind = 'jctd' then
    select count(*), coalesce(sum(amount_cents), 0) into n, c from public.jctd_lines where upload_id = p_upload;
    if n <> (p_expect ->> 'rows')::bigint or c <> (p_expect ->> 'amount_cents')::bigint then
      raise exception 'conservation: the file says % rows and % cents; the database holds % and %. Not recorded.', p_expect ->> 'rows', p_expect ->> 'amount_cents', n, c;
    end if;
  elsif u.kind = 'projects' then
    null;   -- jobs are upserted by the page under RLS; the upload is the file's record
  elsif u.kind = 'sage_rates' then
    null;   -- recorded by import_rate_tables below
  else
    raise exception 'finalize_upload does not record % files yet', u.kind;
  end if;

  if jsonb_array_length(ov) > 0 then
    if p_supersede is null or coalesce(p_supersede ->> 'reason', '') = '' then
      raise exception 'overlaps % file(s) on file for the same people and dates (%). Record it as their replacement, with a reason, or not at all.',
        jsonb_array_length(ov), (select string_agg(x ->> 'file_name', ', ') from jsonb_array_elements(ov) x);
    end if;
    reason := p_supersede ->> 'reason';
    for old in select (x ->> 'upload_id')::uuid from jsonb_array_elements(ov) x loop
      update public.uploads set status = 'superseded', superseded_by = p_upload, supersede_reason = reason
      where id = old and workspace_id = u.workspace_id and status = 'recorded';
    end loop;
  end if;
  update public.uploads set status = 'recorded', finalized_at = clock_timestamp(), summary = summary || p_expect where id = p_upload;
  select * into u from public.uploads where id = p_upload;
  return app.upload_json(u) || jsonb_build_object('superseded', ov);
end $$;
