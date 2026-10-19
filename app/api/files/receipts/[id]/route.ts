import { NextResponse, type NextRequest } from "next/server";
import { asUser, getCurrentUser } from "@/lib/auth";
import { getFile, RECEIPT_TYPES, signedUrl } from "@/lib/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Serves an expense's receipt to people who can read the expense (RLS), via a 60-second signed URL. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse("Not found", { status: 404 });

  const expense = await asUser(user, (tx) => tx.expense.findUnique({ where: { id }, select: { receiptPath: true, receiptName: true } }));
  if (!expense?.receiptPath) return new NextResponse("Not found", { status: 404 });

  const url = await signedUrl("receipts", expense.receiptPath);
  if (url) return NextResponse.redirect(url, { headers: { "Cache-Control": "private, max-age=30" } });

  const body = await getFile("receipts", expense.receiptPath);
  if (!body) return new NextResponse("Not found", { status: 404 });
  const ext = expense.receiptPath.split(".").pop()!;
  const type = Object.entries(RECEIPT_TYPES).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
  const name = (expense.receiptName ?? `receipt.${ext}`).replace(/["\\\r\n]/g, "");
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": type, "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "private, max-age=300" },
  });
}
