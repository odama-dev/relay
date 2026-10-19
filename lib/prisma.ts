import { PrismaClient } from "@prisma/client";

const log: ("error" | "warn")[] =
  process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

/**
 * The SYSTEM connection: the migration owner, which bypasses Row Level
 * Security. Only for work that has no signed-in user or that the PRD makes a
 * system action — auth resolution, webhooks, scheduled jobs, notifications,
 * audit writes, and the server-side half of a mutation whose permission was
 * already checked under RLS.
 *
 * Everything done on behalf of a user goes through `withRls` (lib/db.ts).
 */
export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient({ log });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
