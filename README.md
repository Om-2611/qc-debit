# Dalmia Polypro — QC Debit Note

Web application that replaces the "Debit Note Format.xlsx" workbook (form ref **DPIPL/QA/F-11**) used to
raise Debit Notes against PET-bale suppliers for short weight and contamination.

**Build status:** all seven phases are complete. See `HANDOVER.md` for go-live decisions, deployment and operating notes.
Railway deployment notes are in `HANDOVER.md` under "Deploying".

## Layout

| Path | What it is |
|---|---|
| `packages/calc` | Pure TypeScript calculation engine. Used by the web app for live preview and by the API as the authoritative recompute. No React, no database. |
| `packages/types` | Shared roles, statuses, zod schemas and the **role × status permission matrix**. |
| `apps/api` | Express + Prisma + PostgreSQL. JWT access tokens, rotating refresh tokens, role guards, PDF and Excel export. |
| `scripts` | Manual check that recalculates exported workbooks in real Excel. |
| `Dockerfile`, `docker-compose.prod.yml` | Production image (API serves the built web app) and stack. |
| `apps/web` | React 18 + Vite + MUI, themed from tokens sampled from dalmiapolypro.in (`apps/web/src/theme/brand.md`). |

## Setup

Requires Node 20+, pnpm 10+, Docker.

```bash
cp .env.example .env          # then replace both JWT secrets (command is in the file)
pnpm install
pnpm db:up                    # Postgres 16 in Docker, on host port 5433
pnpm db:migrate               # apply migrations
pnpm db:seed                  # users, materials, parameters, norms, rates, settings, sample report
pnpm dev                      # API on :4000, web on :5173
```

Postgres is mapped to **5433**, not 5432, so it never collides with another local Postgres.
Change `POSTGRES_PORT` and both database URLs in `.env` if you need a different port.

### Seeded users

All get the password in `SEED_DEFAULT_PASSWORD` (default `ChangeMe@123`). **Change these before go-live.**
Re-running the seed never overwrites existing users, parameters or settings.

| Role | Email | Lands on |
|---|---|---|
| ADMIN | admin@dalmiapolypro.local | Dashboard |
| GATE | gate@dalmiapolypro.local | Reports |
| RM_STORE | store@dalmiapolypro.local | Reports |
| QC_ANALYST | analyst@dalmiapolypro.local | Reports |
| STORES | stores@dalmiapolypro.local | Reports |
| QC_MANAGER (shown as "Purchase Manager") | manager@dalmiapolypro.local | Approvals |

The seed also stores the workbook's worked example (Party ABC, truck MH 15 XY 1234) as approved report
`QC-SAMPLE-0001`: standard ₹51,818.86, approved ₹43,791.62.

### Commands

| Command | Does |
|---|---|
| `pnpm test` | All tests. API tests use a separate `dalmia_qc_test` database (created automatically) and refuse to run against any database whose name does not end in `_test`. |
| `pnpm test:calc` | Calculation engine only. |
| `pnpm typecheck` | TypeScript across all packages. |
| `pnpm build` | Production builds of API (`apps/api/dist`) and web (`apps/web/dist`). |
| `pnpm db:reset` | Drop, re-migrate and re-seed the development database. |

## Security model

- Access token: JWT, 15 minutes, held in memory by the web app. Refresh token: JWT in an `httpOnly`,
  `SameSite=Strict` cookie scoped to `/api/auth`; only its SHA-256 hash is stored.
- Refresh tokens are one-time-use. Replaying an already-rotated token revokes the whole login family.
- Every request re-reads the user, so deactivating a user or changing their role applies immediately.
  Both also revoke that user's refresh tokens, as does an admin password reset.
- `ADMIN` passes every role guard. An admin cannot demote or deactivate themself, and the last active
  admin cannot be removed.
- The API refuses to start in production with the placeholder JWT secrets.
- The web app only hides and disables; every rule is enforced by the API.
- **Rate visibility.** Each user has a `canSeeRates` flag (Settings → Users → "Sees rates"), off by default for
  QC_ANALYST and RM_STORE. For a user without it the API strips rates and **every rupee figure** from reports, the
  reports list and the audit log, and refuses the narration endpoint — an amount ÷ a quantity is a rate, so hiding
  the rate alone would not do. Weights, readings, percentages and kg quantities remain. ADMIN always sees rates.

### Who can edit what, and when

Defined once in `packages/types/src/permissions.ts` and unit-tested.

| Section | Sheet rows | Owner | Editable while |
|---|---|---|---|
| Consignment details (header, without GRN) | 10–13 | GATE | DRAFT, INVOICE_ENTERED, WEIGHTS_ENTERED |
| Weights — "As per Supplier Invoice" and the Dalmia rate (from the PO) | 15–17, 20 | GATE | DRAFT |
| Weights — "As per Dalmia" (weight, bales) | 18–19 | RM_STORE | INVOICE_ENTERED |
| Bale weights, QC readings, No. of Bales affected | 24–39 | QC_ANALYST | WEIGHTS_ENTERED, QC_ENTERED (after a send-back) |
| GRN No. | I13 | STORES | QC_ENTERED |
| Purchase allowed (per parameter), shortage adjustments, tolerance, remarks | N, 43–51 | QC_MANAGER | PENDING_APPROVAL |

Six roles: the Gate, the Raw Material Store and Stores are separate logins (client decisions, 21–22-09-2026). The weights grid is one
table on screen, but each desk can only type — and the API will only accept — its own rows; a save that mixes both
desks' rows is rejected unless it comes from an admin.

```
DRAFT ──Gate: Submit to RM Store──▶ INVOICE_ENTERED ──RM Store: Submit weights to QC──▶ WEIGHTS_ENTERED
      ──Analyst: Submit QC──▶ QC_ENTERED ──Stores: Submit GRN to Purchase──▶ PENDING_APPROVAL ──Manager: Approve──▶ APPROVED
                                                                                    └─Manager: Send back──▶ QC_ENTERED (with a note;
                                                                                      the Analyst's resubmit skips Stores because the GRN is already there)
```

ADMIN may edit any section of an in-progress report. **Nobody edits an APPROVED report** — an admin must
Reopen it with a reason (returns to PENDING_APPROVAL, logged).

"Sent back" is not a stored status: the report returns to QC_ENTERED carrying the manager's note.

### Report workflow rules

- **Report numbers** are `QC/26-27/0001`: a running number within the Indian financial year (Apr–Mar) of the report date.
- **Every save recomputes on the server** with the database's norms and rates; figures sent by a browser are ignored. The page shows the same engine's result live while typing.
- **Submit to RM Store** (Gate) needs a party name, a truck number, at least one supplier invoice weight, and the Dalmia rate for every material invoiced.
- **Submit weights to QC** (RM Store) needs at least one Dalmia weight. The Dalmia number of bales is optional here, but Dirty bottle needs it later (see below).
- **Submit QC** needs at least one sample bale weight, and a bale weight for every bale that has kg readings. The report waits in QC_ENTERED for Stores.
- **Submit GRN to Purchase** (Stores) needs the GRN number; it moves the report to PENDING_APPROVAL. Approval also refuses a report without a GRN.
- **Approve** needs a description when "Other (Please Specify)" has a weight. Approval freezes the figures and the Tally narration.
- **Reopen** (admin, with a reason) returns the report to PENDING_APPROVAL; when it is next saved it is recalculated with the norms and rates in force at that time.
- **Two people editing at once:** a save based on an out-of-date copy is rejected (409) rather than overwriting the other person's work.
- **Audit:** one row per changed field (who, when, old, new) plus one per status change; `GET /api/reports/:id/audit`.

## Excel import (Admin → Import)

Upload one `.xlsx`: every sheet that looks like the template ("QC Report" in rows 1–12, "QC Parameters" in column A)
becomes one **approved, imported** report; other sheets are listed and ignored. Fields are found by their label text
first and by the fixed cells second, so a row shifted by one still imports. The preview shows each sheet's truck, GRN,
date, party → supplier match, the sheet's own totals and the engine's, and flags duplicates (same GRN, or same truck +
invoice) as *Skip* with an *Overwrite* option. On confirm the report stores the sheet's own figures as its snapshot;
if the engine disagrees by more than ₹1 on either the standard or the approved total, the report carries a **Mismatch vs. Excel** chip with per-row detail. An import
can be undone within 24 hours; imported reports cannot be reopened (undo and re-import instead).

## Exports

Exports are **ADMIN only** (client decision, 21-09-2026) — other roles get a 403 and do not see the buttons. Each export is written to the audit log.

**PDF** (`GET /api/reports/:id/export.pdf`) — one A4 landscape page in the app's fonts and colours, each block in a ruled box and the Tally narration highlighted on two lines, with the logo, the
company address block and form ref DPIPL/QA/F-11, the full QC and shortage tables, remarks, Tally narration and
sign-off. Reports that are not yet approved carry a "NOT APPROVED" watermark. Amounts are headed INR rather than ₹
because the embedded font subset has no rupee glyph.

**Excel** (`GET /api/reports/:id/export.xlsx`) — the report written into the client's own sheet
(`apps/api/assets/debit-note-template.xlsx`), inputs as values and **formulas intact**, so it recalculates and
prints in Excel exactly like the workbook Dalmia uses today. Details:

- Reports dated Oct–Jun use the sheet's rest-of-year rows (27 Moisture, 29 Dirty bottle); the export gives those rows
  the formulas the template lacks.
- Where the sheet has no Approved formula (rows 28–30, 46–47) the app's approved figures are written as values.
- Template defects are corrected in the exported copy only: `O47` becomes `=-L21`, `R31` gets its missing
  subtotal, and row 28 tests against the norm cell instead of a typed 4.
- Every formula cell's cached result is set to the app's figure, so phone previews and this app's importer read the
  right numbers even if the file was never opened in Excel. `V8:V10` (outside the print area) show the report number
  and the app's approved total for a quick cross-check.
- If an admin changes a rate rule away from the sheet's (for example switches Non Food Grade-PET on), Excel's
  recalculated total will differ from the app's; `V10` makes that visible.

**Blank template** (`GET /api/reports/template.xlsx`) — the same sheet with all sample data removed.

### Checking an export against real Excel

```bash
pnpm --filter @dalmia/api test     # writes apps/api/tmp/export-*.xlsx
powershell -ExecutionPolicy Bypass -File scripts/verify-excel-export.ps1 | node scripts/compare-excel-export.mjs
```

This opens each exported file in Microsoft Excel, forces a full recalculation and compares about 100 cells per file
with the app's figures. It needs Excel installed, so it is a manual check rather than part of `pnpm test`. Last run
(21-09-2026): both the Jul–Sep and the rest-of-year file matched on every cell.

## Business rules — the workbook is the authority

Decision (client, 21-09-2026): **everything follows "Debit Note Format 1.xlsx"**. The engine reproduces the
sheet's formulas; every rule below is stored in the database and editable under Admin → Settings.

| Rule | Sheet | App |
|---|---|---|
| Moisture, Iron/Patti, Raffia | excess % × total Dalmia weight (M18) × dominant material's rate | Same |
| Colour Bottle-PET, Non-Pet | excess % × Clear weight (E18) × (**Clear rate − 20**, `=$E$20-20`) | Same (`CLEAR_RATE_MINUS_20`) |
| Aluminium-PET | excess % × Clear weight × 10 | Same |
| Dirty bottle (row 28) | excess % × **No. of Bales** (column M) × average truck bale weight (M18 ÷ M19) × 10; the amount is charged only while actual is **below 6%** | Same. "No. of Bales" is typed by the QC Analyst and is required once the parameter is over norm. |
| Jar-PET (row 30) | excess % × **No. of Bales** × average of the sampled bale weights × 5 | Same |
| Non Food Grade-PET, Metal | no formulas — never deduct | Recorded and highlighted, **not deducted** (`isDeductible = false`) |
| Purchase allowed (column N) | The original sheet typed a concession in points (0.45) and used `(actual − N − norm)%`. **Changed by the client on 22-09-2026:** N is now the **total % purchase accepts** (e.g. 7 against a norm of 5) | Approved = `(N − norm)% × total Dalmia weight (M18) × rate`, floored at 0 (**changed by the client on 23-09-2026**; before that it was `(actual − max(N, norm))%` × the parameter's weight base). N must lie between the norm (D) and the actual % (L): the API refuses anything outside that range, the entry cell will not accept a value above L, and the engine and the exported R/S formula clamp it to that range. It always uses M18, even for Clear-weight and per-bale parameters. Blank N = approved 0. The dirty-bottle 6% cut-off still zeroes the amount. The Excel export writes this formula into R/S; the importer converts old-style values (below the norm) to the new convention |
| Weight short (row 43) | total truck shortfall × Clear rate, when received ÷ invoiced < 0.995 | Same (`toleranceFraction` 0.005). Exactly 99.5% is not charged. |
| Barwaste (row 44) / Green (row 45) | premium over Clear on short Barwaste; price difference on excess Green | Same |
| Weight Tolerance (row 50) | displayed, never used by a formula | Informational; `useWeightToleranceRow` can switch the test to it |
| Actual % | Σkg ÷ Σbale weight for kg rows; simple average for Moisture | Same |
| Seasonal norms | Jul–Sep rows 26/28 (Moisture 5%, Dirty bottle 4%); other months rows 27/29 (3%, 3%) | Same, chosen by report date (Asia/Kolkata). Only the active norm is shown. |

Where the app does **not** copy the sheet, because the sheet is simply wrong there:

| Sheet defect | App |
|---|---|
| Row 47 "Other" takes its quantity from the rate cell (`O47 = -L20`, should be `-L21`) | Quantity comes from the weight difference |
| Rows 46–47 have no Approved formulas, so the approved total silently drops them | Approved = standard for these rows; an excess gives 0 rather than a credit (`allowNegativeOtherShortage`) |
| Rows 28 and 30 have no Approved formulas | Approved uses the same per-bale formula with the purchase adjustment |
| R31 has no formula, so Total (A+B) approved **qty** leaves out Moisture | Summed correctly (amounts are unaffected) |
| Total row adds contamination kg to shortage kg | Amounts only |
| Rows 27 and 29 (rest-of-year) carry norms but no formulas | The same formulas apply all year with the season's norm |
| Dirty bottle's test hard-codes 4 and Jar's hard-codes 2 instead of the norm cell | The norm in force is used |

Other behaviour worth knowing:

- **Dominant material** is the one with the largest Dalmia weight; ties go to the leftmost column.
- Dirty bottle needs the Raw Material Store's **Dalmia number of bales** (M19) for the average bale weight; submit-QC asks for it if missing.
- **Tally narration** rounds amounts to whole rupees and quantities to 2 dp, and ends with `and GRN No. <number>.`
- Money and quantities are stored at 4 dp and rounded to 2 dp only for display and export.
- Approved reports keep a snapshot of their figures, so later changes to norms or rates do not alter history.
  The migration that introduced the sheet's rules (`sheet_formula_defaults`) left approved reports untouched.

### Verified against the real workbook

`apps/api/test/fixtures/debit-note-format.xlsx` is the client's "Debit Note Format 1.xlsx". The test
`apps/api/test/workbook-parity.test.ts` reads the inputs from that file, runs the engine under sheet-parity
defaults and compares every row's actual %, rate and columns P–U, the subtotals and Total (A+B+C) with the values
Excel cached in the file. All match (Q49 = 51,818.86, S49 = 43,791.62).

Corrections to the cell map in the build brief, for the importer (phase 5):

| Field | Brief said | Real workbook |
|---|---|---|
| Report date | right of "Date" in row 9 (L9) | **L10** (label in K10); "QC Report" title is A10 |
| Checked by / Approved by | row 53 | labels in **A54 / J54** |
| Shortage adjustment | — | **N43–N45** |
| "No. of Bales" per parameter | — | column **M** (M28, M30), used by rows 28 and 30 |
| Typed inputs | plain values | some are formulas (H26 is `=5.38`), so inputs must also be read by cached result |
| Sheet name | tab per truck, template "Format" | this file has the single sheet "Format" |

Other rules worth confirming:

- **Actual %** for kg parameters is Σkg ÷ Σbale weight (weight-weighted), as in the sheet's column L —
  not the mean of the per-bale percentages. Moisture is the simple average of its % readings.
- **Season** (Moisture, Dirty bottle) follows the report date in Asia/Kolkata: 1 Jul – 30 Sep is monsoon.
- **Purchase allowed** is the total % the Purchase Manager accepts; the approved deduction is the part of the actual %
  above it (never more than the standard deduction, never below zero). Standard is always measured from the norm.
- **Dominant material** is the one with the largest Dalmia weight; ties go to the leftmost column.
- **Barwaste** short weight is charged at the premium over Clear (the kilograms themselves are already in
  the Clear row). **Green** is charged on excess, at the Green − Clear price difference.
- **Tally narration** rounds amounts to whole rupees and quantities to 2 dp, and ends with
  `and GRN No. <number>.`
- Money and quantities are stored at 4 dp and rounded to 2 dp only for display and export.
- Approved reports keep a snapshot of their figures, so later changes to norms or rates do not alter history.

## Brand

Tokens were sampled from the live website; method and raw values are in `apps/web/src/theme/brand.md`,
and admins can review them under **Settings → Appearance**. Two items need client confirmation:

1. **Logo** — `apps/web/public/brand/` holds the logo from the website and a favicon cropped from it.
   Written approval is required before shipping; without the files the app shows a "Dalmia Polypro" wordmark.
2. **Fonts** — the site uses Avenir (commercial) and Century Gothic, which cannot be self-hosted.
   The app uses Nunito Sans as the closest open-licence match, and JetBrains Mono for figures.
