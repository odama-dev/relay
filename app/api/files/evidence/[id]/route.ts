import { NextResponse, type NextRequest } from "next/server";
import { asUser, getCurrentUser } from "@/lib/auth";
import { getFile, RECEIPT_TYPES, signedUrl } from "@/lib/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Serves a log entry's evidence to people who can read the entry (RLS), via a 60-second signed URL. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse("Not found", { status: 404 });

  const log = await asUser(user, (tx) => tx.workLog.findUnique({ where: { id }, select: { evidencePath: true, evidenceName: true } }));
  if (!log?.evidencePath) return new NextResponse("Not found", { status: 404 });

  const url = await signedUrl("evidence", log.evidencePath);
  if (url) return NextResponse.redirect(url, { headers: { "Cache-Control": "private, max-age=30" } });

  const body = await getFile("evidence", log.evidencePath);
  if (!body) return new NextResponse("Not found", { status: 404 });
  const ext = log.evidencePath.split(".").pop()!;
  const type = Object.entries(RECEIPT_TYPES).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
  const name = (log.evidenceName ?? `evidence.${ext}`).replace(/["\\\r\n]/g, "");
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": type, "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "private, max-age=300" },
  });
}
