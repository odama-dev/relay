"use server";

import { revalidatePath } from "next/cache";
import { asUser, requireUser } from "@/lib/auth";
import { run, fail, parseOrFail, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/audit";
import { perms } from "@/lib/roles";
import { removeFile } from "@/lib/storage";
import { isoDate, parseIsoDate } from "@/lib/time/pure";
import { expenseSchema, uuid } from "@/lib/validation";

const FORBIDDEN = "Only Finance and C-Level record expenses.";

function expenseData(d: ReturnType<typeof expenseSchema.parse>) {
  return {
    expenseDate: parseIsoDate(d.expenseDate),
    vendor: d.vendor,
    description: d.description ?? null,
    category: d.category,
    kind: d.kind,
    amount: d.amount,
    currency: d.currency,
    notes: d.notes ?? null,
    projectId: d.projectId || null,
  };
}

export async function createExpense(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await requireUser();
    if (!perms.manageExpenses(user)) fail(FORBIDDEN);
    const d = parseOrFail(expenseSchema, raw);
    const expense = await asUser(user, (tx) => tx.expense.create({ data: { ...expenseData(d), createdBy: user.id } }));
    await logActivity({ actorId: user.id, entityType: "expense", entityId: expense.id, action: "created", metadata: { vendor: d.vendor, amount: d.amount, currency: d.currency } });
    revalidatePath("/expenses");
    return { id: expense.id };
  });
}

export async function updateExpense(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const expenseId = parseOrFail(uuid, id);
    const d = parseOrFail(expenseSchema, raw);
    const res = await asUser(user, (tx) => tx.expense.updateMany({ where: { id: expenseId }, data: expenseData(d) }));
    if (res.count === 0) fail(FORBIDDEN);
    await logActivity({ actorId: user.id, entityType: "expense", entityId: expenseId, action: "updated" });
    revalidatePath("/expenses");
  });
}

export async function removeReceipt(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const expenseId = parseOrFail(uuid, id);
    const path = await asUser(user, async (tx) => {
      const e = await tx.expense.findUnique({ where: { id: expenseId }, select: { receiptPath: true } });
      if (!e) fail(FORBIDDEN);
      const res = await tx.expense.updateMany({ where: { id: expenseId }, data: { receiptPath: null, receiptName: null } });
      if (res.count === 0) fail(FORBIDDEN);
      return e.receiptPath;
    });
    if (path) await removeFile("receipts", path);
    await logActivity({ actorId: user.id, entityType: "expense", entityId: expenseId, action: "receipt_removed" });
    revalidatePath("/expenses");
  });
}

/** A wrong or duplicate entry is removed for good (the audit log keeps what it was). */
export async function deleteExpense(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const expenseId = parseOrFail(uuid, id);
    const gone = await asUser(user, async (tx) => {
      const e = await tx.expense.findUnique({ where: { id: expenseId } });
      if (!e) fail(FORBIDDEN);
      const res = await tx.expense.deleteMany({ where: { id: expenseId } });
      if (res.count === 0) fail(FORBIDDEN);
      return e;
    });
    if (gone.receiptPath) await removeFile("receipts", gone.receiptPath);
    await logActivity({
      actorId: user.id,
      entityType: "expense",
      entityId: expenseId,
      action: "deleted",
      metadata: { vendor: gone.vendor, amount: gone.amount.toString(), currency: gone.currency, date: isoDate(gone.expenseDate) },
    });
    revalidatePath("/expenses");
  });
}
