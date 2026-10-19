# Odama OS — Phase 1 build status

Spec: `PRD/PRD-Fase-1-MVP.md`. Everything below runs on a fresh database from
`prisma/migrations` (schema, RLS, dashboard, expenses, C-Level dashboard). Verification commands:
`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:rls`.

## Status by milestone

| Milestone | Built | Where |
| --- | --- | --- |
| **M0 Foundation** | Auth (email + password, invite-only), 7-day invitations + resend, forgot password, deactivate / reactivate (session ends), 6 roles + `is_admin`, RLS helpers + policies, People directory (search, role filter), own profile (name, avatar, time zone, notification mutes), Settings (reminder time, workdays, thresholds, currencies, invoice format & sender, studio profile), work categories, Slack linking + retry + test DM, `notify()` + in-app inbox, responsive app shell | `lib/auth.ts`, `lib/db.ts`, `lib/people/*`, `lib/notify.ts`, `lib/slack.ts`, `app/(app)/people`, `app/(app)/profile`, `app/(app)/settings`, `app/(auth)` |
| **M1 Client & Project** | Clients with code + contacts (one primary), archive / delete-if-unused, client page with projects & invoices; client and internal projects, auto codes (`ACME-001`, `INT-001`), contract type / currency / value, PM auto-member, General section, budget hours, retainer with none / full / capped rollover, members, statuses, project list with health + filters; CSV import (users → clients → projects, preview, skip/update, result CSV, send invitations) | `lib/projects/*`, `lib/clients/*`, `lib/import/*`, `app/(app)/projects`, `app/(app)/clients`, Settings → Import CSV |
| **M2 Task** | Sections (create, rename, reorder, archive), tasks (owner, collaborators, priority, status, due, estimate), list grouped by section with drag, kanban by status with drag + keyboard menu, filters (owner, priority, section, my tasks), overdue marking, My Tasks (Overdue / Today / This week / Later / No due date, kanban), rich-text description with image upload (private, 10 MB), comments with @mentions, edit/delete trail, activity history, Slack notifications | `lib/tasks/*`, `components/tasks/*`, `app/(app)/tasks/actions.ts`, `app/(app)/my-tasks` |
| **M3 Time Log** | Log time (task or category, `1h 30m` / `1.5`), out-of-scope flag with required note, weekly timesheet (Mon–Sun totals, empty workdays), edit/delete in open weeks, weekly lock, corrections (change / remove / add forgotten) reviewed by project PM or HR, daily reminder, HR compliance table + CSV | `lib/time/*`, `components/time/log-time-dialog.tsx`, `app/(app)/timesheet`, `app/(app)/approvals`, `app/(app)/people/compliance` |
| **M4 Project Health** | Budget vs actual (in-scope / waiting / approved OOS), retainer months with rollover history, breakdown by section & person (PM, C-Level), editable thresholds, once-per-threshold alerts with re-arm, OOS approval queue (bulk + note + notification), change requests per period + CSV + "invoiced" mark, health overview sorted by risk | `lib/health/*`, `components/health/*`, `app/(app)/health`, project page → Health / Change requests |
| **M5 Invoice & Payment** | Draft invoices from client projects (items, payment requests by % or amount, must equal total), edit/delete drafts, `ODAMA/{YY}/{SEQ}` numbering, PDF (stored, downloadable), Xendit link per request + renew, Send to client via Resend (preview, CC, resend, delivery log), webhook with token + idempotency, automatic matching → Partially paid / Paid, mismatch review flag, unmatched queue + manual match, overdue job (first day + weekly), invoice list with outstanding per currency, filters, CSV | `lib/invoices/*`, `lib/xendit.ts`, `app/(app)/invoices`, `app/(app)/payments`, `app/api/webhooks/xendit` |
| **Dashboard** (`PRD/OVERVIEW-SPEC.md`) | `/dashboard` as home, one card set per role (4 Phase 1 cards each: DD-1…4, PM-1…4, CL-1…4, HR-1…4, FN-1…4, SL-1…4), per-card loading / error / empty states, refresh, inline actions (task status, log time, approve / reject, assign owner, match payment, resend invite, send invoice), Phase 2 slots behind `DASHBOARD_PHASE2` | `lib/dashboard/*`, `components/dashboard-card.tsx`, `app/(app)/dashboard`, migration `…_dashboard` |
| **Expenses** (beyond PRD, `docs/DECISIONS.md`) | Manual expense ledger for Finance & C-Level: date, vendor, description, category, opex / capex, amount + currency, notes, optional receipt (PDF / image, private bucket); totals per currency (total / opex / capex), filters (type, category, currency, period, search), edit / delete | `lib/expenses/*`, `app/(app)/expenses`, `app/api/expenses`, `app/api/files/receipts`, migration `…_expenses` |
| **C-Level dashboard** (`PRD/Clevel dashboard.md`) | Period filter (this / last month, quarter, YTD, custom) with comparison; data-completeness warnings; revenue vs target (12 mo), receivables & aging, often-late clients, costs & studio margin (+ trend), client revenue/margin & concentration, 3-month forecast; portfolio, health (+ over-budget trend), delivery, margin per project, needs-attention with reasons; utilization studio / role / person, hours composition, capacity 4 & 8 weeks. Inputs on Business Data: people costs, capacity + overrides, utilization targets, revenue targets, FX rates, dashboard rules, change history; retainer fee on projects; project on expenses | `lib/clevel/*`, `app/(app)/dashboard/clevel`, `app/(app)/business`, `components/trend-chart.tsx`, migration `…_clevel` |
| **Jobs** | `due-reminders` 09:00, `time-reminders` 17:00 workdays, `oos-digest` 17:30, `lock-timesheets` Mon 00:00, `retainer-rollover` 1st 00:05, `overdue-invoices` 00:10, `budget-alerts` hourly; idempotent, logged in `job_runs` (Settings → Scheduled jobs). Backup: `scripts/backup.sh` 02:00 | `lib/jobs.ts`, `app/api/cron/[job]`, `docs/VPS_DEPLOY.md` |

## Verified

- **RLS suite** (`tests/rls/access.test.ts`, 36 cases): RLS on every table, nothing
  granted to `anon`, Designer & Dev only see their projects and never contract
  values, HR sees no budgets or clients, tasks hidden from non-members / Finance /
  HR, role & admin changes refused, settings admin-only, time rules (membership,
  locked weeks, completed projects, OOS review by the project's PM only),
  corrections routed to the right reviewer, invoices visible / editable per role,
  sent invoices locked, invoice numbering concurrent-safe and system-only.
- **Invoice flow** (`tests/rls/invoice-flow.test.ts`): two-request invoice →
  Partially paid → Paid, duplicate webhook is a no-op, payments linked to the
  project, sequential numbers, mismatch flag, unmatched queue, overdue and back.
- **In the browser** (local, simulated integrations): Send to client produced
  `ODAMA/26/0001`, the PDF, two payment links and the delivery log; paying through
  the simulator ended Paid with one payment per request; a designer logged time
  in the dialog; role restrictions redirect without leaking data.
- Unit tests: durations & calendars, health & rollover, invoice math, CSV
  parsing/validation, mentions, formatting.

## Not verified yet (needs the real services)

- Supabase Auth end-to-end on the local Supabase stack / VPS (Docker on the dev
  machine ran out of disk; tests used plain Postgres 16, which runs the same
  migrations). See `docs/SUPABASE_SETUP.md`.
- Resend, Slack and Xendit with real keys (code paths fall back to log /
  in-app inbox / simulator without them).
- Backup restore test on the VPS (PRD DoD).

## Open questions from the PRD (still to validate)

1. Xendit and foreign currencies — which currency the link is created in and
   which callback field carries the IDR received (see `docs/DECISIONS.md`).
2. Invoice sequence reset per year and the last number already used this year —
   set with `INSERT INTO invoice_sequences (year, last_number) VALUES (2026, N)`.
3. Sender domain for invoice emails must be verified in Resend.
4. The Figma invoice template — replace the markup in
   `components/invoice/invoice-document.tsx`, keep the data shape.

## Phase 1 end-to-end checklist (PRD)

- [ ] Admin invites the team; everyone can sign in
- [ ] Clients and projects imported from CSV, codes generated
- [ ] PM creates sections and tasks; team works on the kanban and comments
- [ ] A week of time logged; Slack reminders run; the week locks automatically
- [ ] One out-of-scope entry approved and listed as a change request
- [ ] A budget alert sent when a threshold is passed
- [ ] Sales issues an invoice with two payment requests; PDF from the studio template; Send to client delivered
- [ ] A Xendit test payment recorded automatically, invoice Paid, Finance notified
- [ ] Database backup restore tested
