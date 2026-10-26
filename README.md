# Odama OS

Odama's internal workspace — every piece of work and every invoice in one
place, connected to its project. The team knows its tasks, PMs know the
remaining budget, Sales and Finance see payment status without opening other
platforms.

- Spec: [`PRD/PRD-Fase-1-MVP.md`](PRD/PRD-Fase-1-MVP.md)
- Status per milestone: [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md)
- Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Setup (local) & production on Supabase Cloud + Vercel: [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md)
- Legacy self-hosted VPS deploy: [`docs/VPS_DEPLOY.md`](docs/VPS_DEPLOY.md)
- Agent guidance: [`CLAUDE.md`](CLAUDE.md)

## Getting started

```bash
pnpm install
cp .env.example .env     # then paste the keys `supabase status` prints
pnpm db:up               # supabase start (needs Docker)
pnpm db:migrate          # schema + RLS policies
pnpm db:seed             # one person per role, clients, projects, tasks, time
pnpm dev                 # http://localhost:3000
```

Sign in with any seeded email (e.g. `putri@odama.io`, PM) and the seed
password `odama-dev-123`. Local emails land in Inbucket (http://127.0.0.1:54324)
or the server log; Xendit links open a local payment simulator.

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm test:rls            # RLS + invoice flow; WIPES TEST_DATABASE_URL (local or a separate
                         # staging Supabase project, never production)
```

## Production

Supabase Cloud (Postgres + RLS, Auth, Storage; Singapore) and Vercel
(`sin1`, Vercel Cron). Schema, RLS and seed are pushed from a developer machine
with `pnpm cloud:migrate` / `pnpm cloud:seed`, which read `.env.cloud`. Steps in
[`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md) §3.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind v4 · shadcn/ui · Untitled UI Icons ·
Prisma 6 · Supabase Cloud (Postgres + RLS, Auth, Storage) · Vercel · Resend · Slack · Xendit · Vitest
