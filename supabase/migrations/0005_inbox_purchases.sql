-- 0005_inbox_purchases.sql - the purchases feed and the inbox it mostly
-- arrives through. Created now so the schema is whole; filled from the
-- release that reads tickets and emails.
create table public.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  raw_sha256 bytea not null check (length(raw_sha256) = 32),
  message_id text,
  storage_path text not null,
  from_addr citext,
  to_addrs text[] not null default '{}',
  cc_addrs text[] not null default '{}',
  subject text,
  sent_at timestamptz,
  received_at timestamptz not null default now(),
  auth_results text,
  sender_allowed boolean not null default false,
  size_bytes int,
  attachment_count int not null default 0,
  parse_status text not null default 'pending'
    check (parse_status in ('pending', 'parsed', 'needs_decision', 'refused', 'nothing_to_parse', 'quarantined', 'duplicate')),
  parsed_at timestamptz,
  parsed_by uuid,
  parse_note text,
  unique (workspace_id, raw_sha256)
);
create unique index inbox_messages_msgid_idx on public.inbox_messages (workspace_id, message_id) where message_id is not null;

create table public.inbox_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  message_id uuid not null references public.inbox_messages on delete cascade,
  file_name text,
  content_type text,
  byte_size int,
  sha256 bytea not null check (length(sha256) = 32),
  storage_path text not null,
  upload_id uuid references public.uploads,
  result text,
  unique (workspace_id, message_id, sha256)
);

create table public.purchase_docs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  upload_id uuid references public.uploads,
  source app.source not null,
  direction text not null default 'cost' check (direction in ('cost', 'revenue')),
  vendor_key text,
  vendor_name_raw text,
  doc_kind text not null check (doc_kind in ('sales_ticket', 'order_confirmation', 'purchase_order', 'invoice', 'billing', 'form')),
  doc_number text,
  doc_date date,
  job_number text,
  cost_code text,
  description text,
  order_type text,                          -- Purchase Pro: Material, Rental
  bucket app.bucket,                        -- as read (NON_BILLABLE when the description says so); a decision can override
  cancelled boolean not null default false,
  quote boolean not null default false,
  subtotal_cents bigint,
  tax_cents bigint,
  total_cents bigint,                       -- null = no amount yet (Sage has not committed it)
  row_index int,
  raw jsonb not null default '{}'::jsonb,
  status app.line_status not null,
  refusal text,
  note text,
  photo_path text,
  entered_by uuid default auth.uid(),
  entered_at timestamptz not null default now(),
  superseded_by uuid references public.purchase_docs
);
create index purchase_docs_ws_idx on public.purchase_docs (workspace_id, job_number, doc_date);
create index purchase_docs_upload_idx on public.purchase_docs (upload_id);
create trigger forbid_docs before update or delete on public.purchase_docs for each row execute function app.forbid();

create table public.purchase_lines (
  id bigserial primary key,
  workspace_id uuid not null references public.workspaces on delete cascade,
  doc_id uuid not null references public.purchase_docs on delete cascade,
  line_no int not null,
  description text,
  qty numeric(12,3),
  uom text,
  unit_cents bigint,
  amount_cents bigint not null,
  cost_code text,
  job_number text,
  status app.line_status not null,
  unique (doc_id, line_no)
);
create trigger forbid before update or delete on public.purchase_lines for each row execute function app.forbid();

-- A decision never edits a line; the latest decision for a line (or its doc) wins.
create table public.purchase_decisions (
  id bigserial primary key,
  workspace_id uuid not null references public.workspaces on delete cascade,
  doc_id uuid not null references public.purchase_docs on delete cascade,
  line_id bigint references public.purchase_lines on delete cascade,
  job_number text,
  cost_code text,
  bucket app.bucket,
  decision text not null check (decision in ('confirm', 'assign', 'exclude')),
  reason text,
  decided_by uuid not null default auth.uid(),
  decided_at timestamptz not null default now()
);
create index purchase_decisions_idx on public.purchase_decisions (doc_id, line_id, decided_at desc);
