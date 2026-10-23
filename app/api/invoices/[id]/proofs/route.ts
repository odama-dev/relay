import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { asUser, getCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/audit";
import { describeDbError } from "@/lib/db";
import { proofSubmitted } from "@/lib/invoices/payments";
import { MAX_RECEIPT_BYTES, putFile, RECEIPT_TYPES, removeFile } from "@/lib/storage";
import { parseIsoDate } from "@/lib/time/pure";
import { paymentProofSchema } from "@/lib/validation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Phase 2 · M9 — Sales uploads the proof of a payment made outside Xendit
 * (PDF or image, max 10 MB) with its details. The file is stored first, the
 * proof row is written under RLS (Sales module; the guard checks the
 * invoice and request), then the invoice waits on Finance.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach the proof of payment." }, { status: 400 });
  const ext = RECEIPT_TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Upload a PDF, PNG, JPEG, GIF or WebP file." }, { status: 415 });
  if (file.size > MAX_RECEIPT_BYTES) return NextResponse.json({ error: "Proofs can be at most 10 MB." }, { status: 413 });

  const raw = JSON.parse(String(form?.get("data") ?? "{}")) as unknown;
  const parsed = paymentProofSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the fields." }, { status: 400 });
  const d = parsed.data;

  const visible = await asUser(user, (tx) => tx.invoice.findUnique({ where: { id }, select: { projectId: true } }));
  if (!visible) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });

  const proofId = randomUUID();
  const key = `${id}/${proofId}.${ext}`;
  try {
    await putFile("payment-proofs", key, Buffer.from(await file.arrayBuffer()), file.type);
  } catch (err) {
    console.error("[proofs] upload failed", err);
    return NextResponse.json({ error: "The file couldn't be stored. Try again, or tell an admin if it keeps failing." }, { status: 502 });
  }
  try {
    await asUser(user, (tx) =>
      tx.paymentProof.create({
        data: {
          id: proofId,
          invoiceId: id,
          paymentRequestId: d.paymentRequestId ?? null,
          amount: d.amount,
          currency: "IDR", // the guard sets the invoice's currency
          paidOn: parseIsoDate(d.paidOn),
          platform: d.platform,
          note: d.note ?? null,
          fxRateToIdr: d.fxRateToIdr,
          filePath: key,
          fileName: file.name.slice(0, 200) || `proof.${ext}`,
          submittedBy: user.id,
        },
      }),
    );
  } catch (err) {
    await removeFile("payment-proofs", key);
    const message = describeDbError(err);
    if (message) return NextResponse.json({ error: message }, { status: 403 });
    throw err;
  }
  await proofSubmitted(proofId);
  await logActivity({ actorId: user.id, entityType: "invoice", entityId: id, action: "proof_submitted", metadata: { proofId, amount: d.amount, platform: d.platform } });
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  revalidatePath("/payments");
  return NextResponse.json({ id: proofId });
}
