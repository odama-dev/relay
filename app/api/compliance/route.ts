import { NextResponse, type NextRequest } from "next/server";
import type { UserRole } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { perms, USER_ROLES } from "@/lib/roles";
import { getCompliance } from "@/lib/time/compliance";
import { isIsoDate, todayIn } from "@/lib/time/pure";
import { toCsv } from "@/lib/import/csv";

/** M3.7 — the compliance table as CSV. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !perms.viewCompliance(user)) return new NextResponse("Unauthorized", { status: 401 });
  const sp = request.nextUrl.searchParams;
  const today = todayIn(user.timezone);
  const week = isIsoDate(sp.get("week")) ? sp.get("week")! : today;
  const role = USER_ROLES.includes(sp.get("role") as UserRole) ? (sp.get("role") as UserRole) : undefined;
  const data = await getCompliance(user, week, today, role);
  const csv = toCsv([
    ["name", "role", ...data.days, "total_hours", "empty_workdays"],
    ...data.rows.map((r) => [r.name, r.role, ...r.days.map((d) => (d.minutes / 60).toFixed(2)), (r.total / 60).toFixed(2), r.missingDays]),
  ]);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="time-compliance-${data.weekStart}.csv"` },
  });
}
