-- 0003_uploads_labor.sql - every file recorded, and the labor lines read
-- from HH2 exports. Lines are written once by the RPCs in 0009 and never
-- edited; an upload is replaced by recording a newer one as its supersedent.
create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  kind app.upload_kind not null,
  source app.source not null default 'drop',
  sha256 bytea not null check (length(sha256) = 32),
  file_name text not null,
  byte_size int not null check (byte_size >= 0),
  storage_path text,
  vendor_key text,
  period daterange,
  as_of date,
  status app.upload_status not null default 'pending',
  summary jsonb not null default '{}'::jsonb,
  recorded_by uuid default auth.uid(),
  recorded_at timestamptz not null default now(),
  finalized_at timestamptz,
  superseded_by uuid references public.uploads,
  supersede_reason text,
  inbox_attachment_id uuid,
  unique (workspace_id, sha256)
);
create index uploads_ws_kind_idx on public.uploads (workspace_id, kind, status);

create table public.labor_lines (
  id bigserial primary key,
  workspace_id uuid not null references public.workspaces on delete cascade,
  upload_id uuid not null references public.uploads on delete cascade,
  row_index int not null,
  employee_number text not null,
  work_date date not null,
  payroll_group text,
  payroll_service_id text,
  job_number text not null,
  job_name text,
  child_job text,
  child_job_name text,
  cost_code text,
  cost_code_name text,
  pay_type text,
  pay_type_name text not null,
  hours numeric(9,2) not null,
  -- the Sunday on or after the work day (a Sunday stays)
  week_ending date generated always as (work_date + ((7 - extract(isodow from work_date)::int) % 7)) stored,
  unique (upload_id, row_index)                 -- no natural-key uniqueness: HH2's duplicates are real hours
);
create index labor_lines_ws_job_date_idx on public.labor_lines (workspace_id, job_number, work_date);
create index labor_lines_upload_idx on public.labor_lines (upload_id);
create trigger forbid before update or delete on public.labor_lines for each row execute function app.forbid();
