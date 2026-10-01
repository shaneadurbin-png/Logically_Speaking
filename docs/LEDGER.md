# Ledger

Every decision, with what it was measured against. **L** is settled; **Q** is open.

## Settled

- **L-01 · Rate key is Sage's.** A rate is keyed by rate table code (`#225121`), certified class (`#LAB-J`) and pay ID as HH2 writes it (`UNION REG`). Replaced the first draft's job | trade | class | pay-type-name key after the Sage rate table exports (SBN, BWI, AUS, PHL, DFW) showed that is how Sage prices them and that tables are shared by jobs. The Sage export reader skips the catch-all `*` rows and chains escalation dates into ranges.
- **L-02 · Class from the badge prefix, overridable.** FB2, FB5, TTR → `#LAB-J`; FB7, FB8 → `#CARP-J`; FB1 and unknown prefixes → held *no class* until Settings sets the class. Foremen, general foremen, apprentices and superintendents are set per employee.
- **L-03 · HH2 rows are never deduplicated.** The real export carries exact duplicate rows that are real split entries; the fixture carries three. Recount on finalize checks rows and hours, not distinct rows.
- **L-04 · HH2 has 12 columns; 14 with ChildJob accepted.** The real export has 12 (no ChildJob/ChildJobName); the first spec said 14. Both read; anything else is refused naming the first wrong column. The real pay IDs carry no `#`.
- **L-05 · PTO is held, not priced and not dropped.** Vacation, Holiday, Sick Time, Flex Paid Time Off, Birthday Time Off, Floating Hol: hours kept for the audit, no cost. Overridable per pay type (rated / held / excluded).
- **L-06 · Rental month = run-rate at the latest snapshot on or before month end.** Not prorated; off-rent items are listed with the day they went off, derived from the first later report that lacks them. Two reports from one vendor as of the same day: the one recorded last stands (SQL and JS agree; `finalize_upload` stamps `clock_timestamp()` so the order is real even inside one transaction).
- **L-07 · A 4-week rate × quantity is the month.** Sunbelt's export carries a 4-week rate, no monthly figure; it is treated as the month, as the client is billed. Day- and week-only lines are shown and not totalled.
- **L-08 · Tax and markup belong to the job, taxable to the vendor.** Tax is the site's sales tax (7% at CDR), markup Liberty's (10% on rent + tax), both per job in Settings; a vendor can be untaxed. Lines under no job carry neither. Liberty-owned equipment (flag per vendor or per line) is rent only.
- **L-09 · Vendor identified from content, never from the file name.** Each layout has a header fingerprint and an identifying column (Sunbelt's Customer Name, United Rentals' Equipment Source, Herc's Vendor, EquipmentShare's export shape). Confirmed against a real export: United Rentals, Sunbelt, Herc, EquipmentShare. Awaiting one: Mission Critical Warehouse (refuses until then).
- **L-10 · As-of by layout.** United Rentals and EquipmentShare: the file name. Herc: the Report Date column (the name's date is the schedule's, not the data's). Sunbelt's account export: asked on the card. The page's own CSV: the name.
- **L-11 · Rental identity carries a sequence.** vendor | equipment | contract | vendor job label | seq, because United Rentals lists non-serialised bulk items as repeated identical lines; repeats are numbered in order. Bulk items with no unit number are kept by their category-class code.
- **L-12 · The Purchase Pro export is a snapshot of every PO.** The latest export (by its as-of, then by when it was recorded) stands for all POs; earlier exports stay on file. Material and Rental POs count at Sage's committed total; quotes and cancelled POs are excluded; a PO with no amount or on an unknown job waits for a decision; "NONBILLABLE" in the description is the Non-Billables bucket. Rental POs are shown apart from the on-rent reports.
- **L-13 · Jobs are company-wide, with campus and region.** The Projects register (Job #, Project Name, Campus, Region) adds jobs; the Portfolio groups by campus. The page is not only CDR.
- **L-14 · Buckets are GRforecast's.** LABOR, MATERIALS, EQUIPMENT, SUBCONTRACTORS, OTHER, NON_BILLABLE, same names and colours, so `v_month_buckets` is the forecast's import shape.
- **L-15 · Views scope themselves.** Every public view runs with its owner's rights and filters by membership (aggregates) or editor rights (lines), because a security-invoker view nested in an owner view emptied every aggregate for a viewer. RLS still guards the tables.
- **L-16 · Refusals are atomic.** `finalize_upload` raises and rolls back on any recount mismatch; the upload stays pending, nothing half-recorded.
- **L-17 · Actuals are never edited.** Labor lines, on-rent lines and purchase docs have forbid triggers; superseding keeps the old upload with the reason and who gave it.
- **L-18 · Money in integer cents, rounded half away from zero**, matching Postgres `round()`; the labor and rental parity tests hold the JS models to the SQL views to the cent.
- **L-19 · Readers run in the page, not on a server.** Same code in the browser and in Node, same tests; the database recounts what the page sends.
- **L-20 · Public repo, no real data.** Fixtures are generated; real exports, rate sheets, the register and email live only in the session's scratch space.

## Open

- **Q-01 · Inbox domain** for the CC'd purchases inbox (Phase 2).
- **Q-02 · United Rentals as-of**: the All Jobs export's file-name timestamp is taken as the day it was pulled. Confirm.
- **Q-03 · CDR rate tables**: the seed carries placeholder Iowa rates (16 keys per table, effective 2026-07-01) until the real Sage export for #225121, #225120, #226021 and #225104 is dropped.
- **Q-04 · Mission Critical Warehouse** layout: awaiting a real export; its `1-SL-*` Liberty-owned convention is assumed from the earlier calculator.
- **Q-05 · Negative PTO rows** (a Vacation adjustment of -8 hours in the fixture) are held with negative hours, so a job's "held" figure can read negative. Correct to the data; decide whether to show adjustments apart.
