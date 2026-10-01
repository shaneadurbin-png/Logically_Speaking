-- 0007_rls.sql - who may see and do what. Every table is locked; the page
-- reaches lines only as an editor, aggregates as anyone in the workspace,
-- and writes actuals only through the RPCs in 0009.
do $$ declare t text; begin
  foreach t in array array['workspaces', 'members', 'audit_log', 'jobs', 'cost_codes', 'vendors', 'vendor_job_map', 'rate_tables', 'billable_rates',
    'employees', 'pay_type_policy', 'inbox_addresses', 'inbox_senders', 'uploads', 'labor_lines', 'onrent_snapshots', 'onrent_lines',
    'inbox_messages', 'inbox_attachments', 'purchase_docs', 'purchase_lines', 'purchase_decisions'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

grant usage on schema public, app to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

-- workspaces: members read; created through create_workspace()
create policy ws_select on public.workspaces for select using (app.is_member(id));

-- members: members see the list; owners manage it
create policy members_select on public.members for select using (app.is_member(workspace_id));
create policy members_insert on public.members for insert with check (app.is_owner(workspace_id));
create policy members_update on public.members for update using (app.is_owner(workspace_id)) with check (app.is_owner(workspace_id));
create policy members_delete on public.members for delete using (app.is_owner(workspace_id));

create policy audit_select on public.audit_log for select using (app.is_member(workspace_id));

-- settings: members read, editors write (employees: editors only, both ways)
do $$ declare t text; begin
  foreach t in array array['jobs', 'cost_codes', 'vendors', 'vendor_job_map', 'rate_tables', 'pay_type_policy', 'inbox_senders'] loop
    execute format('create policy %I_select on public.%I for select using (app.is_member(workspace_id))', t, t);
    execute format('create policy %I_insert on public.%I for insert with check (app.can_edit(workspace_id))', t, t);
    execute format('create policy %I_update on public.%I for update using (app.can_edit(workspace_id)) with check (app.can_edit(workspace_id))', t, t);
    execute format('create policy %I_delete on public.%I for delete using (app.can_edit(workspace_id))', t, t);
  end loop;
end $$;
create policy employees_select on public.employees for select using (app.can_edit(workspace_id));
create policy employees_insert on public.employees for insert with check (app.can_edit(workspace_id));
create policy employees_update on public.employees for update using (app.can_edit(workspace_id)) with check (app.can_edit(workspace_id));
create policy employees_delete on public.employees for delete using (app.can_edit(workspace_id));
-- rates: append-only from the page; retire via retire_rate()
create policy rates_select on public.billable_rates for select using (app.is_member(workspace_id));
create policy rates_insert on public.billable_rates for insert with check (app.can_edit(workspace_id));
create policy inbox_addresses_select on public.inbox_addresses for select using (app.is_member(workspace_id));

-- uploads: members see them; written only through the RPCs
create policy uploads_select on public.uploads for select using (app.is_member(workspace_id));

-- actuals: editors read lines; nobody writes them from the page
create policy labor_lines_select on public.labor_lines for select using (app.can_edit(workspace_id));
create policy onrent_snapshots_select on public.onrent_snapshots for select using (app.is_member(workspace_id));
create policy onrent_lines_select on public.onrent_lines for select using (app.can_edit(workspace_id));
create policy inbox_messages_select on public.inbox_messages for select using (app.can_edit(workspace_id));
create policy inbox_attachments_select on public.inbox_attachments for select using (app.can_edit(workspace_id));
create policy purchase_docs_select on public.purchase_docs for select using (app.is_member(workspace_id));
create policy purchase_lines_select on public.purchase_lines for select using (app.is_member(workspace_id));
create policy purchase_lines_insert on public.purchase_lines for insert with check (app.can_edit(workspace_id));
create policy purchase_decisions_select on public.purchase_decisions for select using (app.is_member(workspace_id));
create policy purchase_decisions_insert on public.purchase_decisions for insert with check (app.can_edit(workspace_id));

-- the views: invoker views inherit the above; owner views scope themselves
grant select on public.v_uploads_live, public.v_labor_priced, public.v_labor_job_month, public.v_labor_class_month, public.v_labor_held,
  public.v_rental_items, public.v_rental_month, public.v_purchase_docs, public.v_purchase_lines, public.v_purchase_month, public.v_month_buckets, public.v_job_month, public.v_freshness
  to authenticated, service_role;
