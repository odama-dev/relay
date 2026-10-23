"use server";

import { revalidatePath } from "next/cache";
import { asUser, requireUser } from "@/lib/auth";
import { run, fail, parseOrFail, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/audit";
import { parseIsoDate } from "@/lib/time/pure";
import { obligationDoneSchema, obligationSchema, uuid } from "@/lib/validation";

/**
 * Phase 2 · M10 — obligations. RLS decides who keeps which kind: the
 * Finance module all of them, the People module payroll and BPJS.
 */

const FORBIDDEN = "Only Finance keeps obligations (HR: payroll and BPJS).";

function revalidateFinance() {
  revalidatePath("/dashboard");
  revalidatePath("/finance");
}

function obligationData(d: ReturnType<typeof obligationSchema.parse>) {
  return {
    title: d.title,
    kind: d.kind,
    recurrence: d.recurrence,
    dayOfMonth: d.dayOfMonth,
    month: d.recurrence === "yearly" ? d.month : null,
    onDate: d.recurrence === "once" && d.onDate ? parseIsoDate(d.onDate) : null,
    amountEstimate: d.amountEstimate,
    currency: d.currency,
    notes: d.notes ?? null,
    isActive: d.isActive,
  };
}

export async function createObligation(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(obligationSchema, raw);
    const o = await asUser(user, (tx) => tx.obligation.create({ data: obligationData(d) }));
    await logActivity({ actorId: user.id, entityType: "obligation", entityId: o.id, action: "created", metadata: { title: d.title, kind: d.kind } });
    revalidateFinance();
  });
}

/** Edit, or switch off (`isActive: false`) — obligations are kept, not deleted. */
export async function updateObligation(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const obligationId = parseOrFail(uuid, id);
    const d = parseOrFail(obligationSchema, raw);
    const res = await asUser(user, (tx) => tx.obligation.updateMany({ where: { id: obligationId }, data: obligationData(d) }));
    if (res.count === 0) fail(FORBIDDEN);
    await logActivity({ actorId: user.id, entityType: "obligation", entityId: obligationId, action: "updated", metadata: { title: d.title, active: d.isActive } });
    revalidateFinance();
  });
}

/** Mark one occurrence done (paid / filed), or undo it. */
export async function setObligationDone(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(obligationDoneSchema, raw);
    await asUser(user, async (tx) => {
      if (d.done) {
        await tx.obligationCompletion.upsert({
          where: { obligationId_dueDate: { obligationId: d.obligationId, dueDate: parseIsoDate(d.dueDate) } },
          create: { obligationId: d.obligationId, dueDate: parseIsoDate(d.dueDate) },
          update: {},
        });
      } else {
        await tx.obligationCompletion.deleteMany({ where: { obligationId: d.obligationId, dueDate: parseIsoDate(d.dueDate) } });
      }
    });
    await logActivity({ actorId: user.id, entityType: "obligation", entityId: d.obligationId, action: d.done ? "done" : "undone", metadata: { dueDate: d.dueDate } });
    revalidateFinance();
  });
}
