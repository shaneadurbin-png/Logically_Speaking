-- 0014_po_shared_numbers.sql - Tbl_PO has no primary key, so one PO NUMBER can
-- sit on two different orders (32 numbers do on the export of 2026-10-02).
-- An order's identity is its OrderID (kept in raw). A number shared by more
-- than one live order makes each of them wait for a decision; a decision is
-- about one order and carries across exports by number AND OrderID.
create or replace view app.purchase_docs_resolved as
with live as (
  select d.*, count(*) over (partition by d.workspace_id, d.source, d.doc_kind, d.doc_number) as shared_number
  from app.purchase_docs_live d
)
select d.id, d.workspace_id, d.upload_id, d.source, d.direction, d.vendor_key, d.vendor_name_raw, d.doc_kind, d.doc_number, d.doc_date, d.description, d.order_type,
  d.cancelled, d.quote, d.total_cents,
  coalesce(dd.job_number, d.job_number) as job_number,
  coalesce(dd.cost_code, d.cost_code) as cost_code,
  coalesce(dd.bucket, cc.bucket, d.bucket) as bucket,
  case when d.cancelled or d.quote then 'excluded'
       when dd.decision = 'exclude' then 'excluded'
       when d.total_cents is null then 'needs_decision'
       when dd.decision in ('confirm', 'assign') then 'confirmed'
       when d.shared_number > 1 then 'needs_decision'
       when j.id is null then 'needs_decision'
       else d.status::text end as status,
  (j.id is not null) as job_known,
  d.shared_number::int as shared_number,
  d.raw ->> 'order_id' as order_id
from live d
-- the latest decision on this document, or on the same order (number and OrderID) from an earlier export
left join lateral (
  select x.* from public.purchase_decisions x
  join public.purchase_docs xd on xd.id = x.doc_id
  where x.line_id is null and x.workspace_id = d.workspace_id
    and (x.doc_id = d.id or (d.doc_kind = 'purchase_order' and xd.doc_kind = 'purchase_order' and xd.source = d.source and xd.doc_number = d.doc_number
                             and coalesce(xd.raw ->> 'order_id', '') = coalesce(d.raw ->> 'order_id', '')))
  order by x.decided_at desc, x.id desc limit 1) dd on true
left join public.cost_codes cc on cc.workspace_id = d.workspace_id and cc.code = coalesce(dd.cost_code, d.cost_code)
left join public.jobs j on j.workspace_id = d.workspace_id and j.job_number = coalesce(dd.job_number, d.job_number);

create or replace view public.v_purchase_docs as
  select * from app.purchase_docs_resolved where app.is_member(workspace_id);
