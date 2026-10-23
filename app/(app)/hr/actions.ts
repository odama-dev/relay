"use server";

import { revalidatePath } from "next/cache";
import { asUser, requireUser } from "@/lib/auth";
import { fail, parseOrFail, run, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/audit";
import { notify, notifyMany } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { LEAVE_KIND_LABELS, daysBetween } from "@/lib/hr/pure";
import { addDays, isoDate, parseIsoDate, todayIn } from "@/lib/time/pure";
import { attendanceSchema, hrEventFieldsSchema, hrEventSchema, hrEventScopeSchema, leaveDecisionSchema, leaveRequestSchema, uuid } from "@/lib/validation";

const NOT_FOUND = "This event no longer exists.";

const dates = (d: { startDate: string; endDate: string; allDay: boolean; startTime?: string; endTime?: string }) => ({
  startDate: parseIsoDate(d.startDate),
  endDate: parseIsoDate(d.endDate),
  allDay: d.allDay,
  startTime: d.allDay ? null : (d.startTime ?? null),
  endTime: d.allDay ? null : (d.endTime ?? null),
});

function revalidateHr() {
  revalidatePath("/dashboard");
  revalidatePath("/timesheet");
}

// ---------------------------------------------------------------------------
// HR calendar — RLS keeps every read and write to HR.
// ---------------------------------------------------------------------------

export async function createHrEvent(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(hrEventSchema, raw);
    const row = await asUser(user, (tx) =>
      tx.hrEvent.create({
        data: {
          title: d.title,
          notes: d.notes ?? null,
          color: d.color,
          ...dates(d),
          recurrence: d.recurrence,
          repeatUntil: d.repeatUntil ? parseIsoDate(d.repeatUntil) : null,
          createdBy: user.id,
        },
      }),
    );
    await logActivity({ actorId: user.id, entityType: "hr_event", entityId: row.id, action: "created", metadata: { title: d.title, recurrence: d.recurrence } });
    revalidateHr();
    return { id: row.id };
  });
}

/**
 * Edit one occurrence ("only this one" → an exception) or the series. A series
 * edit made from an occurrence moves the whole series by the same number of
 * days; changing its timing drops the per-occurrence changes, which no longer
 * line up.
 */
export async function updateHrEvent(target: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const t = parseOrFail(hrEventScopeSchema, target);
    const d = parseOrFail(hrEventSchema, raw);
    await asUser(user, async (tx) => {
      const event = await tx.hrEvent.findUnique({ where: { id: t.id } });
      if (!event) fail(NOT_FOUND);
      if (t.scope === "occurrence" && event.recurrence !== "none") {
        const f = parseOrFail(hrEventFieldsSchema, raw);
        const data = { cancelled: false, title: f.title, notes: f.notes ?? null, color: f.color, ...dates(f) };
        await tx.hrEventException.upsert({
          where: { eventId_occurrenceDate: { eventId: t.id, occurrenceDate: parseIsoDate(t.occurrenceDate) } },
          create: { eventId: t.id, occurrenceDate: parseIsoDate(t.occurrenceDate), ...data },
          update: data,
        });
        return;
      }
      const shift = daysBetween(t.occurrenceDate, d.startDate);
      const startDate = addDays(isoDate(event.startDate), shift);
      const endDate = addDays(startDate, daysBetween(d.startDate, d.endDate));
      const retimed = startDate !== isoDate(event.startDate) || d.recurrence !== event.recurrence;
      if (retimed) await tx.hrEventException.deleteMany({ where: { eventId: t.id } });
      await tx.hrEvent.update({
        where: { id: t.id },
        data: {
          title: d.title,
          notes: d.notes ?? null,
          color: d.color,
          ...dates({ ...d, startDate, endDate }),
          recurrence: d.recurrence,
          repeatUntil: d.repeatUntil ? parseIsoDate(d.repeatUntil) : null,
        },
      });
    });
    await logActivity({ actorId: user.id, entityType: "hr_event", entityId: t.id, action: "updated", metadata: { scope: t.scope, occurrenceDate: t.occurrenceDate, title: d.title } });
    revalidateHr();
  });
}

/** Delete the series, or skip just one occurrence of it. */
export async function deleteHrEvent(target: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const t = parseOrFail(hrEventScopeSchema, target);
    const event = await asUser(user, async (tx) => {
      const event = await tx.hrEvent.findUnique({ where: { id: t.id } });
      if (!event) fail(NOT_FOUND);
      if (t.scope === "occurrence" && event.recurrence !== "none") {
        const occurrenceDate = parseIsoDate(t.occurrenceDate);
        await tx.hrEventException.upsert({
          where: { eventId_occurrenceDate: { eventId: t.id, occurrenceDate } },
          create: { eventId: t.id, occurrenceDate, cancelled: true },
          update: { cancelled: true },
        });
      } else {
        await tx.hrEvent.delete({ where: { id: t.id } });
      }
      return event;
    });
    await logActivity({ actorId: user.id, entityType: "hr_event", entityId: t.id, action: "deleted", metadata: { scope: t.scope, occurrenceDate: t.occurrenceDate, title: event.title } });
    revalidateHr();
  });
}

// ---------------------------------------------------------------------------
// Leave — members ask, HR decides; the database guards every transition and
// writes the approved time off into capacity_overrides.
// ---------------------------------------------------------------------------

const leaveSummary = (r: { kind: keyof typeof LEAVE_KIND_LABELS; startDate: Date; endDate: Date; halfDay: boolean }) => {
  const from = isoDate(r.startDate);
  const to = isoDate(r.endDate);
  return `${LEAVE_KIND_LABELS[r.kind]} · ${from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`}${r.halfDay ? " (half day)" : ""}`;
};

export async function requestLeave(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(leaveRequestSchema, raw);
    const row = await asUser(user, (tx) =>
      tx.leaveRequest.create({
        data: { userId: user.id, kind: d.kind, startDate: parseIsoDate(d.startDate), endDate: parseIsoDate(d.endDate), halfDay: d.halfDay, reason: d.reason ?? null },
      }),
    );
    await logActivity({ actorId: user.id, entityType: "leave_request", entityId: row.id, action: "created", metadata: d });
    // Deciders: every active HR user (never the requester).
    const hr = await prisma.profile.findMany({ where: { role: "hr", status: "active" }, select: { id: true } });
    await notifyMany(
      hr.map((p) => p.id),
      "leave_requested",
      { title: `${user.fullName} asked for leave`, body: `${leaveSummary(row)}${d.reason ? ` — ${d.reason}` : ""}`, path: "/dashboard", refId: row.id },
      user.id,
    );
    revalidateHr();
  });
}

export async function cancelLeave(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const rowId = parseOrFail(uuid, id);
    const before = await asUser(user, async (tx) => {
      const row = await tx.leaveRequest.findUnique({ where: { id: rowId } });
      if (!row) fail("This request no longer exists.");
      await tx.leaveRequest.update({ where: { id: rowId }, data: { status: "cancelled" } });
      return row;
    });
    await logActivity({ actorId: user.id, entityType: "leave_request", entityId: rowId, action: "cancelled", metadata: { before: before.status } });
    revalidateHr();
  });
}

export async function decideLeave(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(leaveDecisionSchema, raw);
    const row = await asUser(user, (tx) => tx.leaveRequest.update({ where: { id: d.id }, data: { status: d.decision, decisionNote: d.note ?? null } }));
    await logActivity({ actorId: user.id, entityType: "leave_request", entityId: d.id, action: d.decision, metadata: { note: d.note ?? null } });
    await notify(row.userId, "leave_decided", {
      title: `Your leave request was ${d.decision}`,
      body: `${leaveSummary(row)}${d.note ? ` — ${d.note}` : ""}`,
      path: "/timesheet",
      refId: d.id,
    });
    revalidateHr();
  });
}

// ---------------------------------------------------------------------------
// Attendance (Phase 2) — you check yourself in for today.
// ---------------------------------------------------------------------------

export async function checkIn(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(attendanceSchema, raw);
    const date = parseIsoDate(todayIn(user.timezone));
    await asUser(user, (tx) =>
      tx.attendance.upsert({
        where: { userId_date: { userId: user.id, date } },
        create: { userId: user.id, date, status: d.status, note: d.note ?? null },
        update: { status: d.status, note: d.note ?? null, checkedInAt: new Date() },
      }),
    );
    await logActivity({ actorId: user.id, entityType: "attendance", entityId: user.id, action: "checked_in", metadata: { status: d.status } });
    revalidateHr();
  });
}
