import "server-only";
import { timingSafeEqual } from "node:crypto";
import { appLink, env, xenditConfigured } from "@/lib/env";

/**
 * Xendit Invoice API (M5.4): one hosted payment link per payment request,
 * `external_id` = the payment request's id so every payment can be traced back
 * to request → invoice → project.
 *
 * Without XENDIT_SECRET_KEY outside production, links point at a local
 * simulator (/dev/pay/<id>) that posts a signed fake webhook — so the whole
 * flow can be exercised before the Xendit account is ready.
 */

export type XenditLink = { id: string; url: string; expiresAt: Date | null };

export async function createPaymentLink(input: {
  externalId: string;
  amount: number;
  currency: string;
  description: string;
  payerEmail?: string | null;
  /** Seconds until the link expires. */
  durationSeconds: number;
}): Promise<XenditLink> {
  if (!xenditConfigured) {
    if (process.env.NODE_ENV === "production") throw new Error("Xendit isn't configured (XENDIT_SECRET_KEY).");
    return { id: `dev_${input.externalId}`, url: appLink(`/dev/pay/${input.externalId}`), expiresAt: new Date(Date.now() + input.durationSeconds * 1000) };
  }

  const res = await fetch("https://api.xendit.co/v2/invoices", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.xenditSecretKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      external_id: input.externalId,
      amount: input.amount,
      currency: input.currency,
      description: input.description,
      invoice_duration: input.durationSeconds,
      ...(input.payerEmail ? { payer_email: input.payerEmail } : {}),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; invoice_url?: string; expiry_date?: string; message?: string; error_code?: string };
  if (!res.ok || !body.id || !body.invoice_url) {
    throw new Error(`Xendit: ${body.message ?? body.error_code ?? `HTTP ${res.status}`}`);
  }
  return { id: body.id, url: body.invoice_url, expiresAt: body.expiry_date ? new Date(body.expiry_date) : null };
}

/** Constant-time check of the `x-callback-token` header (M5.6: tokenless webhooks are refused). */
export function verifyCallbackToken(token: string | null): boolean {
  const expected = env.xenditCallbackToken;
  if (!expected || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The fields of Xendit's invoice callback the app uses. */
export type XenditCallback = {
  id: string;
  external_id: string;
  status: "PAID" | "SETTLED" | "EXPIRED" | "PENDING" | string;
  amount?: number;
  paid_amount?: number;
  currency?: string;
  paid_at?: string;
  payment_id?: string;
  payment_channel?: string;
  payment_method?: string;
  fees_paid_amount?: number;
  adjusted_received_amount?: number;
  /** Present when the payment settles to the IDR balance from another currency. */
  settlement_amount?: number;
  settlement_currency?: string;
};
