import "server-only";
import { env, resendConfigured } from "@/lib/env";

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type MailInput = {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  /** Defaults to MAIL_FROM (account emails). Invoices pass the studio sender. */
  from?: string;
  replyTo?: string;
  attachments?: MailAttachment[];
};

export type MailResult = { ok: true; id: string | null } | { ok: false; error: string };

/**
 * Sends an email through Resend's HTTP API (PRD: invites, password resets and
 * invoices). Without RESEND_API_KEY outside production the message is printed
 * to the server log instead, so local flows still complete.
 */
export async function sendMail(input: MailInput): Promise<MailResult> {
  if (!resendConfigured) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "Email isn't configured (RESEND_API_KEY)." };
    }
    console.info(
      `\n[mail:dev] to=${input.to.join(", ")}${input.cc?.length ? ` cc=${input.cc.join(", ")}` : ""}\n` +
        `subject: ${input.subject}\n${input.text}\n` +
        (input.attachments?.length ? `attachments: ${input.attachments.map((a) => a.filename).join(", ")}\n` : ""),
    );
    return { ok: true, id: null };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from ?? env.mailFrom,
        to: input.to,
        cc: input.cc?.length ? input.cc : undefined,
        reply_to: input.replyTo,
        subject: input.subject,
        html: input.html,
        text: input.text,
        attachments: input.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content.toString("base64"),
          content_type: a.contentType,
        })),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
    };
    if (!res.ok)
      return {
        ok: false,
        error: body.message ?? `Resend answered ${res.status}`,
      };
    return { ok: true, id: body.id ?? null };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't reach Resend",
    };
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The one email layout: plain, monochrome, a single call to action. Body
 * paragraphs are escaped; nothing user-supplied is rendered as HTML.
 */
export function renderEmail({
  heading,
  paragraphs,
  action,
  footer,
}: {
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footer?: string;
}): { html: string; text: string } {
  const p = paragraphs.map((t) => `<p style="margin:0 0 14px;font-size:14px;line-height:22px;color:#3f3f46">${escapeHtml(t)}</p>`).join("");
  const button = action
    ? `<p style="margin:22px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#09090b;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 18px;border-radius:999px">${escapeHtml(action.label)}</a></p>
       <p style="margin:0 0 14px;font-size:12px;line-height:18px;color:#71717a">Or open this link: <a href="${escapeHtml(action.url)}" style="color:#71717a">${escapeHtml(action.url)}</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Inter,Helvetica,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 16px">
<div style="background:#ffffff;border-radius:12px;padding:28px">
<p style="margin:0 0 20px;font-size:13px;font-weight:600;letter-spacing:.02em;color:#09090b">Odama</p>
<h1 style="margin:0 0 16px;font-size:18px;line-height:26px;color:#09090b">${escapeHtml(heading)}</h1>
${p}${button}
</div>
${footer ? `<p style="margin:16px 4px 0;font-size:12px;line-height:18px;color:#a1a1aa">${escapeHtml(footer)}</p>` : ""}
</div></body></html>`;
  const text = [heading, "", ...paragraphs, ...(action ? ["", `${action.label}: ${action.url}`] : []), ...(footer ? ["", footer] : [])].join("\n");
  return { html, text };
}
