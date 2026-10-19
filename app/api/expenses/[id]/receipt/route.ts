import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { asUser, getCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/audit";
import { MAX_RECEIPT_BYTES, putFile, RECEIPT_TYPES, removeFile } from "@/lib/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Attach a receipt (PDF or image, max 10 MB) to an expense, replacing any
 * earlier one. Only people who can update the expense (RLS: Finance and
 * C-Level) get through; the file is written first and linked under RLS.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const current = await asUser(user, (tx) => tx.expense.findUnique({ where: { id }, select: { receiptPath: true } }));
  if (!current) return NextResponse.json({ error: "You can't change this expense." }, { status: 403 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file." }, { status: 400 });
  const ext = RECEIPT_TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Upload a PDF, PNG, JPEG, GIF or WebP file." }, { status: 415 });
  if (file.size > MAX_RECEIPT_BYTES) return NextResponse.json({ error: "Receipts can be at most 10 MB." }, { status: 413 });

  const key = `${id}/${randomUUID()}.${ext}`;
  await putFile("receipts", key, Buffer.from(await file.arrayBuffer()), file.type);
  const name = file.name.slice(0, 200) || `receipt.${ext}`;
  const linked = await asUser(user, (tx) => tx.expense.updateMany({ where: { id }, data: { receiptPath: key, receiptName: name } }));
  if (linked.count === 0) {
    await removeFile("receipts", key);
    return NextResponse.json({ error: "You can't change this expense." }, { status: 403 });
  }
  if (current.receiptPath) await removeFile("receipts", current.receiptPath);
  await logActivity({ actorId: user.id, entityType: "expense", entityId: id, action: "receipt_attached", metadata: { name } });
  return NextResponse.json({ name });
}
