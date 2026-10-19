"use server";

import { env, internalAppUrl, xenditConfigured } from "@/lib/env";

/** Posts a Xendit-shaped PAID callback to our own webhook (dev only). */
export async function simulatePayment(p: { requestId: string; amount: number; currency: string; xenditId: string; duplicate?: boolean }): Promise<string> {
  if (process.env.NODE_ENV === "production" || xenditConfigured) return "Not available.";
  const body = {
    id: p.xenditId,
    external_id: p.requestId,
    status: "PAID",
    amount: p.amount,
    paid_amount: p.amount,
    currency: p.currency,
    paid_at: new Date().toISOString(),
    payment_id: `devpay_${p.requestId}_${p.duplicate ? "dup" : Date.now()}`,
    payment_channel: "DEV_SIMULATOR",
    fees_paid_amount: 0,
    ...(p.currency !== "IDR" ? { settlement_currency: "IDR", settlement_amount: Math.round(p.amount * 16250) } : {}),
  };
  const send = () =>
    fetch(`${internalAppUrl}/api/webhooks/xendit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-callback-token": env.xenditCallbackToken },
      body: JSON.stringify(body),
    }).then(async (r) => `${r.status} ${await r.text()}`);
  const first = await send();
  if (!p.duplicate) return first;
  return `${first}\n${await send()}`;
}
