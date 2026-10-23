/**
 * RLS suite for HR's calendar and leave requests (hr_events,
 * hr_event_exceptions, leave_requests and the overrides approval writes).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withRls, type Tx } from "@/lib/db";

const ids = {
  boss: randomUUID(), // c_level + admin
  hr: randomUUID(),
  hr2: randomUUID(),
  pm: randomUUID(),
  dev: randomUUID(),
  dev2: randomUUID(),
};

const as = <T>(user: keyof typeof ids, fn: (tx: Tx) => Promise<T>) => withRls(ids[user], fn);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

async function denied(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected the database to refuse this");
}

beforeAll(async () => {
  const people: [keyof typeof ids, UserRole, boolean?][] = [
    ["boss", "c_level", true],
    ["hr", "hr"],
    ["hr2", "hr"],
    ["pm", "pm"],
    ["dev", "designer_dev"],
    ["dev2", "designer_dev"],
  ];
  for (const [key, role, isAdmin] of people) {
    await prisma.profile.create({ data: { id: ids[key], email: `${key}@hr.test`, fullName: key, role, isAdmin: Boolean(isAdmin), status: "active" } });
  }
  await prisma.personCapacity.create({ data: { userId: ids.dev, effectiveFrom: day("2026-01-01"), weeklyHours: 40 } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("HR calendar", () => {
  let eventId: string;

  it("lets HR create events; nobody else — not C-Level, not an admin", async () => {
    const e = await as("hr", (tx) =>
      tx.hrEvent.create({ data: { title: "Monthly report", startDate: day("2026-10-01"), endDate: day("2026-10-05"), recurrence: "monthly", createdBy: ids.hr } }),
    );
    eventId = e.id;
    for (const who of ["boss", "pm", "dev"] as const) {
      await denied(as(who, (tx) => tx.hrEvent.create({ data: { title: "Nope", startDate: day("2026-10-01"), endDate: day("2026-10-01"), createdBy: ids[who] } })));
    }
  });

  it("hides events and exceptions from everyone but HR", async () => {
    await as("hr", (tx) => tx.hrEventException.create({ data: { eventId, occurrenceDate: day("2026-11-01"), cancelled: true } }));
    expect(await as("hr2", (tx) => tx.hrEvent.count())).toBe(1);
    expect(await as("hr2", (tx) => tx.hrEventException.count())).toBe(1);
    for (const who of ["boss", "pm", "dev"] as const) {
      expect(await as(who, (tx) => tx.hrEvent.count())).toBe(0);
      expect(await as(who, (tx) => tx.hrEventException.count())).toBe(0);
    }
  });

  it("refuses a timed event without times or ending before it starts", async () => {
    const msg = await denied(
      as("hr", (tx) => tx.hrEvent.create({ data: { title: "Sync", startDate: day("2026-10-02"), endDate: day("2026-10-02"), allDay: false, startTime: "10:00", endTime: "09:00", createdBy: ids.hr } })),
    );
    expect(msg).toMatch(/hr_events_times/);
    await denied(as("hr", (tx) => tx.hrEvent.create({ data: { title: "Sync", startDate: day("2026-10-02"), endDate: day("2026-10-02"), allDay: false, createdBy: ids.hr } })));
  });
});

describe("Leave requests", () => {
  let requestId: string;

  it("lets a member ask for their own leave, only as pending", async () => {
    const r = await as("dev", (tx) => tx.leaveRequest.create({ data: { userId: ids.dev, kind: "annual_leave", startDate: day("2026-11-02"), endDate: day("2026-11-04"), reason: "Family trip" } }));
    requestId = r.id;
    await denied(as("dev", (tx) => tx.leaveRequest.create({ data: { userId: ids.dev2, kind: "sick", startDate: day("2026-11-10"), endDate: day("2026-11-10") } })));
    expect(await denied(as("dev", (tx) => tx.leaveRequest.create({ data: { userId: ids.dev, kind: "sick", startDate: day("2026-12-01"), endDate: day("2026-12-01"), status: "approved" } })))).toMatch(/starts as pending/);
  });

  it("refuses overlapping requests and a half day over several days", async () => {
    expect(await denied(as("dev", (tx) => tx.leaveRequest.create({ data: { userId: ids.dev, kind: "permit", startDate: day("2026-11-04"), endDate: day("2026-11-05") } })))).toMatch(/overlap/);
    await denied(as("dev", (tx) => tx.leaveRequest.create({ data: { userId: ids.dev, kind: "permit", startDate: day("2026-11-20"), endDate: day("2026-11-21"), halfDay: true } })));
  });

  it("shows requests to the requester, HR and admins only", async () => {
    expect(await as("dev", (tx) => tx.leaveRequest.count())).toBe(1);
    expect(await as("dev2", (tx) => tx.leaveRequest.count())).toBe(0);
    expect(await as("pm", (tx) => tx.leaveRequest.count())).toBe(0);
    expect(await as("hr", (tx) => tx.leaveRequest.count())).toBe(1);
    expect(await as("boss", (tx) => tx.leaveRequest.count())).toBe(1);
  });

  it("lets only HR or an admin decide, never on their own request", async () => {
    // The requester's own update reaches the row but the guard refuses it.
    expect(await denied(as("dev", (tx) => tx.leaveRequest.update({ where: { id: requestId }, data: { status: "approved" } })))).toMatch(/Only HR/);
    expect(await as("pm", (tx) => tx.leaveRequest.updateMany({ where: { id: requestId }, data: { status: "approved" } }))).toEqual({ count: 0 });
    const own = await as("hr", (tx) => tx.leaveRequest.create({ data: { userId: ids.hr, kind: "sick", startDate: day("2026-11-09"), endDate: day("2026-11-09") } }));
    expect(await denied(as("hr", (tx) => tx.leaveRequest.update({ where: { id: own.id }, data: { status: "approved" } })))).toMatch(/your own/);
    const decided = await as("hr2", (tx) => tx.leaveRequest.update({ where: { id: own.id }, data: { status: "approved" } }));
    expect(decided.decidedBy).toBe(ids.hr2);
  });

  it("writes the time off into capacity overrides on approval, and only through the request", async () => {
    await as("hr", (tx) => tx.leaveRequest.update({ where: { id: requestId }, data: { status: "approved", decisionNote: "Enjoy" } }));
    const override = await prisma.capacityOverride.findUniqueOrThrow({ where: { leaveRequestId: requestId } });
    expect(override).toMatchObject({ userId: ids.dev, kind: "annual_leave", periodStart: day("2026-11-02"), periodEnd: day("2026-11-04") });
    expect(Number(override.availableHours)).toBe(0);
    expect(await denied(as("hr", (tx) => tx.capacityOverride.delete({ where: { id: override.id } })))).toMatch(/cancel the request/);
    expect(await denied(as("hr", (tx) => tx.leaveRequest.update({ where: { id: requestId }, data: { status: "rejected" } })))).toMatch(/already decided/);
  });

  it("removes the override when the requester cancels, and freezes the details once decided", async () => {
    await denied(as("dev", (tx) => tx.leaveRequest.update({ where: { id: requestId }, data: { endDate: day("2026-11-06") } })));
    await as("dev", (tx) => tx.leaveRequest.update({ where: { id: requestId }, data: { status: "cancelled" } }));
    expect(await prisma.capacityOverride.count({ where: { leaveRequestId: requestId } })).toBe(0);
    expect(await denied(as("dev", (tx) => tx.leaveRequest.update({ where: { id: requestId }, data: { status: "pending" } })))).toMatch(/pending|cancelled/);
  });

  it("counts a half day as half of a fifth of the weekly hours", async () => {
    const r = await as("dev", (tx) => tx.leaveRequest.create({ data: { userId: ids.dev, kind: "permit", startDate: day("2026-12-03"), endDate: day("2026-12-03"), halfDay: true } }));
    await as("hr", (tx) => tx.leaveRequest.update({ where: { id: r.id }, data: { status: "approved" } }));
    const override = await prisma.capacityOverride.findUniqueOrThrow({ where: { leaveRequestId: r.id } });
    expect(Number(override.availableHours)).toBe(4);
  });
});
