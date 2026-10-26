@AGENTS.md

# Odama OS

Odama's internal studio workspace: clients, projects, tasks, time log,
project health, invoices and Xendit payments. Source-of-truth spec:
`PRD/PRD-Fase-1-MVP.md` (Phase 1, M0–M5). Status per milestone:
`docs/BUILD_PLAN.md`. Notable decisions and deviations: `docs/DECISIONS.md`.
Visual language: **Fluid Functionalism** (https://www.fluidfunctionalism.com/docs)
— every component, style detail and motion comes from it (decision in
`docs/DECISIONS.md`); `docs/DESIGN_STYLE.md` is superseded where they differ.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript
- Tailwind v4 + **Fluid Functionalism** (Base UI flavor, rounded, compact, Untitled UI icons; `components/fluid-root.tsx`), Inter (opsz), system theme default + light/dark (next-themes). Add more with `npx shadcn@latest add @fluid/base/<name>`
- Icons: **Untitled UI Icons only** (`@untitledui/icons`) via `components/icon.tsx` — never import an icon package elsewhere
- Prisma 6 (pinned) + PostgreSQL — Supabase (CLI locally; **Supabase Cloud + Vercel** in production, reached through the Supavisor pooler: transaction mode at runtime, session mode for migrations)
- Supabase Auth (email + password, invite-only) and Storage (private buckets)
- Resend (email), Slack Web API (bot DMs), Xendit (payment links + webhook)
- Zod (`lib/validation.ts`), React Hook Form, TanStack Query, dnd-kit, Tiptap, Vitest, Puppeteer (invoice PDF)

## Non-negotiables

- **Access rules live in the database (RLS).** Every user-facing read/write
  goes through `withRls(user.id, tx => …)` / `asUser(user, …)` (`lib/db.ts`,
  `lib/auth.ts`), which runs as the `authenticated` role with the user's JWT
  claims. The system connection (`prisma` from `lib/prisma.ts`) bypasses RLS
  and is only for: auth resolution, webhooks, scheduled jobs, notifications,
  audit writes, and the server half of an action whose permission was already
  proven under RLS. Never "check in code, then read with `prisma`" for data a
  user asked for.
- Policies, helper functions (`app.*`) and guard triggers are in
  `prisma/migrations/*_rls/migration.sql`. **Every new table needs RLS enabled,
  explicit grants, and policies in the same migration**, plus a case in
  `tests/rls/`. `lib/roles.ts` (`perms`) only decides what the UI offers.
- Derived rules are triggers, not app code: project codes, billable flag,
  out-of-scope rules, week locks, invoice locking, invoice numbering.
- Money: `numeric` + ISO currency, never float. Convert Decimal at the query
  boundary (`lib/money.ts`); sums in minor units (`lib/invoices/pure.ts`).
  Render only through `lib/format.ts` / `MoneyText`.
- Calendar dates are `yyyy-mm-dd` strings or UTC-midnight Dates; timestamps
  are UTC and shown in the viewer's zone (default Asia/Jakarta). In raw SQL
  compare dates as `${iso}::date`, never a JS Date.
- Health math is in `lib/health/pure.ts`; invoice math in `lib/invoices/pure.ts`;
  time math in `lib/time/pure.ts` — all unit-tested. Screens never recompute.
- Every mutation: validate with Zod, write under RLS, call `logActivity`
  (`lib/audit.ts`), wrap in `run()` (`lib/actions.ts`) so database refusals
  come back as user-facing messages.
- Notifications only through `notify()` / `notifyMany()` (`lib/notify.ts`):
  Slack DM + in-app inbox, logged in `notification_log`.
- Key entities are archived / deactivated, not deleted.
- Reuse shared components (`components/`): `DataTable`, `PageHeader`,
  `PillButton`, `LinkButton` (server components never use `Button asChild`), `StatusBadge`, `MoneyText`, `HealthIndicator`, `FormField`,
  `SelectField`, `DatePicker`, `AmountInput`, `EmptyState`, `ConfirmDialog`,
  `RowActions`, `DashboardCard`. No one-off patterns. Design QA is part of done.

## Commands

```
pnpm db:up          # supabase start (local Postgres, Auth, Storage, Inbucket)
pnpm db:migrate     # prisma migrate dev
pnpm db:seed        # realistic seed (one person per role)
pnpm db:seed:history # + a year of history (clients, projects, time, invoices, payments, expenses); run once
pnpm dev            # Next dev (Turbopack)
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm test:rls       # RLS + invoice-flow integration tests; WIPES TEST_DATABASE_URL
pnpm cloud:migrate  # prisma migrate deploy to Supabase Cloud (.env.cloud); also cloud:status, cloud:seed, cloud:buckets
```

## Local auth

With the Supabase env vars set, sign in with a seeded email and
`SEED_PASSWORD`. Without them, `DEV_AUTH_BYPASS=true` signs you in as
`DEV_AUTH_EMAIL` (default: first `ADMIN_EMAILS`) — change it to test a role.
Supabase setup (local + Cloud/Vercel): `docs/SUPABASE_SETUP.md`. The self-hosted
VPS path in `docs/VPS_DEPLOY.md` is legacy.

## RLS tests

`pnpm test:rls` drops and re-migrates the `public` and `app` schemas of
`TEST_DATABASE_URL`. Run it only against the local Supabase database or a
separate staging Supabase project — never against the production project, and
never with `.env.cloud` values.

## Workflow (PRD "Tips build")

One milestone at a time; start from the migration + RLS policies, then UI.
Write RLS tests for new tables. Run typecheck/lint/test/test:rls/build.
Design QA before "done".
