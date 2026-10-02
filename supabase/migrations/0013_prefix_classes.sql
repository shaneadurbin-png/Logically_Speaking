-- 0013_prefix_classes.sql - the certified class an employee number's prefix
-- implies, as a setting instead of a rule in the code.
--
-- "FB5 is a Laborer journeyman by default, then we hand-pick the foremen."
-- An employee with a class set in Settings keeps it; everyone else takes
-- the class of the longest listed prefix their number starts with; a number
-- no prefix covers is held (no class) until one does. Every workspace
-- starts with the five defaults the page carried until now.

create table public.prefix_classes (
  workspace_id uuid not null references public.workspaces on delete cascade,
  prefix text not null check (prefix = upper(btrim(prefix)) and length(prefix) between 1 and 6),
  certified_class text not null,           -- Sage's: #CARP-J, #LAB-J, #SUP ...
  note text,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, prefix)
);
create trigger audit after insert or update or delete on public.prefix_classes for each row execute function app.audit();
create trigger touch before update on public.prefix_classes for each row execute function app.touch();

alter table public.prefix_classes enable row level security;
create policy prefix_classes_select on public.prefix_classes for select using (app.is_member(workspace_id));
create policy prefix_classes_insert on public.prefix_classes for insert with check (app.can_edit(workspace_id));
create policy prefix_classes_update on public.prefix_classes for update using (app.can_edit(workspace_id)) with check (app.can_edit(workspace_id));
create policy prefix_classes_delete on public.prefix_classes for delete using (app.can_edit(workspace_id));
grant select, insert, update, delete on public.prefix_classes to authenticated, service_role;

-- the defaults: for every workspace there is, and for every one made from now on
create function app.seed_prefix_classes(p_ws uuid) returns void language sql security definer set search_path = public as $$
  insert into public.prefix_classes (workspace_id, prefix, certified_class)
  values (p_ws, 'FB2', '#LAB-J'), (p_ws, 'FB5', '#LAB-J'), (p_ws, 'TTR', '#LAB-J'), (p_ws, 'FB7', '#CARP-J'), (p_ws, 'FB8', '#CARP-J')
  on conflict do nothing;
$$;
select app.seed_prefix_classes(id) from public.workspaces;
create function app.seed_prefix_classes_tg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform app.seed_prefix_classes(new.id);
  return new;
end $$;
create trigger seed_prefix_classes after insert on public.workspaces for each row execute function app.seed_prefix_classes_tg();

-- pricing reads the table: the longest prefix the number starts with
create or replace view app.labor_priced as
with base as (
  select l.*,
    coalesce(e.certified_class, pc.certified_class) as certified_class,
    coalesce(p.policy, case when l.pay_type_name in ('Vacation', 'Holiday', 'Sick Time', 'Flex Paid Time Off', 'Birthday Time Off', 'Floating Hol')
      then 'held_pto' else 'rated' end) as policy,
    (j.id is not null) as job_known,
    j.rate_table_code
  from public.labor_lines l
  join app.uploads_live u on u.id = l.upload_id
  left join public.employees e on e.workspace_id = l.workspace_id and e.employee_number = l.employee_number
  left join lateral (
    select x.certified_class from public.prefix_classes x
    where x.workspace_id = l.workspace_id and left(upper(l.employee_number), length(x.prefix)) = x.prefix
    order by length(x.prefix) desc limit 1
  ) pc on true
  left join public.pay_type_policy p on p.workspace_id = l.workspace_id and p.pay_type_name = l.pay_type_name
  left join public.jobs j on j.workspace_id = l.workspace_id and j.job_number = l.job_number
)
select b.*, r.id as rate_id, r.rate_cents,
  case when not b.job_known then 'held:unknown job'
       when b.policy = 'excluded' then 'excluded'
       when b.policy = 'held_pto' then 'held:PTO pay type'
       when b.rate_table_code is null then 'held:no rate table'
       when b.certified_class is null then 'held:no class'
       when r.id is null then 'held:no rate'
       else 'priced' end as status,
  case when b.job_known and b.policy = 'rated' and b.rate_table_code is not null and b.certified_class is not null and r.id is not null
       then round(b.hours * r.rate_cents)::bigint end as cost_cents
from base b
left join lateral (
  select r.id, r.rate_cents from public.billable_rates r
  where r.workspace_id = b.workspace_id and r.rate_table_code = b.rate_table_code and r.certified_class = b.certified_class
    and r.pay_id = b.pay_type and r.retired_at is null and r.effective @> b.work_date
  limit 1
) r on true;
