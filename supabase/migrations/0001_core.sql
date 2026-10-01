-- 0001_core.sql - workspaces, members, roles, the audit log, and the two
-- triggers everything else leans on: audit() for settings, forbid() for
-- actuals. Money is integer cents everywhere; rates are cents; tax and
-- markup are basis points.
create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists btree_gist;
create schema if not exists app;

create type app.role          as enum ('owner', 'editor', 'viewer');
create type app.bucket        as enum ('LABOR', 'MATERIALS', 'EQUIPMENT', 'SUBCONTRACTORS', 'OTHER', 'NON_BILLABLE');
create type app.upload_kind   as enum ('hh2_labor', 'onrent', 'sage_rates', 'projects', 'purchase_orders', 'sales_ticket', 'hh2_timecard_pdf', 'billing');
create type app.upload_status as enum ('pending', 'recorded', 'failed', 'superseded');
create type app.source        as enum ('drop', 'inbox', 'form', 'api');
create type app.line_status   as enum ('auto', 'needs_decision', 'confirmed', 'excluded', 'refused');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.members (
  workspace_id uuid not null references public.workspaces on delete cascade,
  email citext not null,
  user_id uuid references auth.users on delete set null,
  role app.role not null,
  display_name text,
  invited_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (workspace_id, email)
);
create index members_user_idx on public.members (user_id);

-- Who is asking: by user id once claimed, by the signed-in email before that.
create function app.email() returns citext language sql stable as $$
  select nullif(auth.jwt() ->> 'email', '')::citext
$$;
create function app.role_in(ws uuid) returns app.role language sql stable security definer set search_path = public as $$
  select m.role from public.members m
  where m.workspace_id = ws and (m.user_id = auth.uid() or (m.user_id is null and m.email = app.email()))
  order by (m.user_id = auth.uid()) desc limit 1
$$;
create function app.is_member(ws uuid) returns boolean language sql stable as $$ select app.role_in(ws) is not null $$;
create function app.can_edit(ws uuid)  returns boolean language sql stable as $$ select app.role_in(ws) in ('owner', 'editor') $$;
create function app.is_owner(ws uuid)  returns boolean language sql stable as $$ select app.role_in(ws) = 'owner' $$;
create function app.member_name(ws uuid, who uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(m.display_name, m.email::text) from public.members m where m.workspace_id = ws and m.user_id = who limit 1
$$;

-- Every change to a setting is a record: who, when, before, after.
create table public.audit_log (
  id bigserial primary key,
  workspace_id uuid,
  table_name text not null,
  row_pk text,
  op text not null,
  before jsonb,
  after jsonb,
  actor uuid default auth.uid(),
  actor_email text default (auth.jwt() ->> 'email'),
  at timestamptz not null default now()
);
create index audit_log_ws_idx on public.audit_log (workspace_id, at desc);

create function app.audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (workspace_id, table_name, row_pk, op, before, after)
  values (coalesce((to_jsonb(new) ->> 'workspace_id')::uuid, (to_jsonb(old) ->> 'workspace_id')::uuid), tg_table_name,
          coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id'), tg_op,
          case when tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- Actuals are never edited. The one exception is the clean-up of an upload
-- that never finished, done inside finalize/begin with app.cleanup set.
create function app.forbid() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('app.cleanup', true) = 'on' then return old; end if;
  raise exception 'actuals are never edited: % on %', tg_op, tg_table_name using errcode = 'P0001';
end $$;

create function app.touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- A new workspace is made by its first owner.
create function public.create_workspace(p_name text) returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  if auth.uid() is null or app.email() is null then raise exception 'sign in first'; end if;
  insert into public.workspaces (name) values (p_name) returning id into ws;
  insert into public.members (workspace_id, email, user_id, role) values (ws, app.email(), auth.uid(), 'owner');
  return ws;
end $$;

-- After the OTP sign-in: an invite by email becomes this user's membership.
create function public.claim_membership() returns setof public.members language sql security definer set search_path = public as $$
  update public.members set user_id = auth.uid()
  where user_id is null and email = app.email() and auth.uid() is not null
  returning *
$$;

-- The last owner cannot be removed or demoted.
create function app.keep_an_owner() returns trigger language plpgsql as $$
begin
  if (tg_op = 'DELETE' or new.role <> 'owner') and old.role = 'owner'
     and not exists (select 1 from public.members m where m.workspace_id = old.workspace_id and m.role = 'owner' and m.email <> old.email) then
    raise exception 'a workspace keeps at least one owner';
  end if;
  return coalesce(new, old);
end $$;
create trigger keep_an_owner before update or delete on public.members for each row execute function app.keep_an_owner();
