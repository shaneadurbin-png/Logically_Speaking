# GR Cost

What each job has cost **this month**, live, to the cent: **labor** from HH2 time priced at Sage's rate tables, **rentals** from the vendors' on-rent reports billed to the client, and **purchases** from Purchase Pro's committed POs. Every job the company tracks, grouped by campus, with a print-ready report per job or for all of them.

It is the successor to the Power BI dashboard and the weekly cost workbook: one page, one database, no spreadsheet in the middle.

## Open it

The page is `CostTracker.html`. Served from Cloudflare Pages it talks to its own Supabase project; served from this folder with nothing configured it runs in **demo mode**, where everything works and nothing is saved:

```
npm run serve            # then open http://localhost:8794/CostTracker.html
```

Live use needs the project filled in `app/config.js` (below). Sign in with the 6-digit code emailed to you; no password.

## Each week

1. Go to **Update** and drop the files. A zip or a folder is fine. Each file is read by what is in it, never by its name.
2. Read the cards. Every file shows as **ready** with a stamp ("60 rows, 410 hours, 7 held (3 no class, 1 unknown job, 3 PTO pay type)"), **needs a decision** with the question, **refused** with the reason, or **already on file** with who recorded it.
3. Press **Record**. Nothing is saved until you do. The Portfolio and the job pages show it at once.

**What it reads.**

| Drop | What happens |
|---|---|
| HH2 **Labor Detail** export (`LaborDetails_9_1_2026_to_9_30_2026.xlsx`) | every row kept, duplicates included (HH2 writes real split entries); the week in the name must match the data; priced the moment it lands |
| **United Rentals** Total Control "Equipment On Rent - All Jobs" (`.xls`) | the as-of date comes from the name; bulk items with no unit number are kept by their category-class code |
| **Sunbelt** account export (`.csv`) | the file does not say what day it is as of, so the card asks; 4-week rate × quantity is the month |
| **Herc** "Equipment On Rent Summary" (`.xlsx`) | the as-of is the Report Date column (the name's date is not it) |
| **EquipmentShare** rentals export (`.csv`) | only lines with status On-rent count; short dates in the name ("9.4.26") read |
| **Purchase Pro** `Tbl_PO1` export | a snapshot of every PO: the latest export stands for all of them |
| **Sage rate table** export (the "Rate Table" report, one or many tables) | loads or refreshes each table; jobs whose number ends in the table's digits are attached to it |
| **Projects** register (`Projects.xlsx`: Job #, Project Name, Campus, Region) | adds jobs, fills in campus and region where blank |
| the page's own on-rent CSV (`vendor_YYYY-MM-DD.csv`) | for a vendor with no export of its own |

Mission Critical Warehouse's own export is not read until a real one has been seen; its lines go in through the page's CSV meanwhile.

**What it will not do.** Guess. A file whose columns are not the ones expected names the first column that is wrong. The same bytes dropped twice are recorded once. An HH2 week already on file for the same people is recorded only as a replacement, with a reason, and the old upload is kept as superseded. A vendor's job name the page has not been told about ("CDR-SCCI-DC4") goes under *other jobs*, never guessed onto a job, and moves to its job the moment Settings says which.

## The pages

- **Portfolio**: every job this month, by campus, with labor, rentals, purchases and a total; the header says what HH2 covers, each vendor's latest report, and the PO export's date.
- **Job**: the month's tiles; labor by certified class and pay ID; rentals per vendor (rent, tax, markup, to client) with a link to the client's statement; the month's POs; labor by cost code; and what is **held** and why.
- **Report (PDF)**: the job, or all jobs, laid out for print. Press the button and choose **Save as PDF**.
- **Statement**: one vendor's equipment on rent for one job and month, as billed to the client.
- **Settings**: jobs (campus, region, rate table, rental tax %, markup %), vendors (taxed, Liberty-owned), the vendors' job names, rate tables (per table: class, pay ID, $/hour, dates in force; retire and add, never edit), employees (certified class; names live here and nowhere else), pay types (PTO held, excluded), people (owner, editor, viewer) and the files on record.
- **Export .xlsx** on a job: the month in sheets (summary, labor by code, by class, every line, each vendor's statement, the POs). **Export for GRforecast** on the Portfolio: one row per job, month and bucket, the shape the forecast imports.

## How the numbers are made

**Labor.** Each HH2 row is priced by one exact key: the job's **Sage rate table**, the employee's **certified class** (`#LAB-J`, `#CARP-J`, `#LAB-GF`, `#SUP`…) and the row's **pay ID** as HH2 writes it (`UNION REG`, `REG`, `O/T`, `DOUBLETIME`; `REG` and `UNION REG` are two keys). The class comes from the employee number's prefix (FB2, FB5, TTR are Laborer journeymen; FB7, FB8 Carpenter journeymen) unless Settings says otherwise. A row with no answer is **held**, never priced at zero: *no rate table* (the job has none), *no class* (unknown prefix), *no rate* (the key is not in the table for that day), *unknown job* (not in Settings), *PTO pay type* (Vacation, Holiday, Sick… kept for the audit). The moment the answer is given in Settings the hours price; nothing is re-uploaded. Rates are dated ranges and never overlap; a Sage export that changes a rate retires the old one.

**Rentals.** Each report is a snapshot of what is on rent as of a day. A month's figure is the **run-rate at the latest snapshot on or before the month's end**: the monthly rent of every line on it (a vendor's monthly figure, or the month rate × quantity, or the 4-week rate × quantity), not prorated. Two reports from one vendor as of the same day: the one recorded last stands. Tax is the **job's** (its site's rate, where the vendor is taxed), markup is the job's (on rent + tax, or on rent). Liberty-owned equipment is rent only, apart. An item missing from a later report went **off rent** on that report's day, and is listed, not prorated. Lines carrying only a day or week rate are shown and not totalled, and the card says so.

**Purchases.** Purchase Pro's committed amount per PO, by order date. Material and Rental POs count; quotes and cancelled POs are listed and excluded; a PO with no committed amount yet, or on a job not in Settings, **waits for a decision** and is never counted silently. "NONBILLABLE" in the description puts it in Non-Billables. Rental POs are counted and shown apart, so a rental bought through a PO is not lost and not double-counted against the on-rent reports by accident. A waiting PO is decided on the job page or on Settings › Purchases: count it on a job, in a bucket, or leave it out with a reason. The decision is about the PO number, so it holds through the next export, and the old decisions are kept.

**Buckets.** Labor, Materials, Equipment, Subcontractors, Other and Non-Billables, named and coloured as GRforecast names them, so a month exported from here drops into a forecast there.

Money is kept in cents, rounded half away from zero, the same in the page and in the database, and the tests hold the two to each other.

## Who sees what

Owners and editors see everything, including employee names on the Employees tab and the priced lines. **Viewers** (the client's PMs) see totals, classes and statements, never a name or an employee number: the database's views enforce it, not the page. Every change to a setting is kept with who made it and when. Recorded actuals are never edited: a wrong file is superseded, with a reason, and the old one kept.

## Setting it up

1. **Supabase**: a new project. Apply `supabase/migrations/*.sql` in order (`supabase db push`), then `supabase/seed.sql` after changing its placeholder email to the first owner's. Storage buckets `uploads`, `inbox` and `forms` come from migration 0008.
2. **The page**: put the project URL and publishable key in `app/config.js`. Nothing secret goes in the page or the repo.
3. **Cloudflare Pages**: this repo, no build command, output `/`. `_headers` carries the content-security policy: the page loads code only from itself and talks only to Supabase.
4. **People**: on Settings › People, invite each email with a role; they sign in with the code.

Local stack: `supabase start`, then open the page as `CostTracker.html?env=local`.

## What's in this folder

| | |
|---|---|
| `CostTracker.html` | the page |
| `app/` | what the page is made of: readers (`hh2.js`, `onrent.js`, `purchase_pro.js`, `sage_rates.js`, `projects.js`), models (`labor_model.js`, `rentals_model.js`), the drop (`intake.js`), the door to the database (`db.js`, `db_local.js` for demo), the pages (`ui.js`, `style.css`), vendored libraries |
| `supabase/` | the database: migrations, seed, SQL tests |
| `tests/` | the readers' and models' tests, synthetic fixtures, the database harness, the browser smoke |
| `docs/STATUS.md` | where the work stands: done, now, next |
| `docs/LEDGER.md` | every decision, and the measurement behind it |

## How we know the numbers are right

```
npm test          # the readers and models over the fixtures: refusals, held rows, month maths, exports
npm run test:db   # the same fixtures through the RPCs and views on a local Postgres: RLS per role, recounts, parity with the JS models
npm run smoke     # the page in a real browser, demo mode: drop everything, Record, read every page, save the PDF, export the .xlsx
```

The same three run on GitHub Actions for every push and pull request (`.github/workflows/test.yml`), the database one against a `postgres:16` service.

Every reader was checked against a real export of its kind (HH2, United Rentals, Sunbelt, Herc, EquipmentShare, Sage rate tables, Purchase Pro, the Projects register); the Herc total matched the report's own Totals row and the Sunbelt sum an independent calculation. None of those files is in this repo: it is public, and the fixtures are made up by `tests/fixtures/make_fixtures.js`.
