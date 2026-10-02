-- 0004_rentals.sql - one snapshot per on-rent report, one line per rental.
-- Identity = vendor + equipment + contract + the vendor's job label + seq
-- (non-serialised items repeat a line per unit). Which job a line belongs
-- to is looked up through vendor_job_map at read time, so mapping a vendor's
-- job name later re-files every line already recorded.
create table public.onrent_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  upload_id uuid not null unique references public.uploads on delete cascade,
  vendor_key text not null,
  layout text not null,
  as_of date not null,
  line_count int not null,
  rent_cents bigint not null
);
create index onrent_snapshots_idx on public.onrent_snapshots (workspace_id, vendor_key, as_of);

create table public.onrent_lines (
  id bigserial primary key,
  workspace_id uuid not null references public.workspaces on delete cascade,
  snapshot_id uuid not null references public.onrent_snapshots on delete cascade,
  row_index int not null,
  equipment_no text not null,
  contract_no text not null,
  vendor_job_ref text not null,
  seq int not null default 1,
  line_ref text,
  description text,
  qty numeric(9,2) not null default 1,
  on_rent_date date,
  rate_period text check (rate_period in ('day', 'week', '4week', 'month')),
  rate_cents bigint,
  monthly_rent_cents bigint,            -- null = the report carries no monthly figure; shown, never guessed
  day_rate_cents bigint, week_rate_cents bigint, fourweek_rate_cents bigint, month_rate_cents bigint,
  po text,
  est_return date,
  billed_through date,
  pickup_date date,
  liberty_owned boolean not null default false,
  cost_code text,
  raw jsonb not null default '{}'::jsonb,
  unique (snapshot_id, row_index),
  unique (snapshot_id, equipment_no, contract_no, vendor_job_ref, seq)
);
create index onrent_lines_ws_idx on public.onrent_lines (workspace_id, snapshot_id);
create index onrent_lines_identity_idx on public.onrent_lines (workspace_id, equipment_no, contract_no, vendor_job_ref, seq);
create trigger forbid before update or delete on public.onrent_lines for each row execute function app.forbid();
