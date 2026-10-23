import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { asUser, getCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/audit";
import { MAX_RECEIPT_BYTES, putFile, RECEIPT_TYPES, removeFile } from "@/lib/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Attach evidence (screenshot or PDF, max 10 MB) to a log entry, replacing
 * any earlier file. Whoever can update the entry under RLS gets through; the
 * file is written first and linked under RLS.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const current = await asUser(user, (tx) => tx.workLog.findUnique({ where: { id }, select: { evidencePath: true } }));
  if (!current) return NextResponse.json({ error: "You can't change this entry." }, { status: 403 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file." }, { status: 400 });
  const ext = RECEIPT_TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Upload a PDF, PNG, JPEG, GIF or WebP file." }, { status: 415 });
  if (file.size > MAX_RECEIPT_BYTES) return NextResponse.json({ error: "Evidence can be at most 10 MB." }, { status: 413 });

  const key = `work-logs/${id}/${randomUUID()}.${ext}`;
  await putFile("evidence", key, Buffer.from(await file.arrayBuffer()), file.type);
  const name = file.name.slice(0, 200) || `evidence.${ext}`;
  const linked = await asUser(user, (tx) => tx.workLog.updateMany({ where: { id }, data: { evidencePath: key, evidenceName: name } }));
  if (linked.count === 0) {
    await removeFile("evidence", key);
    return NextResponse.json({ error: "You can't change this entry." }, { status: 403 });
  }
  if (current.evidencePath) await removeFile("evidence", current.evidencePath);
  await logActivity({ actorId: user.id, entityType: "work_log", entityId: id, action: "evidence_attached", metadata: { name } });
  return NextResponse.json({ name });
}
