import { NextResponse, type NextRequest } from "next/server";
import { verifyCallbackToken, type XenditCallback } from "@/lib/xendit";
import { handleXenditCallback } from "@/lib/invoices/payments";

/**
 * Xendit invoice callback (M5.6). Requests without the right
 * `x-callback-token` are refused; the same notification delivered twice
 * records one payment.
 */
export async function POST(request: NextRequest) {
  if (!verifyCallbackToken(request.headers.get("x-callback-token"))) {
    return NextResponse.json({ error: "Invalid callback token" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as XenditCallback | null;
  if (!body?.id || !body.external_id || !body.status) {
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }
  try {
    const result = await handleXenditCallback(body);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[xendit] webhook failed", err);
    // 500 → Xendit retries later.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
