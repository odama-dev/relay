import type { Prisma } from "@prisma/client";

/**
 * Prisma returns numeric columns as Decimal, which can't cross into client
 * components. Queries convert at the boundary with these; math that must not
 * drift (invoice sums) works in minor units (lib/invoices/pure.ts).
 */
export function num(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : value.toNumber();
}

export function numOr0(value: Prisma.Decimal | number | null | undefined): number {
  return num(value) ?? 0;
}
