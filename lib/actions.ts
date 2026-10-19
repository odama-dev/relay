import "server-only";
import type { z } from "zod";
import { describeDbError } from "@/lib/db";

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

/** A refusal with a message meant for the user. */
export class ActionError extends Error {}

export function fail(message: string): never {
  throw new ActionError(message);
}

/** First validation issue as a sentence. */
export function parseOrFail<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? "Check the highlighted fields.");
  return parsed.data;
}

/**
 * Runs a server action body and turns every expected failure into
 * `{ ok: false, error }`: ActionError, a database rule (RLS refusal or guard
 * trigger, see lib/db.ts), or a validation error. Anything else is a bug —
 * logged, and the user gets a generic message.
 */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof ActionError) return { ok: false, error: err.message };
    const db = describeDbError(err);
    if (db) return { ok: false, error: db };
    // next/navigation redirect() / notFound() must propagate.
    if (err && typeof err === "object" && "digest" in err) throw err;
    console.error("[action]", err);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}
