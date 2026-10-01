-- 0009_rpc.sql - the one way actuals get written. begin -> append (batches)
-- -> finalize, in which the database recounts what was stored and refuses a
-- mismatch (the refusal rolls the finalize back; the upload stays pending
-- and the next begin_upload of the same bytes cleans it up). Same file
-- twice is answered, not re-recorded. An HH2 export that
-- overlaps one on file for the same people is recorded only as its
-- replacement, with a reason; a second export for the same week but other
-- people (another payroll group) is simply another file.

create function app.upload_json(u public.uploads) returns jsonb language sql stable as $$
  select jsonb_build_object('upload_id', u.id, 'file_name', u.file_name, 'kind', u.kind, 'status', u.status,
    'recorded_at', u.recorded_at, 'recorded_by', u.recorded_by, 'recorded_by_name', app.member_name(u.workspace_id, u.recorded_by),
    'period_start', lower(u.period), 'period_end', upper(u.period) - 1, 'as_of', u.as_of, 'vendor_key', u.vendor_key, 'summary', u.summary)
$$;

create function app.hh2_overlaps(p_workspace uuid, p_upload uuid, p_period daterange, p_employees jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(app.upload_json(u)), '[]'::jsonb)
  from public.uploads u
  where u.workspace_id = p_workspace and u.kind = 'hh2_labor' and u.status = 'recorded' and u.superseded_by is null
    and u.id <> p_upload and u.period && p_period
    and exists (select 1 from public.labor_lines l
                where l.upload_id = u.id and l.employee_number in (select jsonb_array_elements_text(coalesce(p_employees, '[]'::jsonb))))
$$;

create function public.begin_upload(p_workspace uuid, p_kind app.upload_kind, p_sha256 text, p_file_name text, p_byte_size int, p_meta jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sha bytea; ex public.uploads; up uuid; per daterange; ov jsonb := '[]'::jsonb;
begin
  if not app.can_edit(p_workspace) then raise exception 'only an editor of this workspace records files'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'sha256 must be 64 hex characters'; end if;
  sha := decode(p_sha256, 'hex');
  select * into ex from public.uploads where workspace_id = p_workspace and sha256 = sha;
  if found then
    if ex.status in ('recorded', 'superseded') then
      return jsonb_build_object('existing', true) || app.upload_json(ex);
    end if;
    perform set_config('app.cleanup', 'on', true);
    delete from public.uploads where id = ex.id;
    perform set_config('app.cleanup', 'off', true);
  end if;
  if p_meta ? 'period' then
    per := daterange((p_meta -> 'period' ->> 'start')::date, (p_meta -> 'period' ->> 'end')::date, '[]');
  end if;
  insert into public.uploads (workspace_id, kind, sha256, file_name, byte_size, source, vendor_key, period, as_of, summary, storage_path)
  values (p_workspace, p_kind, sha, p_file_name, p_byte_size, coalesce((p_meta ->> 'source')::app.source, 'drop'),
          p_meta ->> 'vendor_key', per, (p_meta ->> 'as_of')::date, coalesce(p_meta -> 'summary', '{}'::jsonb), p_meta ->> 'storage_path')
  returning id into up;
  if p_kind = 'hh2_labor' and per is not null then ov := app.hh2_overlaps(p_workspace, up, per, p_meta -> 'employees'); end if;
  return jsonb_build_object('existing', false, 'upload_id', up, 'overlaps', ov);
end $$;

create function app.pending_upload(p_upload uuid, p_kind app.upload_kind) returns public.uploads language plpgsql as $$
declare u public.uploads;
begin
  select * into u from public.uploads where id = p_upload for update;
  if u.id is null then raise exception 'no such upload'; end if;
  if not app.can_edit(u.workspace_id) then raise exception 'only an editor of this workspace records files'; end if;
  if u.status <> 'pending' then raise exception 'upload % is %, not pending', u.file_name, u.status; end if;
  if p_kind is not null and u.kind <> p_kind then raise exception 'upload % is a % file', u.file_name, u.kind; end if;
  return u;
end $$;

create function public.append_labor_lines(p_upload uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare u public.uploads; n int;
begin
  u := app.pending_upload(p_upload, 'hh2_labor');
  insert into public.labor_lines (workspace_id, upload_id, row_index, employee_number, work_date, payroll_group, payroll_service_id,
    job_number, job_name, child_job, child_job_name, cost_code, cost_code_name, pay_type, pay_type_name, hours)
  select u.workspace_id, p_upload, r.row_index, r.employee_number, r.work_date, r.payroll_group, r.payroll_service_id,
    r.job_number, r.job_name, nullif(r.child_job, ''), nullif(r.child_job_name, ''), r.cost_code, r.cost_code_name, r.pay_type, r.pay_type_name,
    (r.hours_x100::numeric / 100)
  from jsonb_to_recordset(p_rows) as r(row_index int, employee_number text, work_date date, payroll_group text, payroll_service_id text,
    job_number text, job_name text, child_job text, child_job_name text, cost_code text, cost_code_name text, pay_type text, pay_type_name text, hours_x100 bigint);
  get diagnostics n = row_count;
  return n;
end $$;

create function public.append_onrent_lines(p_upload uuid, p_snapshot jsonb, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare u public.uploads; sid uuid; n int;
begin
  u := app.pending_upload(p_upload, 'onrent');
  select id into sid from public.onrent_snapshots where upload_id = p_upload;
  if sid is null then
    insert into public.onrent_snapshots (workspace_id, upload_id, vendor_key, layout, as_of, line_count, rent_cents)
    values (u.workspace_id, p_upload, p_snapshot ->> 'vendor_key', p_snapshot ->> 'layout', (p_snapshot ->> 'as_of')::date, 0, 0)
    returning id into sid;
    update public.uploads set vendor_key = p_snapshot ->> 'vendor_key', as_of = (p_snapshot ->> 'as_of')::date where id = p_upload;
  end if;
  insert into public.onrent_lines (workspace_id, snapshot_id, row_index, equipment_no, contract_no, vendor_job_ref, seq, line_ref, description, qty,
    on_rent_date, rate_period, rate_cents, monthly_rent_cents, day_rate_cents, week_rate_cents, fourweek_rate_cents, month_rate_cents,
    po, est_return, billed_through, pickup_date, liberty_owned, cost_code, raw)
  select u.workspace_id, sid, r.row_index, r.equipment_no, r.contract_no, r.vendor_job_ref, coalesce(r.seq, 1), r.line_ref, r.description, coalesce(r.qty, 1),
    r.on_rent_date, r.rate_period, r.rate_cents, r.monthly_rent_cents, r.day_rate_cents, r.week_rate_cents, r.fourweek_rate_cents, r.month_rate_cents,
    r.po, r.est_return, r.billed_through, r.pickup_date, coalesce(r.liberty_owned, false), r.cost_code, coalesce(r.raw, '{}'::jsonb)
  from jsonb_to_recordset(p_rows) as r(row_index int, equipment_no text, contract_no text, vendor_job_ref text, seq int, line_ref text, description text,
    qty numeric, on_rent_date date, rate_period text, rate_cents bigint, monthly_rent_cents bigint, day_rate_cents bigint, week_rate_cents bigint,
    fourweek_rate_cents bigint, month_rate_cents bigint, po text, est_return date, billed_through date, pickup_date date, liberty_owned boolean, cost_code text, raw jsonb);
  get diagnostics n = row_count;
  return n;
end $$;

create function public.finalize_upload(p_upload uuid, p_expect jsonb, p_supersede jsonb default null)
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

-- the Settings answer to "which job is this vendor's site?"
create function public.map_vendor_job(p_workspace uuid, p_vendor_key text, p_vendor_job_ref text, p_job_number text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.can_edit(p_workspace) then raise exception 'only an editor maps jobs'; end if;
  if p_job_number is null or p_job_number = '' then
    delete from public.vendor_job_map where workspace_id = p_workspace and vendor_key = p_vendor_key and vendor_job_ref = p_vendor_job_ref;
  else
    if not exists (select 1 from public.jobs j where j.workspace_id = p_workspace and j.job_number = p_job_number) then raise exception 'no job % in this workspace', p_job_number; end if;
    insert into public.vendor_job_map (workspace_id, vendor_key, vendor_job_ref, job_number) values (p_workspace, p_vendor_key, p_vendor_job_ref, p_job_number)
    on conflict (workspace_id, vendor_key, vendor_job_ref) do update set job_number = excluded.job_number, set_by = auth.uid(), set_at = now();
  end if;
end $$;

-- Sage's rate tables, from the export (app/sage_rates.js): tables upserted,
-- rates added where new, retired where the export says otherwise, and jobs
-- whose number the table carries assigned to it when they have no table.
-- p_tables: [{code, description, rates: [{certified_class, pay_id, rate_cents, effective_from, effective_to}]}]
create function public.import_rate_tables(p_upload uuid, p_tables jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u public.uploads; t jsonb; r jsonb; rng daterange; live public.billable_rates; inserted int := 0; skipped int := 0; retired int := 0; n int;
  assigned jsonb := '[]'::jsonb; codes text[]; j record; hit text;
begin
  u := app.pending_upload(p_upload, 'sage_rates');
  for t in select * from jsonb_array_elements(p_tables) loop
    insert into public.rate_tables (workspace_id, code, description, source_file, imported_at, imported_by)
    values (u.workspace_id, t ->> 'code', t ->> 'description', u.file_name, now(), auth.uid())
    on conflict (workspace_id, code) do update set description = coalesce(excluded.description, public.rate_tables.description),
      source_file = excluded.source_file, imported_at = now(), imported_by = auth.uid();
    for r in select * from jsonb_array_elements(t -> 'rates') loop
      rng := daterange((r ->> 'effective_from')::date, (r ->> 'effective_to')::date, '[)');
      select * into live from public.billable_rates b
      where b.workspace_id = u.workspace_id and b.rate_table_code = t ->> 'code' and b.certified_class = r ->> 'certified_class'
        and b.pay_id = r ->> 'pay_id' and b.retired_at is null and b.effective = rng and b.rate_cents = (r ->> 'rate_cents')::int;
      if found then skipped := skipped + 1; continue; end if;
      update public.billable_rates b set retired_at = now(), retired_by = auth.uid()
      where b.workspace_id = u.workspace_id and b.rate_table_code = t ->> 'code' and b.certified_class = r ->> 'certified_class'
        and b.pay_id = r ->> 'pay_id' and b.retired_at is null and b.effective && rng;
      get diagnostics n = row_count;
      retired := retired + n;
      insert into public.billable_rates (workspace_id, rate_table_code, certified_class, pay_id, rate_cents, effective, note)
      values (u.workspace_id, t ->> 'code', r ->> 'certified_class', r ->> 'pay_id', (r ->> 'rate_cents')::int, rng, 'from ' || u.file_name);
      inserted := inserted + 1;
    end loop;
  end loop;
  select array_agg(x ->> 'code') into codes from jsonb_array_elements(p_tables) x;
  for j in select * from public.jobs where workspace_id = u.workspace_id and rate_table_code is null loop
    select c into hit from unnest(codes) c where regexp_replace(c, '\D', '', 'g') like '%' || right(regexp_replace(j.job_number, '\D', '', 'g'), 6);
    if hit is not null and (select count(*) from unnest(codes) c where regexp_replace(c, '\D', '', 'g') like '%' || right(regexp_replace(j.job_number, '\D', '', 'g'), 6)) = 1 then
      update public.jobs set rate_table_code = hit where id = j.id;
      assigned := assigned || jsonb_build_object('job_number', j.job_number, 'rate_table_code', hit);
    end if;
  end loop;
  update public.uploads set status = 'recorded', finalized_at = clock_timestamp(), summary = summary || jsonb_build_object('tables', jsonb_array_length(p_tables), 'inserted', inserted, 'skipped', skipped, 'retired', retired) where id = p_upload;
  return jsonb_build_object('status', 'recorded', 'tables', jsonb_array_length(p_tables), 'inserted', inserted, 'skipped', skipped, 'retired', retired, 'assigned', assigned);
end $$;

-- Purchase Pro's PO table export: one document per PO, the whole export a snapshot.
create function public.append_purchase_orders(p_upload uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare u public.uploads; n int;
begin
  u := app.pending_upload(p_upload, 'purchase_orders');
  insert into public.purchase_docs (workspace_id, upload_id, source, direction, doc_kind, doc_number, doc_date, vendor_key, vendor_name_raw, job_number,
    description, order_type, bucket, cancelled, quote, total_cents, row_index, raw, status)
  select u.workspace_id, p_upload, 'drop', 'cost', 'purchase_order', r.po_number, r.order_date, r.supplier_code, r.supplier_name, r.job_number,
    r.description, r.order_type, r.bucket::app.bucket, coalesce(r.cancelled, false), coalesce(r.quote, false), r.committed_cents, r.row_index, coalesce(r.raw, '{}'::jsonb),
    case when coalesce(r.cancelled, false) or coalesce(r.quote, false) then 'excluded'::app.line_status when r.committed_cents is null then 'needs_decision' else 'auto' end
  from jsonb_to_recordset(p_rows) as r(row_index int, po_number text, order_date date, order_type text, supplier_code text, supplier_name text, job_number text,
    description text, bucket text, cancelled boolean, quote boolean, committed_cents bigint, raw jsonb);
  get diagnostics n = row_count;
  return n;
end $$;
