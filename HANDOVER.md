# Handover notes — Dalmia Polypro QC Debit Note

Written for: whoever takes this system live and supports it (an IT admin at Dalmia or the next developer).
The README covers setup and the business rules; this file covers what to decide, check and watch.

## 1. What is delivered

All seven phases of the build brief are done:

| Area | Where |
|---|---|
| Login, five roles, section locks, audit trail | `apps/api/src/auth`, `packages/types/src/permissions.ts` |
| Calculation engine matching the client workbook cell for cell | `packages/calc`, proof in `apps/api/test/workbook-parity.test.ts` |
| Report entry (Gate → RM Store → QC Analyst → Stores → Purchase Manager), live calculation | `apps/web/src/pages/reports` |
| Approval queue with quick view | `apps/web/src/pages/approvals` |
| PDF and Excel export (admin), blank template download | `apps/api/src/export` |
| Excel import with preview, duplicate check, mismatch flag, undo | `apps/api/src/import`, `apps/web/src/pages/import` |
| Admin settings: users, suppliers, materials, parameters (norms/rates), global switches, appearance | `apps/api/src/admin`, `apps/web/src/pages/settings` |
| Dashboard: KPIs, four charts, Excel view + export | `apps/api/src/dashboard`, `apps/web/src/pages/dashboard` |
| Audit log viewer on every report | `apps/web/src/pages/reports/AuditDrawer.tsx` |
| Production Docker image + compose | `Dockerfile`, `docker-compose.prod.yml` |

Automated tests: `pnpm test` (engine, permissions, API incl. imports/exports/admin/dashboard).
Manual Excel cross-check: `scripts/verify-excel-export.ps1` (needs Microsoft Excel).

## 2. Before go-live — decisions still open

1. **Logo.** `apps/web/public/brand/dpipl_new_logo.png` and `apps/api/assets/logo.png` were taken from dalmiapolypro.in.
   Get written approval, or delete both files and the app falls back to a text wordmark.
2. **Gate → RM Store order.** The store cannot enter Dalmia weights until the gate has submitted the invoice rows.
   If trucks are sometimes weighed before the gate paperwork is complete, this is a one-line change in
   `packages/types/src/permissions.ts` (`dalmiaWeights.statuses`).
3. **Who types the Dalmia rate.** The Gate, from the PO, with the invoice rows (decided 22-09-2026 so the store need
   not see rates). If Purchase would rather own it, the Purchase Manager can be given that row instead.
4. **Rate visibility.** QC Analyst and RM Store users do not see rates or amounts; an admin can switch it on per user
   (Settings → Users → "Sees rates"). New users of those two roles start with it off.
5. **GRN.** A separate **Stores** login types it after QC (4th in the flow) and forwards the report to the Purchase Manager. Neither the Gate nor the RM Store sees a GRN field.
6. **Correcting weights after submission.** Only an admin can. If the gate or store should be able to reopen their own
   step, that is a workflow change to discuss.
7. **Business-rule table in the README.** The app follows the client workbook; the "sheet defects not copied" list
   should be shown to the Purchase Manager once so nobody is surprised by the small differences (e.g. the "Other" row's quantity).
8. **Shortage of Green is charged at the Clear rate** (found 2026-11-04 while building the TCS iON push; the app copies
   the workbook, so the calculation is unchanged and this needs the Purchase Manager's decision). The "Weight Short" row
   charges the truck's whole shortfall at the Clear rate, whichever material was short, and the Green row only handles
   *excess* Green. Worked example (engine run, no tolerance): Clear invoiced 10,000 kg = received 10,000 kg at Rs 30;
   Green invoiced 5,000 kg, received 4,000 kg at Rs 20. Green is 1,000 kg short, worth Rs 20,000 at the Green rate, but
   the debit comes out at **Rs 30,000** (1,000 x 30). The iON pre-flight check "debit must not exceed the invoice's
   taxable value" does not catch this: it only fires when the debit is above the whole invoice.
9. **Shortage of "Others" (and "Barwaste With Ring") may be charged twice.** Same cause: the Clear row already charges every
   short kilo at the Clear rate, and the Others row then charges its own shortage again at its own rate. Worked example:
   Clear 10,000 kg in and out at Rs 30; Others invoiced 1,000 kg, received 900 kg at Rs 10. The 100 kg short is charged
   Rs 3,000 in the Clear row (100 x 30) **and** Rs 1,000 in the Others row (100 x 10): a debit of **Rs 4,000** for a
   100 kg shortage. (Barwaste is not affected: its row only adds the rate difference, giving 100 x 25 = Rs 2,500.) It may be
   how the client's workbook was meant to work; ask the Purchase Manager before changing anything.

## 3. Deploying

The image serves the API and the built web app from one origin. Locally it defaults to port 4000; on Railway it
uses Railway's `PORT` automatically. HTTPS must be terminated in front of it, because the login cookie is marked
Secure in production.

### Railway

1. Create a Railway project and add a PostgreSQL service.
2. Add an app service from this repository. Railway will detect the root `Dockerfile`.
3. In the app service variables, set:

```bash
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
WEB_ORIGIN=https://your-app-domain.up.railway.app
JWT_ACCESS_SECRET=<48+ random characters>
JWT_REFRESH_SECRET=<48+ random characters>
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL_DAYS=7
SEED_DEFAULT_PASSWORD=<temporary first-login password>
VAPID_PUBLIC_KEY=<from: pnpm --filter @dalmia/api vapid:keys>
VAPID_PRIVATE_KEY=<from the same command; keep it secret>
VAPID_SUBJECT=mailto:<an address the IT team reads>
```

The VAPID keys switch on browser push notifications. Generate them **once** per deployment and never rotate them
casually: new keys mean every user has to turn notifications on again. Without them the app still works and the
header bell still lists hand-offs; only the pop-up notifications are off. The local `.env` has dev-only keys; never
reuse those in production.

Use the actual PostgreSQL service name in the `DATABASE_URL` reference if it is not `Postgres`. After the first
successful deploy, install/login to the Railway CLI, link the project, and run the seed once from this local checkout:

```bash
npm install -g @railway/cli
railway login
railway link
railway run pnpm --filter @dalmia/api exec tsx prisma/seed.ts
```

Then change every seeded password under Settings -> Users before real use.

### Docker compose

```bash
cp .env.example .env.production          # then set real values:
#   POSTGRES_PASSWORD, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (48+ random chars each),
#   WEB_ORIGIN=https://qc.example.in
#   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (pnpm --filter @dalmia/api vapid:keys), VAPID_SUBJECT
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml exec app npx tsx prisma/seed.ts   # first time only: users, materials, rules
```

The seed creates the five demo users with the password from `SEED_DEFAULT_PASSWORD`. **Change every password
under Settings → Users before real use, and delete the demo accounts you do not need.**

Backups: the database is the only state that matters (`pgdata` volume). A nightly
`docker compose exec db pg_dump -U <user> <db> > backup-$(date +%F).sql` kept off the machine is enough.
Import previews live in `apps/api/tmp` and are disposable.

Upgrades: `git pull` (once the repo is under git), rebuild the image, restart. Migrations run on start.

## 4. Operating it

- **Purchase allowed** (Purchase Manager, one per parameter) is the total % accepted and must lie between the norm
  (D) and the actual average % (L). Approved amount = (purchase allowed − norm)% × total Dalmia weight (M18) × rate;
  blank = nothing approved for that parameter. The old workbook typed this as points above the norm (0.45); the
  importer converts such values (0.45 → 5.45 for a norm of 5).
- **Notifications**: when a desk submits a report, every active user of the next desk (RM Store → QC Analyst →
  Stores → Purchase Manager) gets a notification in the header bell, and a pop-up on each device where they chose
  "Turn on" in the bell. Send-backs and approvals do not notify. The bell refreshes every 30 s even without push.
  Push works in Chrome, Edge and Firefox on Windows/Android, not in incognito windows; on iPhone only after "Add to
  Home Screen" (iOS 16.4+). Signing out stops that device receiving the user's notifications. The server must be able
  to reach the browsers' push services (fcm.googleapis.com, updates.push.services.mozilla.com, *.notify.windows.com).

- **Rules and rates** change under Settings → Parameters, always "from a date". Reports dated before that date keep
  the old rule; approved reports never change. The Excel export of a report shows the app's total in cell V10 so a
  changed rule is visible when the file is recalculated in Excel.
- **Imports**: one workbook, one tab per truck, or the single "Format" tab. Duplicates (same GRN, or same truck +
  invoice) are skipped unless "overwrite" is chosen. An import can be undone within 24 hours. Imported reports cannot be
  reopened; undo and re-import instead. A "Mismatch vs. Excel" chip means the sheet's own total differs from what the
  engine computes from the same inputs (usually a hand-edited cell in the old sheet); the stored figures are the sheet's.
- **Sent back** reports show the manager's note at the top for the analyst.
- **Audit log** button on every report shows every change with who and when.

## 5. Known limitations

- No e-mail: password resets are done by an admin under Settings → Users.
- No mobile layout; laptop and tablet (≥ 1024 px) are supported.
- Three sample bales, five materials and ten parameters are fixed by the Excel layout. Parameters can be renamed and
  switched off, not added; a new parameter would need a code change and a new row in the export template.
- Browser end-to-end checks were run by hand with Playwright during the build; they are not in the repo's test suite.
- The project folder is under OneDrive and not yet under git. Run `git init && git add -A && git commit` before
  anything else is changed.

## 6. Where things are

```
apps/api/assets/debit-note-template.xlsx   the client's sheet, used for export and as the import layout
apps/api/test/fixtures/debit-note-format.xlsx  the same file, as the parity fixture
apps/web/src/theme/brand.md                how the brand colours and fonts were sampled
packages/calc/src/defaults.ts              the norms and rates as seeded (mirrors the workbook)
```
