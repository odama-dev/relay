import "server-only";
import { randomBytes } from "node:crypto";
import puppeteer, { type Browser } from "puppeteer";
import { internalAppUrl } from "@/lib/env";

/**
 * Server-side invoice PDF (M5.3): headless Chrome prints /invoice-pdf/<token>,
 * which renders the same template the app previews. The token lives only in
 * this process's memory, is valid for one minute, and is minted only after
 * the caller's access to the invoice was checked.
 */
type Grant = { invoiceId: string; expiresAt: number };
const TOKEN_TTL_MS = 60_000;
const g = globalThis as unknown as { pdfGrants?: Map<string, Grant>; pdfBrowser?: Promise<Browser>; pdfIdle?: ReturnType<typeof setTimeout> };
const grants = (g.pdfGrants ??= new Map());

export function redeemPdfToken(token: string): Grant | null {
  const now = Date.now();
  for (const [k, v] of grants) if (v.expiresAt < now) grants.delete(k);
  return grants.get(token) ?? null;
}

const BROWSER_IDLE_MS = 5 * 60_000;

function launch(): Promise<Browser> {
  const p = puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
  });
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
  const token = randomBytes(32).toString("base64url");
  grants.set(token, { invoiceId, expiresAt: Date.now() + TOKEN_TTL_MS });
  const b = await browser();
  const page = await b.newPage();
  try {
    const res = await page.goto(`${internalAppUrl}/invoice-pdf/${token}`, { waitUntil: "load", timeout: 30_000 });
    if (!res?.ok()) throw new Error(`Invoice print page answered ${res?.status() ?? "nothing"}`);
    await page.evaluate(() => document.fonts.ready);
    return Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  } finally {
    grants.delete(token);
    await page.close().catch(() => {});
    g.pdfIdle = setTimeout(() => {
      g.pdfBrowser = undefined;
      void b.close().catch(() => {});
    }, BROWSER_IDLE_MS);
    g.pdfIdle.unref?.();
  }
}
