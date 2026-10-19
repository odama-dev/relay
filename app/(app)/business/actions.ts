"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { asUser, requireUser } from "@/lib/auth";
import { run, fail, parseOrFail, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/audit";
import { numOr0 } from "@/lib/money";
import { isoDate, parseIsoDate } from "@/lib/time/pure";
import {
  capacityOverrideSchema,
  capacitySchema,
  dashboardRulesSchema,
  fxRateSchema,
  personCostSchema,
  personTargetSchema,
  revenueTargetsSchema,
  roleTargetsSchema,
  uuid,
} from "@/lib/validation";

/**
 * C-Level dashboard inputs (PRD/Clevel dashboard.md §7). Who may write is
 * decided by the RLS policies (*_clevel migration); a refused write comes back
 * as "You don't have permission". Every change is audited with the old and
 * new value.
 */

function done() {
  revalidatePath("/business");
  revalidatePath("/dashboard");
}

const FORBIDDEN = "You don't have permission to change this.";

// --- Biaya orang (§3.1) -------------------------------------------------------

export async function savePersonCost(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(personCostSchema, raw);
    const key = { userId: d.userId, effectiveFrom: parseIsoDate(d.effectiveFrom) };
    const { before, row } = await asUser(user, async (tx) => {
      const before = await tx.personCost.findUnique({ where: { userId_effectiveFrom: key } });
      const row = await tx.personCost.upsert({
        where: { userId_effectiveFrom: key },
        create: { ...key, monthlyCostIdr: d.monthlyCostIdr, notes: d.notes ?? null, createdBy: user.id },
        update: { monthlyCostIdr: d.monthlyCostIdr, notes: d.notes ?? null },
      });
      return { before, row };
    });
    await logActivity({
      actorId: user.id,
      entityType: "person_cost",
      entityId: row.id,
      action: before ? "updated" : "created",
      metadata: { userId: d.userId, effectiveFrom: d.effectiveFrom, before: before ? numOr0(before.monthlyCostIdr) : null, after: d.monthlyCostIdr },
    });
    done();
  });
}

export async function deletePersonCost(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const rowId = parseOrFail(uuid, id);
    const gone = await asUser(user, async (tx) => {
      const row = await tx.personCost.findUnique({ where: { id: rowId } });
      if (!row) fail(FORBIDDEN);
      await tx.personCost.delete({ where: { id: rowId } });
      return row;
    });
    await logActivity({ actorId: user.id, entityType: "person_cost", entityId: rowId, action: "deleted", metadata: { userId: gone.userId, effectiveFrom: isoDate(gone.effectiveFrom), before: numOr0(gone.monthlyCostIdr), after: null } });
    done();
  });
}

// --- Kapasitas (§3.2) ---------------------------------------------------------

export async function saveCapacity(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(capacitySchema, raw);
    const key = { userId: d.userId, effectiveFrom: parseIsoDate(d.effectiveFrom) };
    const { before, row } = await asUser(user, async (tx) => {
      const before = await tx.personCapacity.findUnique({ where: { userId_effectiveFrom: key } });
      const row = await tx.personCapacity.upsert({
        where: { userId_effectiveFrom: key },
        create: { ...key, weeklyHours: d.weeklyHours, createdBy: user.id },
        update: { weeklyHours: d.weeklyHours },
      });
      return { before, row };
    });
    await logActivity({
      actorId: user.id,
      entityType: "person_capacity",
      entityId: row.id,
      action: before ? "updated" : "created",
      metadata: { userId: d.userId, effectiveFrom: d.effectiveFrom, before: before ? numOr0(before.weeklyHours) : null, after: d.weeklyHours },
    });
    done();
  });
}

export async function deleteCapacity(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const rowId = parseOrFail(uuid, id);
    const gone = await asUser(user, async (tx) => {
      const row = await tx.personCapacity.findUnique({ where: { id: rowId } });
      if (!row) fail(FORBIDDEN);
      await tx.personCapacity.delete({ where: { id: rowId } });
      return row;
    });
    await logActivity({ actorId: user.id, entityType: "person_capacity", entityId: rowId, action: "deleted", metadata: { userId: gone.userId, effectiveFrom: isoDate(gone.effectiveFrom), before: numOr0(gone.weeklyHours), after: null } });
    done();
  });
}

export async function addCapacityOverride(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(capacityOverrideSchema, raw);
    const row = await asUser(user, (tx) =>
      tx.capacityOverride.create({
        data: { userId: d.userId, periodStart: parseIsoDate(d.periodStart), periodEnd: parseIsoDate(d.periodEnd), availableHours: d.availableHours, reason: d.reason ?? null, createdBy: user.id },
      }),
    );
    await logActivity({ actorId: user.id, entityType: "capacity_override", entityId: row.id, action: "created", metadata: { ...d, before: null, after: d.availableHours } });
    done();
  });
}

export async function deleteCapacityOverride(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const rowId = parseOrFail(uuid, id);
    const gone = await asUser(user, async (tx) => {
      const row = await tx.capacityOverride.findUnique({ where: { id: rowId } });
      if (!row) fail(FORBIDDEN);
      await tx.capacityOverride.delete({ where: { id: rowId } });
      return row;
    });
    await logActivity({
      actorId: user.id,
      entityType: "capacity_override",
      entityId: rowId,
      action: "deleted",
      metadata: { userId: gone.userId, periodStart: isoDate(gone.periodStart), periodEnd: isoDate(gone.periodEnd), before: numOr0(gone.availableHours), after: null },
    });
    done();
  });
}

// --- Target utilization (§3.3) -------------------------------------------------

export async function saveRoleTargets(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const { targets } = parseOrFail(roleTargetsSchema, raw);
    const before = await asUser(user, async (tx) => {
      const before = await tx.utilizationTarget.findMany();
      for (const t of targets) {
        await tx.utilizationTarget.upsert({ where: { role: t.role }, create: { role: t.role, targetPercent: t.targetPercent }, update: { targetPercent: t.targetPercent } });
      }
      return before;
    });
    await logActivity({
      actorId: user.id,
      entityType: "utilization_targets",
      entityId: "roles",
      action: "updated",
      metadata: { before: Object.fromEntries(before.map((b) => [b.role, numOr0(b.targetPercent)])), after: Object.fromEntries(targets.map((t) => [t.role, t.targetPercent])) },
    });
    done();
  });
}

export async function setPersonTarget(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(personTargetSchema, raw);
    const before = await asUser(user, async (tx) => {
      const before = await tx.utilizationOverride.findUnique({ where: { userId: d.userId } });
      if (d.targetPercent === null) {
        if (before) await tx.utilizationOverride.delete({ where: { userId: d.userId } });
      } else {
        await tx.utilizationOverride.upsert({ where: { userId: d.userId }, create: { userId: d.userId, targetPercent: d.targetPercent }, update: { targetPercent: d.targetPercent } });
      }
      return before;
    });
    await logActivity({ actorId: user.id, entityType: "utilization_override", entityId: d.userId, action: d.targetPercent === null ? "deleted" : before ? "updated" : "created", metadata: { before: before ? numOr0(before.targetPercent) : null, after: d.targetPercent } });
    done();
  });
}

// --- Target revenue (§3.4) ----------------------------------------------------

export async function saveRevenueTargets(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(revenueTargetsSchema, raw);
    const before = await asUser(user, async (tx) => {
      const before = await tx.revenueTarget.findMany({ where: { year: d.year } });
      const wanted: { month: number | null; value: number | null }[] = [{ month: null, value: d.yearly }, ...d.months.map((value, i) => ({ month: i + 1, value }))];
      for (const w of wanted) {
        const existing = before.find((b) => b.month === w.month);
        if (w.value === null) {
          if (existing) await tx.revenueTarget.delete({ where: { id: existing.id } });
        } else if (existing) {
          await tx.revenueTarget.update({ where: { id: existing.id }, data: { targetIdr: w.value } });
        } else {
          await tx.revenueTarget.create({ data: { year: d.year, month: w.month, targetIdr: w.value, createdBy: user.id } });
        }
      }
      return before;
    });
    await logActivity({
      actorId: user.id,
      entityType: "revenue_targets",
      entityId: String(d.year),
      action: "updated",
      metadata: {
        before: Object.fromEntries(before.map((b) => [b.month ?? "year", numOr0(b.targetIdr)])),
        after: { year: d.yearly, ...Object.fromEntries(d.months.map((v, i) => [i + 1, v])) },
      } as Prisma.InputJsonValue,
    });
    done();
  });
}

// --- Kurs referensi (§3.6) ----------------------------------------------------

export async function saveFxRate(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(fxRateSchema, raw);
    const key = { currency: d.currency, effectiveFrom: parseIsoDate(d.effectiveFrom) };
    const { before, row } = await asUser(user, async (tx) => {
      const before = await tx.fxReferenceRate.findUnique({ where: { currency_effectiveFrom: key } });
      const row = await tx.fxReferenceRate.upsert({
        where: { currency_effectiveFrom: key },
        create: { ...key, rateToIdr: d.rateToIdr, updatedBy: user.id },
        update: { rateToIdr: d.rateToIdr, updatedBy: user.id },
      });
      return { before, row };
    });
    await logActivity({ actorId: user.id, entityType: "fx_reference_rate", entityId: row.id, action: before ? "updated" : "created", metadata: { ...d, before: before ? numOr0(before.rateToIdr) : null, after: d.rateToIdr } });
    done();
  });
}

export async function deleteFxRate(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const rowId = parseOrFail(uuid, id);
    const gone = await asUser(user, async (tx) => {
      const row = await tx.fxReferenceRate.findUnique({ where: { id: rowId } });
      if (!row) fail(FORBIDDEN);
      await tx.fxReferenceRate.delete({ where: { id: rowId } });
      return row;
    });
    await logActivity({ actorId: user.id, entityType: "fx_reference_rate", entityId: rowId, action: "deleted", metadata: { currency: gone.currency, effectiveFrom: isoDate(gone.effectiveFrom), before: numOr0(gone.rateToIdr), after: null } });
    done();
  });
}

// --- Aturan dashboard (§3.8, §2.4) ---------------------------------------------

export async function saveDashboardRules(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(dashboardRulesSchema, raw);
    const before = await asUser(user, async (tx) => {
      const before = await tx.appSetting.findMany({ where: { key: { in: ["project_attention_rules", "clevel_dashboard_thresholds"] } } });
      for (const [key, value] of [
        ["project_attention_rules", d.rules],
        ["clevel_dashboard_thresholds", d.thresholds],
      ] as const) {
        await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
      }
      return before;
    });
    await logActivity({
      actorId: user.id,
      entityType: "dashboard_rules",
      entityId: "clevel",
      action: "updated",
      metadata: { before: Object.fromEntries(before.map((b) => [b.key, b.value])), after: { project_attention_rules: d.rules, clevel_dashboard_thresholds: d.thresholds } } as Prisma.InputJsonValue,
    });
    done();
  });
}
