# GR Cost — where things stand

**Done:** the whole first release, in demo mode end to end. Five feeds read by content and refuse rather than guess: HH2 Labor Detail, the vendors' on-rent reports (United Rentals, Sunbelt's account and all-jobs exports, Herc, EquipmentShare, the page's own CSV), Purchase Pro's PO export, Sage's rate table export, the Projects register. Labor priced at Sage rate tables by certified class and pay ID, with every held reason named and priced the moment Settings answers. Rentals at run-rate with the job's tax and markup, off-rent derived, statements for the client. Purchases from the latest PO export with quotes, cancellations and no-amount POs kept apart. Portfolio by campus, Job, Report (Save as PDF), Statement, Update, Settings. The database: migrations, RLS by role (viewers never see a name), recount on every record, superseding with a reason, views the page and the tests share. Then: purchase decisions in the page (count a waiting PO on a job, or leave it out, kept by PO number through the next export), the GRforecast monthly-totals export, and CI on GitHub. Then the Job Cost To Date feed: each job's ledger read whole, the charges that come back every month found on it and confirmed as monthly rentals (or set aside) on the job page, counted under Rentals with the job's markup; rental POs shown apart from purchases; a new job's tax by campus. Then site services: the porta-potties, trailers (the sleeves under one contract make an x-plex) and storage containers counted off the month's reports, and the dumpster log, with pulls counted off the ledger where the hauler invoices a pull at a time and the log winning wherever it has entries. 143 checks in Node, 135 in SQL, 65 in the browser.

**Now:** stand it up. A Supabase project, its URL and publishable key in `app/config.js`, the migrations and seed applied with your email as the first owner, Cloudflare Pages on this repo. Then drop last week's real files on Update and read the cards.

**Next:** the CDR Sage rate table export (the seed carries placeholder Iowa rates until it lands); the Sage exports for SBN, BWI, AUS, PHL, DFW go in the same way. One real Mission Critical Warehouse export so its reader can be confirmed. Then Phase 2: the CC inbox for purchases (needs the domain decision), the HH2 timecard PDF cross-check, and the GRforecast monthly-totals handshake.

## Waiting on Shane

- **Inbox domain** for Phase 2: a subdomain of grforecast.com if its DNS is on Cloudflare, or libertybuilds.com's DNS moved to Cloudflare (mail stays on M365), or a dedicated domain.
- **United Rentals**: the All Jobs export was identified by its own header ("Equipment Source", "MonthlyRate") and the account label; confirm the as-of in its file name is the day it was pulled.
- **CDR's Sage rate table export** (#225121, #225120, #226021, #225104) to replace the placeholder rates in `supabase/seed.sql`.
- **Mission Critical Warehouse**: one real on-rent export.
- Whether Outlook/M365 vendor mail should be read for order confirmations (only Gmail and Drive were used so far).

## Parked

- The HH2 timecard PDFs (REG/OT/DT per employee-week) as a cross-check on the Labor Detail export: Phase 2.
- A phone form for the rare buy with no paper trail: Phase 3.
- Pulling United Rentals and Sunbelt by API where access exists: Phase 3.

## Worth knowing

- The release that is running is in the bottom-left corner (v0.1.0). If the page ever says a part is from the previous release, press Ctrl+F5.
- **Report (PDF)** opens the browser's print dialog: choose **Save as PDF**.
- Nothing recorded is ever edited. A wrong file is superseded with a reason, and the old one is kept.
- This repo is public. No real export, rate sheet, register or email goes in it; the fixtures are synthetic.
