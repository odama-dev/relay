import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { listInvoices, parseInvoiceFilters } from "@/lib/invoices/queries";
import { toCsv } from "@/lib/import/csv";

/** M5.9 — the filtered invoice list as CSV. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !perms.viewInvoices(user)) return new NextResponse("Unauthorized", { status: 401 });
  const rows = await listInvoices(user, parseInvoiceFilters(Object.fromEntries(request.nextUrl.searchParams)));
  const csv = toCsv([
    ["number", "status", "client", "project", "issue_date", "terms", "currency", "total", "paid", "outstanding", "next_due"],
    ...rows.map((r) => [r.number ?? "", r.status, r.client.name, r.project.code, r.issueDate, r.terms.map((t) => t.label).join("; "), r.currency, r.total, r.amountPaid, r.outstanding, r.nextDue ?? ""]),
  ]);
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="invoices.csv"' } });
}
