import { NextResponse, type NextRequest } from "next/server";
import { asUser, getCurrentUser } from "@/lib/auth";
import { renderInvoicePdf } from "@/lib/invoices/pdf";
import { storedPdf } from "@/lib/invoices/issue";

/**
 * M5.3 — download the invoice PDF: Sales, Finance, C-Level and the project's
 * PM (RLS on invoices). Issued invoices serve the stored file; drafts and
 * `?fresh=1` render it now.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const inv = await asUser(user, (tx) => tx.invoice.findUnique({ where: { id }, select: { number: true, status: true } })).catch(() => null);
  if (!inv) return new NextResponse("Not found", { status: 404 });

  const fresh = request.nextUrl.searchParams.get("fresh") === "1" || inv.status === "draft";
  const stored = fresh ? null : await storedPdf(id);
  const pdf = stored?.pdf ?? (await renderInvoicePdf(id));
  const filename = stored?.filename ?? `${(inv.number ?? "draft-invoice").replace(/[^A-Za-z0-9_-]+/g, "-")}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
