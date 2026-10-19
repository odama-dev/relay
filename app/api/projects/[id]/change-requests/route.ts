import { NextResponse, type NextRequest } from "next/server";
import { asUser, getCurrentUser } from "@/lib/auth";
import { listChangeRequests } from "@/lib/health/change-requests";
import { toCsv } from "@/lib/import/csv";
import { isIsoDate } from "@/lib/time/pure";

/** M4.4 — CSV export: date, task, person, duration, note. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const from = sp.get("from") ?? undefined;
  const to = sp.get("to") ?? undefined;
  const project = await asUser(user, (tx) => tx.project.findUnique({ where: { id }, select: { code: true } }).catch(() => null));
  if (!project) return new NextResponse("Not found", { status: 404 });
  const rows = await listChangeRequests(user, id, isIsoDate(from) ? from : undefined, isIsoDate(to) ? to : undefined);
  const csv = toCsv([
    ["date", "task", "person", "hours", "minutes", "note", "billed"],
    ...rows.map((r) => [r.entryDate, r.taskTitle, r.person, (r.minutes / 60).toFixed(2), r.minutes, r.note ?? "", r.billedAt ? "yes" : "no"]),
  ]);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${project.code}-change-requests.csv"`,
    },
  });
}
