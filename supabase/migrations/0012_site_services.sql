-- 0012_site_services.sql - what the site services add up to: how many
-- porta-potties, how many trailers (the sleeves under one contract make an
-- x-plex), how many storage containers, and what the dumpsters did. The
-- classification is app/site_services.js's, mirrored here; the dumpster
-- month takes Liberty's own log over the ledger wherever the log has
-- entries, and counts a haul a line where the hauler bills that way.

create type app.rental_class as (category text, kind text, section text, stations int, per_week int, sections int, size text, rr int, yards int);

create function app.classify_rental(p_description text) returns app.rental_class language plpgsql immutable as $$
declare d text; r app.rental_class; tok text;
begin
  d := upper(regexp_replace(btrim(coalesce(p_description, '')), '\s+', ' ', 'g'));
  r.category := 'other'; r.kind := 'other';
  if d = '' then r.kind := 'blank'; return r; end if;
  if d ~ '^SERVICE\y' or d ~ '^\d+X SERVICE\y' or d ~ '\ySERVICE OF\y' then
    r.category := 'service';
    r.kind := case when d ~ 'RESTROOM|RSTRM|\yRR\y|TOILET|HIGH RISE' then 'restroom' when d ~ 'SINK' then 'sink' when d ~ 'WASTE' then 'waste_tank'
                   when d ~ 'FRESH WATER|WATER' then 'fresh_water' when d ~ 'TRAILER|TRLR' then 'trailer' else 'other' end;
    r.per_week := (regexp_match(d, '(\d+)\s*X\y'))[1]::int;
    return r;
  end if;
  if d ~ 'CONTAINMENT TRAY|TRAILER STEPS|TRAILER STAIRS|TRAILER KIT|TRAILER AIR CONDITIONED|TRAILER HVAC|TEAR DOWN|^SETUP TRAILER|TRAILER MOUNTED|TOILET PAPER' then
    r.category := 'accessory'; r.kind := case when d ~ 'STEPS|STAIRS' then 'steps' when d ~ 'TRAY' then 'tray' when d ~ 'HVAC|AIR COND' then 'hvac' else 'other' end; return r;
  end if;
  if d ~ 'RESTROOM TRAILER|RESTROOM TRLR|(?<!NO )\yRR TRAILER\y|STATIC RESTROOM|RESTROOM CONTAINER' then
    r.category := 'restroom'; r.kind := case when d ~ 'CONTAINER' then 'container' when d ~ 'STATIC' then 'static' else 'trailer' end;
    r.stations := (regexp_match(d, '(\d+)\s*STATION'))[1]::int; return r;
  end if;
  if d ~ 'PORTABLE RESTROOM|PORTABLE TOILET|PORTABLE RR\y|\yTOILETS?\y|\yRESTROOM\y|\yRSTRM\y|PORTA.?JOHN|PORTA.?POTT' then
    r.category := 'restroom';
    r.kind := case when d ~ 'HIGH RISE' then 'high_rise' when d ~ 'ELEVATOR' then 'elevator_fit' when d ~ 'HANDICAP|\yADA\y' then 'handicap'
                   when d ~ 'ENHANCED|\yENH\y|DLX|DELUXE' then 'enhanced' when d ~ 'WOMEN' then 'womens' else 'standard' end;
    return r;
  end if;
  if d ~ '\ySINK\y|HAND ?WASH' then r.category := 'restroom'; r.kind := 'sink'; return r; end if;
  if d ~ 'HOLDING TANK|TANK HOLDING' then r.category := 'restroom'; r.kind := 'holding_tank'; return r; end if;
  if d ~ 'CONTAINER.*WASTE|WASTE & WATER' then r.category := 'restroom'; r.kind := 'waste_water_system'; return r; end if;
  if d ~ 'TANK' and d ~ 'ROLL' then r.kind := 'tank'; return r; end if;
  if d ~ 'DUMPSTER|ROLL[- ]?OFF|\yROS\y' then r.category := 'dumpster'; r.kind := 'roll_off'; r.yards := (regexp_match(d, '(\d+)\s*(?:YD|YARD)'))[1]::int; return r; end if;
  tok := (regexp_match(d, '\y(FRONT|FRNT|MIDDLE|MID|REAR|END)\y'))[1];
  if d ~ 'MODULAR|FAST (FRONT|MIDDLE|REAR|END)' and tok is not null and d !~ 'SHIELD|FENCE' then
    r.category := 'trailer'; r.kind := 'modular_section';
    r.section := case when tok in ('FRONT', 'FRNT') then 'front' when tok in ('MIDDLE', 'MID') then 'middle' else 'rear' end;
    r.rr := coalesce((regexp_match(d, 'W/?\s*(\d)\s*-?\s*RR'))[1]::int, 0); return r;
  end if;
  if d ~ '(\d+)\s*-?\s*PLEX' then r.category := 'trailer'; r.kind := 'modular_plex'; r.sections := (regexp_match(d, '(\d+)\s*-?\s*PLEX'))[1]::int; return r; end if;
  if d ~ 'MODULAR BLDG|MODULAR BUILDING' and d !~ 'SHIELD|FENCE' then
    r.category := 'trailer'; r.kind := 'modular'; r.size := (regexp_match(d, '(\d+X\d*)'))[1]; r.rr := coalesce((regexp_match(d, 'W/?\s*(\d)\s*-?\s*RR'))[1]::int, 0); return r;
  end if;
  if d ~ 'OFFICE TRAILER|NO RR TRAILER|TRAILER CUSTOM' then
    r.category := 'trailer'; r.kind := 'office'; r.size := (regexp_match(d, '(\d+X\d+)'))[1];
    r.rr := case when d ~ 'NO RR' then 0 else coalesce((regexp_match(d, 'W/?\s*(\d)\s*-?\s*RR'))[1]::int, case when d ~ 'RR' then 1 else 0 end) end; return r;
  end if;
  if d ~ 'OFFICE CONTAINER' then r.category := 'trailer'; r.kind := 'office_container'; r.size := (regexp_match(d, '(\d+X\d+)'))[1]; return r; end if;
  if d ~ 'STORAGE TRAILER' then r.category := 'storage'; r.kind := 'trailer'; r.size := (regexp_match(d, '(\d+)'''))[1]; return r; end if;
  if d ~ '^CONTAINER\y|STORAGE CONTAINER|CONEX' and d ~ '\d+\s*X\s*\d+|\d+''' then r.category := 'storage'; r.kind := 'container'; r.size := (regexp_match(d, '(\d+X\d+)'))[1]; return r; end if;
  if d ~ '\yTRAILERS?\y' then
    if d ~ 'EQUIP|TILT|TANK|WATER|FLATBED|DUMP|UTILITY|CARGO|ON TRAILER|LIGHT TOWER|WASHER|TRAILER MOUNT' then r.kind := 'equipment_trailer'; return r; end if;
    if d ~ '\d+X\d+' then r.category := 'trailer'; r.kind := 'office'; r.size := (regexp_match(d, '(\d+X\d+)'))[1]; r.rr := case when d ~ 'NO RR' then 0 when d ~ 'RR' then 1 else 0 end; return r; end if;
    r.category := 'trailer'; r.kind := 'unspecified'; return r;
  end if;
  return r;
end $$;

-- the lines of the snapshot that stands for each vendor and month, with the job each line belongs to (the same pick as v_rental_month)
create view app.rental_month_lines as
with snaps as (
  select s.*, u.finalized_at from public.onrent_snapshots s join app.uploads_live u on u.id = s.upload_id
), span as (
  select workspace_id, vendor_key, date_trunc('month', min(as_of))::date as m0,
    greatest(date_trunc('month', max(as_of))::date, date_trunc('month', now())::date) as m1
  from snaps group by 1, 2
), months as (
  select sp.workspace_id, sp.vendor_key, gs::date as month from span sp cross join lateral generate_series(sp.m0, sp.m1, interval '1 month') gs
), pick as (
  select mo.*, (select s.id from snaps s where s.workspace_id = mo.workspace_id and s.vendor_key = mo.vendor_key
                  and s.as_of <= (mo.month + interval '1 month - 1 day')::date order by s.as_of desc, s.finalized_at desc nulls last limit 1) as snapshot_id
  from months mo
)
select p.workspace_id, p.vendor_key, p.month, p.snapshot_id, s.as_of, coalesce(m.job_number, 'unmapped') as job_number,
  l.id as line_id, l.equipment_no, l.contract_no, l.vendor_job_ref, l.seq, l.description, l.qty, l.monthly_rent_cents, l.liberty_owned
from pick p
join snaps s on s.id = p.snapshot_id
join public.onrent_lines l on l.snapshot_id = p.snapshot_id
left join public.vendor_job_map m on m.workspace_id = l.workspace_id and m.vendor_key = p.vendor_key and m.vendor_job_ref = l.vendor_job_ref;

-- the counts: per job, month, vendor, category and kind (and size, restrooms and so on), as app/site_services.js counts them
create view public.v_site_services_month as
select x.workspace_id, x.job_number, x.month, x.vendor_key, (x.c).category, (x.c).kind, (x.c).section, (x.c).size, coalesce((x.c).rr, 0) as rr, (x.c).yards,
  sum(x.qty)::numeric as units, count(*)::int as lines, coalesce(sum(x.monthly_rent_cents), 0)::bigint as rent_cents,
  sum(coalesce((x.c).stations, 0) * x.qty)::int as stations, max((x.c).per_week) as per_week
from (select l.*, app.classify_rental(l.description) as c from app.rental_month_lines l) x
where (x.c).category <> 'other' and app.is_member(x.workspace_id)
group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10;

-- the sleeves under one contract: complexes = the fronts that have a rear; sections per complex; a mismatch is flagged, never guessed
create view public.v_trailer_plex_month as
with sec as (
  select l.workspace_id, l.job_number, l.month, l.vendor_key, l.contract_no, (l.c).section, (l.c).kind, (l.c).sections as whole, l.qty
  from (select l.*, app.classify_rental(l.description) as c from app.rental_month_lines l) l
  where (l.c).category = 'trailer' and (l.c).kind in ('modular_section', 'modular_plex')
), sections as (
  select workspace_id, job_number, month, vendor_key, contract_no,
    coalesce(sum(qty) filter (where section = 'front'), 0)::int as fronts, coalesce(sum(qty) filter (where section = 'middle'), 0)::int as middles, coalesce(sum(qty) filter (where section = 'rear'), 0)::int as rears
  from sec where kind = 'modular_section' group by 1, 2, 3, 4, 5
), whole as (
  select workspace_id, job_number, month, vendor_key, contract_no, whole as sections, sum(qty)::int as complexes from sec where kind = 'modular_plex' group by 1, 2, 3, 4, 5, 6
)
select s.workspace_id, s.job_number, s.month, s.vendor_key, s.contract_no, s.fronts, s.middles, s.rears, least(s.fronts, s.rears) as complexes,
  case when least(s.fronts, s.rears) > 0 then round((s.fronts + s.middles + s.rears)::numeric / least(s.fronts, s.rears))::int end as sections,
  (s.fronts <> s.rears) as mismatch, false as whole
from sections s where app.is_member(s.workspace_id)
union all
select w.workspace_id, w.job_number, w.month, w.vendor_key, w.contract_no, w.complexes, w.complexes * (w.sections - 2), w.complexes, w.complexes, w.sections, false, true
from whole w where app.is_member(w.workspace_id);

-- the haulers: who bills a pull at a time, who bills a lump
create table public.waste_vendors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  pattern text not null,                   -- matched inside the vendor's name on the ledger and in the log: "sourgum"
  name text,
  bills_per_haul boolean not null default false,
  haul_rate_cents int,
  container_yd int,
  note text,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, pattern)
);
create trigger audit after insert or update or delete on public.waste_vendors for each row execute function app.audit();
create trigger touch before update on public.waste_vendors for each row execute function app.touch();

-- Liberty's own dumpster log: what the field knows that no vendor dashboard tells us
create table public.dumpster_pulls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  job_number text not null,
  pull_date date not null,
  vendor_name text not null,
  container_yd int,
  pulls int not null default 1 check (pulls > 0),
  ticket_no text,
  tonnage numeric(8, 2),
  cost_cents bigint,
  note text,
  entered_by uuid default auth.uid(),
  entered_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create index dumpster_pulls_idx on public.dumpster_pulls (workspace_id, job_number, pull_date);
create trigger audit after insert or update or delete on public.dumpster_pulls for each row execute function app.audit();
create trigger touch before update on public.dumpster_pulls for each row execute function app.touch();

alter table public.waste_vendors enable row level security;
alter table public.dumpster_pulls enable row level security;
do $$ declare t text; begin
  foreach t in array array['waste_vendors', 'dumpster_pulls'] loop
    execute format('create policy %I_select on public.%I for select using (app.is_member(workspace_id))', t, t);
    execute format('create policy %I_insert on public.%I for insert with check (app.can_edit(workspace_id))', t, t);
    execute format('create policy %I_update on public.%I for update using (app.can_edit(workspace_id)) with check (app.can_edit(workspace_id))', t, t);
    execute format('create policy %I_delete on public.%I for delete using (app.can_edit(workspace_id))', t, t);
  end loop;
end $$;

-- pulls per job, month and hauler: the log where it has entries, else one haul a line where the hauler bills that way, else spend only
create view public.v_dumpster_month as
with wv as (select id, workspace_id, pattern, name, bills_per_haul, container_yd from public.waste_vendors),
ledger as (
  select l.workspace_id, l.job_number, date_trunc('month', l.trans_date)::date as month, w.id as waste_vendor_id, w.bills_per_haul, w.container_yd,
    max(l.vendor_name) as vendor_name, sum(case when l.amount_cents > 0 then 1 when l.amount_cents < 0 then -1 else 0 end)::int as haul_lines,
    count(*)::int as ledger_lines, sum(l.amount_cents)::bigint as ledger_cents
  from app.jctd_live l join wv w on w.workspace_id = l.workspace_id and position(lower(w.pattern) in lower(coalesce(l.vendor_name, ''))) > 0
  where l.trans_type = 'AP cost' group by 1, 2, 3, 4, 5, 6
), lg as (
  select p.workspace_id, p.job_number, date_trunc('month', p.pull_date)::date as month, w.id as waste_vendor_id, coalesce(w.pattern, lower(p.vendor_name)) as pattern, w.bills_per_haul,
    max(p.vendor_name) as vendor_name, sum(p.pulls)::int as pulls, count(*)::int as entries, sum(p.cost_cents)::bigint as log_cost_cents, sum(p.tonnage) as tonnage, max(p.container_yd) as container_yd
  from public.dumpster_pulls p left join wv w on w.workspace_id = p.workspace_id and position(lower(w.pattern) in lower(p.vendor_name)) > 0
  group by 1, 2, 3, 4, 5, 6
)
select coalesce(g.workspace_id, l.workspace_id) as workspace_id, coalesce(g.job_number, l.job_number) as job_number, coalesce(g.month, l.month) as month,
  coalesce(g.waste_vendor_id, l.waste_vendor_id) as waste_vendor_id, coalesce(g.vendor_name, l.vendor_name) as vendor_name,
  case when coalesce(g.entries, 0) > 0 then 'log' when l.bills_per_haul then 'ledger' else 'spend' end as source,
  case when coalesce(g.entries, 0) > 0 then g.pulls when l.bills_per_haul then l.haul_lines else null end as pulls,
  coalesce(g.entries, 0) as entries, coalesce(l.haul_lines, 0) as haul_lines, coalesce(l.ledger_lines, 0) as ledger_lines, coalesce(l.ledger_cents, 0) as ledger_cents,
  coalesce(g.log_cost_cents, 0) as log_cost_cents, g.tonnage, coalesce(g.container_yd, l.container_yd) as container_yd
from lg g
full join ledger l on l.workspace_id = g.workspace_id and l.job_number = g.job_number and l.month = g.month and l.waste_vendor_id = g.waste_vendor_id
where app.is_member(coalesce(g.workspace_id, l.workspace_id));

grant select on public.v_site_services_month, public.v_trailer_plex_month, public.v_dumpster_month to authenticated, service_role;

-- the recurring charges again, now without the haulers
create or replace view app.recurring_candidates as
with eq as (
  select l.workspace_id, l.job_number, coalesce(nullif(l.vendor_code, ''), case when l.trans_type = 'IV cost' then 'LIBERTY' end) as vendor,
    l.vendor_name, l.trans_type, l.cost_code, coalesce(l.invoice, '') as invoice, app.norm_desc(l.description) as line, abs(l.amount_cents) as amt, l.amount_cents, l.trans_date, l.row_index
  from app.jctd_live l
  where l.trans_type in ('AP cost', 'IV cost') and l.cat = 'EQU' and l.amount_cents <> 0
    -- a hauler that invoices one pull at a time is not a rental: those lines are the dumpster month's
    and not exists (select 1 from public.waste_vendors w where w.workspace_id = l.workspace_id and position(lower(w.pattern) in lower(coalesce(l.vendor_name, ''))) > 0)
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
