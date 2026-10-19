import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import puppeteer, { type Browser, type LaunchOptions } from "puppeteer";
import { env, internalAppUrl } from "@/lib/env";

/**
 * Server-side invoice PDF (M5.3): headless Chrome prints /invoice-pdf/<token>,
 * which renders the same template the app previews. The token is signed (so
 * any instance can check it — on Vercel the print page may land on another
 * one), valid for one minute, and minted only after the caller's access to
 * the invoice was checked.
 */
type Grant = { invoiceId: string; expiresAt: number };
const TOKEN_TTL_MS = 60_000;
const g = globalThis as unknown as { pdfBrowser?: Promise<Browser>; pdfIdle?: ReturnType<typeof setTimeout> };

const signingKey = createHmac("sha256", env.supabaseServiceRoleKey || env.cronSecret || randomBytes(32))
  .update("invoice-pdf-token")
  .digest();
const sign = (payload: string) => createHmac("sha256", signingKey).update(payload).digest("base64url");

function mintPdfToken(invoiceId: string): string {
  const payload = `${invoiceId}.${Date.now() + TOKEN_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function redeemPdfToken(token: string): Grant | null {
  const [invoiceId, expires, sig] = token.split(".");
  if (!invoiceId || !expires || !sig) return null;
  const expected = Buffer.from(sign(`${invoiceId}.${expires}`));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const expiresAt = Number(expires);
  return expiresAt >= Date.now() ? { invoiceId, expiresAt } : null;
}

const BROWSER_IDLE_MS = 5 * 60_000;

/** On Vercel there is no system Chrome: use the serverless Chromium build. */
async function launchOptions(): Promise<LaunchOptions> {
  if (process.env.VERCEL) {
    const { default: chromium } = await import("@sparticuz/chromium");
    return { headless: true, executablePath: await chromium.executablePath(), args: chromium.args };
  }
  return {
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
  };
}

function launch(): Promise<Browser> {
  const p = launchOptions().then((o) => puppeteer.launch(o));
  p.then(
    (b) => b.on("disconnected", () => g.pdfBrowser === p && (g.pdfBrowser = undefined)),
    () => g.pdfBrowser === p && (g.pdfBrowser = undefined),
  );
  return p;
}

async function browser(): Promise<Browser> {
  clearTimeout(g.pdfIdle);
  const b = await (g.pdfBrowser ??= launch());
  if (b.connected) return b;
  return (g.pdfBrowser = launch());
}

export async function renderInvoicePdf(invoiceId: string): Promise<Buffer> {
  const token = mintPdfToken(invoiceId);
  const b = await browser();
  const page = await b.newPage();
  try {
    const res = await page.goto(`${internalAppUrl}/invoice-pdf/${token}`, { waitUntil: "load", timeout: 30_000 });
    if (!res?.ok()) throw new Error(`Invoice print page answered ${res?.status() ?? "nothing"}`);
    await page.evaluate(() => document.fonts.ready);
    return Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  } finally {
    await page.close().catch(() => {});
    g.pdfIdle = setTimeout(() => {
      g.pdfBrowser = undefined;
      void b.close().catch(() => {});
    }, BROWSER_IDLE_MS);
    g.pdfIdle.unref?.();
  }
}
