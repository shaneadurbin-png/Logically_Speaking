-- 0002_settings.sql - the things a person sets: jobs, cost codes, vendors
-- and their tax/markup, the vendor's job names mapped to jobs, billable
-- rates (effective-dated, append-only), employees' trade and class, pay-type
-- policy, and the inbox. Every table is audited.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  job_number text not null check (job_number ~ '^\d{2}-\d{2}-\d{6}$'),
  short_name text not null,
  name text,
  campus text,                             -- CDR E1, PHL, BWI, SBN, DFW2 ... for grouping; optional
  region text,                             -- "Cedar Rapids, IA"
  rate_table_code text,                    -- the Sage rate table this job is billed from (#225121)
  tax_bp int not null default 700 check (tax_bp between 0 and 5000),          -- sales tax on rentals at this site
  markup_bp int not null default 1000 check (markup_bp between 0 and 10000),  -- Liberty's markup on rentals
  markup_base text not null default 'rent_plus_tax' check (markup_base in ('rent', 'rent_plus_tax')),
  active boolean not null default true,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, job_number)
);

create table public.cost_codes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  code text not null check (code ~ '^\d{2}-\d{2}-\d{4}$'),
  name text,
  bucket app.bucket,                       -- null = not assigned; never guessed
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, code)
);

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  vendor_key text not null check (vendor_key ~ '^[a-z0-9_]{1,60}$'),
  name text not null,
  feed text not null default 'onrent' check (feed in ('onrent', 'purchases', 'both')),
  taxable boolean not null default true,       -- its rentals carry the job's sales tax
  liberty_owned boolean not null default false,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, vendor_key)
);

-- "CDR-SCCI-DC4" (what the vendor calls the site) -> 50-60-225121
create table public.vendor_job_map (
  workspace_id uuid not null references public.workspaces on delete cascade,
  vendor_key text not null,
  vendor_job_ref text not null,
  job_number text not null,
  set_by uuid default auth.uid(),
  set_at timestamptz not null default now(),
  primary key (workspace_id, vendor_key, vendor_job_ref)
);

-- Sage's rate tables, imported from its export (app/sage_rates.js) or typed in.
create table public.rate_tables (
  workspace_id uuid not null references public.workspaces on delete cascade,
  code text not null,                      -- as Sage names it: #225008, #225040MC
  description text,
  source_file text,
  imported_at timestamptz,
  imported_by uuid,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, code)
);

-- The exact key: rate table | certified class | pay ID (HH2's PayType).
-- Append-only; a rate is retired, never changed, and no two live rates for
-- one key may overlap.
create table public.billable_rates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  rate_table_code text not null,
  certified_class text not null,           -- #CARP-J, #LAB-GF, #SUP ...
  pay_id text not null,                    -- UNION REG, REG, O/T ...
  rate_cents int not null check (rate_cents >= 0),
  effective daterange not null default daterange(current_date, null, '[)'),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  retired_by uuid,
  retired_at timestamptz,
  foreign key (workspace_id, rate_table_code) references public.rate_tables (workspace_id, code) on delete cascade,
  exclude using gist (workspace_id with =, rate_table_code with =, certified_class with =, pay_id with =, effective with &&)
    where (retired_at is null)
);
create index billable_rates_key_idx on public.billable_rates (workspace_id, rate_table_code, certified_class, pay_id) where retired_at is null;

create function app.rates_guard() returns trigger language plpgsql as $$
begin
  if new.rate_cents <> old.rate_cents or new.effective <> old.effective or new.rate_table_code <> old.rate_table_code
     or new.certified_class <> old.certified_class or new.pay_id <> old.pay_id then
    raise exception 'a rate is never changed: retire it and add the new one';
  end if;
  return new;
end $$;
create trigger rates_guard before update on public.billable_rates for each row execute function app.rates_guard();

create function public.retire_rate(p_rate uuid) returns void language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  select workspace_id into ws from public.billable_rates where id = p_rate;
  if ws is null or not app.can_edit(ws) then raise exception 'not allowed'; end if;
  update public.billable_rates set retired_at = now(), retired_by = auth.uid() where id = p_rate and retired_at is null;
end $$;

-- Names live here and only here. Viewers never read this table.
create table public.employees (
  workspace_id uuid not null references public.workspaces on delete cascade,
  employee_number text not null,
  name text,
  certified_class text,                    -- Sage's: #CARP-J, #LAB-GF ...; null = the prefix default
  note text,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, employee_number)
);

create table public.pay_type_policy (
  workspace_id uuid not null references public.workspaces on delete cascade,
  pay_type_name text not null,
  policy text not null check (policy in ('rated', 'held_pto', 'excluded')),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, pay_type_name)
);

create table public.inbox_addresses (
  address citext primary key,
  workspace_id uuid not null references public.workspaces on delete cascade,
  created_at timestamptz not null default now()
);
create table public.inbox_senders (
  workspace_id uuid not null references public.workspaces on delete cascade,
  pattern citext not null,                 -- an address or @domain
  allowed boolean not null default true,
  note text,
  primary key (workspace_id, pattern)
);

do $$ declare t text; begin
  foreach t in array array['jobs', 'cost_codes', 'vendors', 'vendor_job_map', 'rate_tables', 'billable_rates', 'employees', 'pay_type_policy', 'inbox_senders'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function app.audit()', t);
  end loop;
  foreach t in array array['jobs', 'cost_codes', 'vendors', 'rate_tables', 'employees', 'pay_type_policy'] loop
    execute format('create trigger touch before update on public.%I for each row execute function app.touch()', t);
  end loop;
end $$;
