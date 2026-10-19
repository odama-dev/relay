import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type Tx = Prisma.TransactionClient;

/**
 * Runs `fn` as the given user under Row Level Security.
 *
 * Inside one transaction the connection switches to the `authenticated` role
 * and receives the same JWT claims PostgREST would set, so every policy in
 * prisma/migrations/*_rls applies exactly as it does to a direct Supabase API
 * call. A query the user isn't allowed to make returns no rows (reads) or
 * fails with SQLSTATE 42501 (writes) — see `describeDbError`.
 */
export async function withRls<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
  options?: { timeout?: number },
): Promise<T> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('request.jwt.claims', ${claims}, true), set_config('role', 'authenticated', true)`;
      return fn(tx);
    },
    { timeout: options?.timeout ?? 15_000, maxWait: 10_000 },
  );
}

type PgError = { code: string; message: string };

/** The Postgres error behind a Prisma error, when there is one. */
export function pgError(err: unknown): PgError | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return { code: "23505", message: "This already exists." };
    if (err.code === "P2003") return { code: "23503", message: "This record is still in use." };
    if (err.code === "P2025") return { code: "P2025", message: "This record no longer exists or you can't change it." };
  }
  const text = err instanceof Error ? err.message : String(err);
  const m = /PostgresError \{ code: "([0-9A-Z]{5})", message: "((?:[^"\\]|\\.)*)"/.exec(text);
  if (!m) return null;
  return { code: m[1]!, message: m[2]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\") };
}

const FORBIDDEN = "You don't have permission to do that.";

/**
 * A user-facing message for a failed write: the guard trigger's own wording
 * ("This week is locked…"), a generic permission message for a bare RLS
 * refusal, or null when the error isn't a database rule (a real bug — rethrow).
 */
export function describeDbError(err: unknown): string | null {
  const pg = pgError(err);
  if (!pg) return null;
  if (/row-level security/i.test(pg.message)) return FORBIDDEN;
  if (pg.code === "23503" && !/still in use/.test(pg.message)) return "This record is still in use, so it can't be removed.";
  if (["42501", "23514", "23503", "23505", "P0001", "P2025"].includes(pg.code)) return pg.message;
  return null;
}
