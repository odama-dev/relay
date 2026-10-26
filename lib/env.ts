/**
 * Environment access. Integrations (Resend, Slack, Xendit) are optional in
 * development: when their keys are missing the app logs what it would have
 * sent instead of failing, so every flow stays exercisable locally.
 *
 * Secrets are read only on the server — never prefix them with NEXT_PUBLIC_.
 */
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  appUrl: (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  /** Sender for account emails (invites, password resets). */
  mailFrom: process.env.MAIL_FROM ?? "Odama OS <no-reply@odama.io>",
  slackBotToken: process.env.SLACK_BOT_TOKEN ?? "",
  xenditSecretKey: process.env.XENDIT_SECRET_KEY ?? "",
  xenditCallbackToken: process.env.XENDIT_CALLBACK_TOKEN ?? "",
  /** 32 random bytes, base64 — encrypts the mailbox passwords people connect (Mail). */
  mailEncryptionKey: process.env.MAIL_ENCRYPTION_KEY ?? "",
  /** Bearer token the scheduler (Vercel Cron or the VPS cron) presents to /api/cron/*. */
  cronSecret: process.env.CRON_SECRET ?? "",
};

export const isProduction = process.env.NODE_ENV === "production";

export const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const supabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
export const supabaseAdminConfigured = supabaseConfigured && Boolean(env.supabaseServiceRoleKey);

/** Local-only shortcut: signed in as DEV_AUTH_EMAIL without Supabase. */
export const devAuthBypass =
  !isProduction && process.env.DEV_AUTH_BYPASS === "true" && !supabaseConfigured;

export const devAuthEmail = (
  process.env.DEV_AUTH_EMAIL ??
  adminEmails[0] ??
  "admin@odama.io"
).toLowerCase();


export const resendConfigured = Boolean(env.resendApiKey);
export const slackConfigured = Boolean(env.slackBotToken);
export const xenditConfigured = Boolean(env.xenditSecretKey);

/**
 * Where the server reaches itself (headless Chrome rendering invoice PDFs).
 * Defaults to the public URL; on a VPS, http://127.0.0.1:3000 skips the proxy.
 */
export const internalAppUrl = (process.env.INTERNAL_APP_URL || env.appUrl).replace(/\/$/, "");

/** Absolute link into the app, for emails and Slack messages. */
export function appLink(path: string): string {
  return `${env.appUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
