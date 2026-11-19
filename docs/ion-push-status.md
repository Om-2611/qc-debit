# Load on TCS iON: status summary

As of 2026-11-19.

## What this is
When a QC report gets its final approval, an admin clicks "Load on TCS iON". A background robot (Playwright) then enters the debit note in TCS iON the same way the accounts team does by hand, submits it, and records the iON debit note number against the QC report. It never approves anything: approval stays with the accountant.

## Where we are
**The groundwork is finished and tested. The robot itself is not built yet, because it needs a recording of the real iON screens.**

## What has been done
- **Setup data.** Plants (DPNL is in), each supplier's iON code and state, and each material's iON item code, all editable in Settings.
- **Checks before loading.** One check lists everything that blocks a report from being loaded, and the button stays off until it's clear. For example: a missing supplier code, the debit being larger than the invoice, a wrong GRN format, or an unregistered supplier.
- **The entry itself.** The system works out exactly what will be typed into iON: amount, GST, Reason Details, and the narration with the QC number.
- **Job handling.**
  - Clicking the button creates a job and returns at once.
  - Only one job runs at a time.
  - Every job stops before Submit unless "full" mode is switched on.
- **Protection against duplicates.**
  - A QC report can only ever get one iON debit note.
  - If the robot stops after saving a draft, a retry reopens that same draft.
  - If it can't be sure what iON saved, it stops and asks for a manual check.
- **Alerts and history.** Admins are alerted if the iON session expires or a job needs a manual check. Every step, screenshot and iON number is recorded. An admin can reset a push, with a typed confirmation and a note.
- **Safety.** Loading is switched off by default, live iON is blocked, and importing can't be undone for reports already loaded on iON. Screenshots are stored compactly, and old ones are tidied after 30 days (failed jobs keep all of theirs).
- **Testing and records.** About 300 automated tests pass. The work is saved in local git, with nothing pushed anywhere. Two open shortage-rate questions are recorded in `HANDOVER.md` for the Purchase Manager.

## What is left
1. **The robot** that drives iON: login, the header, item amount, taxes, GRN apportionment and Submit, checking what iON shows at each step.
2. **The screen** on the QC report: the button, the list of what's missing, live status, the iON number and screenshots, plus Retry and Reset.
3. The iON number and status on the QC PDF.
4. A Plants settings screen.
5. A short operations guide (`docs/ion-push.md`).
6. A test against the iON training site only, never against live.

## Waiting on you
- **A recording of the full manual flow on iON training.** The recording received only opens the iON page and has no clicks in it. I also need to know which web address is correct: `.../dotcom/TCSSMB/` (in the recording) or `.../TCSiONHome/Home` (in your brief).
- The tax names for same-state suppliers (CGST/SGST). Until then, Maharashtra suppliers stay blocked.
- Whether to delete zero-amount item lines, and whether the TDS line is always deleted.
- The live iON address and IT's approval for automated entry.
- The accounts team's review of the short Reason Details names (for example "Iron", "Jar").
- The Purchase Manager's decision on the two shortage-rate issues.

## Errors
**None outstanding.** No tests are failing and nothing is broken. A few small problems came up during the build (the database was not running, and some of my own test mistakes), and all were fixed.

**Things to be aware of (not errors):**
- Nothing has been run against iON yet, so everything that touches iON is untested until the robot exists.
- The existing calculation can overcharge in two cases: a Green shortage is charged at the Clear rate, and an Others shortage may be charged twice. This is with the Purchase Manager, and the calculation has not been changed.
