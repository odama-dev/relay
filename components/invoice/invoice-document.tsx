import type { ReactNode } from "react";
import type { InvoiceDocumentData } from "@/lib/invoices/queries";
import { requestPercent } from "@/lib/invoices/pure";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";

/**
 * The invoice as printed to PDF (M5.3) and previewed in the app — the studio's
 * Figma template "Invoice Odama – 2026" (node 3160:2), filled with: number,
 * date, client, items, total, the payment schedule (each request links to its
 * Xendit page while unpaid) and the studio's contact strip.
 *
 * Built in `pt` on the Figma frame's own grid: A4 = 595 × 842 pt, 8 pt margin.
 */

// Shown when Settings → Studio profile leaves a field empty.
const STUDIO_FALLBACK = {
  address: "Perum Jl. Gentan Raya I No.3 Blok D, Dusun IV, Gentan, Baki, Sukoharjo Regency, Central Java 57168",
  phone: "+62 85175206661",
  email: "hellodama@odama.io",
  website: "odama.io",
};

/** ODAMA/26/0001 → ["ODAMA", "/26", "/0001"]: wordmark left, year centre-left, sequence right. */
function numberParts(number: string | null, issueDate: string): [string, string, string] {
  if (!number) return ["INV", `/${issueDate.slice(2, 4)}`, "/DRAFT"];
  const [first = "", second, third] = number.split("/");
  return [first, second ? `/${second}` : "", third ? `/${third}` : ""];
}

const REQUEST_STATUS = { pending: "Unpaid", paid: "Paid", expired: "Expired", void: "Void" } as const;

function InfoRow({ label, children, wrap }: { label: string; children: ReactNode; wrap?: boolean }) {
  return (
    <div className="flex items-start gap-[8pt]">
      <p className="w-[65pt] shrink-0">{label}</p>
      <p className={wrap ? "w-[135pt] whitespace-pre-line" : "whitespace-nowrap"}>{children}</p>
    </div>
  );
}

function SummaryRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-[8pt] text-[12pt]">
      <p className="w-[212pt] shrink-0">{label}</p>
      <p className="whitespace-nowrap">{children}</p>
    </div>
  );
}

export function InvoiceDocument({ invoice }: { invoice: InvoiceDocumentData }) {
  const money = (v: number) => formatMoney(v, invoice.currency);
  const remaining = invoice.status === "void" ? 0 : Math.max(0, invoice.total - invoice.amountPaid);
  const itemStatus = invoice.status === "void" ? "Void" : invoice.status === "paid" ? "Paid" : "Unpaid";
  const [lead, year, seq] = numberParts(invoice.number, invoice.issueDate);
  const studio = {
    address: invoice.studio.address || STUDIO_FALLBACK.address,
    phone: STUDIO_FALLBACK.phone,
    email: invoice.studio.email || STUDIO_FALLBACK.email,
    website: invoice.studio.website || STUDIO_FALLBACK.website,
  };

  return (
    <article className="relative mx-auto flex min-h-[842pt] w-[595pt] flex-col bg-[#eee] p-[8pt] font-sans leading-normal break-words text-black not-italic">
      <header className="flex min-h-[106pt] items-start justify-between">
        <p className="text-[24pt] whitespace-nowrap">Odama Std.</p>
        <div className="flex w-[215pt] flex-col gap-[2pt] text-[10pt]">
          <InfoRow label="Date:">{formatDate(invoice.issueDate)}</InfoRow>
          {invoice.billTo.contactName && <InfoRow label="Name:">{invoice.billTo.contactName}</InfoRow>}
          {invoice.billTo.email && (
            <InfoRow label="Email:">
              <a href={`mailto:${invoice.billTo.email}`} className="underline">
                {invoice.billTo.email}
              </a>
            </InfoRow>
          )}
          <InfoRow label="Company:" wrap>
            {invoice.billTo.name}
          </InfoRow>
          {invoice.billTo.address && (
            <InfoRow label="Address:" wrap>
              {invoice.billTo.address}
            </InfoRow>
          )}
        </div>
      </header>

      <div className="flex min-h-[81pt] items-start justify-between text-[36pt]">
        <div className="flex w-[286pt] items-center justify-between">
          <p className="whitespace-nowrap">{lead}</p>
          <p className="min-w-[66pt] whitespace-nowrap">{year}</p>
        </div>
        <p className="text-right whitespace-nowrap">{seq}</p>
      </div>

      <section className="flex flex-col gap-[24pt]">
        <p className="text-[24pt]">Detail</p>
        <div className="flex flex-col items-end gap-[60pt]">
          <div className="flex w-full flex-col gap-[16pt] text-[12pt]">
            <div className="flex items-center gap-[8pt] border-b-[1pt] border-black pb-[8pt]">
              <p className="w-[175pt] shrink-0">Scope of Work</p>
              <p className="w-[103pt] shrink-0">Qty</p>
              <p className="w-[102pt] shrink-0">Price</p>
              <p className="w-[102pt] shrink-0">Total</p>
              <p className="w-[65pt] shrink-0">Status</p>
            </div>
            {invoice.items.map((item, i) => (
              <div key={i} className="flex items-center gap-[8pt]">
                <ul className="w-[175pt] shrink-0">
                  <li className="ms-[18pt] list-disc whitespace-pre-line">{item.description}</li>
                </ul>
                <p className="w-[103pt] shrink-0">{formatNumber(item.quantity)}</p>
                <p className="w-[102pt] shrink-0">{money(item.unitPrice)}</p>
                <p className="w-[102pt] shrink-0">{money(item.amount)}</p>
                <p className="w-[65pt] shrink-0">{itemStatus}</p>
              </div>
            ))}
          </div>

          <div className="flex min-w-[293pt] flex-col gap-[8pt]">
            <div className="flex flex-col gap-[4pt] border-b-[1pt] border-black pb-[8pt]">
              <SummaryRow label="Total Project Cost:">{money(invoice.total)}</SummaryRow>
              {invoice.requests.map((r, i) => {
                const status = REQUEST_STATUS[r.status];
                return (
                  <SummaryRow
                    key={i}
                    label={
                      // A label that already carries its share ("Deposit 30%") keeps it; "Down Payment" gets it appended, greyed.
                      r.label.includes("%") ? (
                        `${r.label}:`
                      ) : (
                        <>
                          {r.label}{" "}
                          <span className="text-[#a2a2a2]">({requestPercent(r.amount, invoice.total, invoice.currency)}%):</span>
                        </>
                      )
                    }
                  >
                    {money(r.amount)}{" "}
                    <span className="text-[9pt]">
                      {r.url && r.status === "pending" ? (
                        <a href={r.url} className="underline">
                          ({status})
                        </a>
                      ) : (
                        `(${status})`
                      )}
                    </span>
                  </SummaryRow>
                );
              })}
              <SummaryRow label="Paid:">{money(invoice.amountPaid)}</SummaryRow>
            </div>
            <SummaryRow label="Remaining Balance:">{money(remaining)}</SummaryRow>
          </div>
        </div>
        {invoice.notes && <p className="text-[10pt] whitespace-pre-line text-[#a2a2a2]">{invoice.notes}</p>}
      </section>

      <footer className="mt-auto grid h-[54pt] grid-cols-[28pt_229pt_110pt_110pt_1fr] grid-rows-2 border-[1pt] border-black text-[10pt]">
        <div className="row-span-2 grid place-items-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- static print asset */}
          <img src="/invoice/info-mark.svg" width={1} height={13} alt="" className="h-[13pt] w-[1pt]" />
        </div>
        <p className="row-span-2 flex items-center border-l-[1pt] border-black pr-[16pt] pl-[16pt]">
          <span className="w-[197pt] whitespace-pre-line">{studio.address}</span>
        </p>
        <p className="grid place-items-center border-l-[1pt] border-black whitespace-nowrap">{studio.phone}</p>
        <p className="grid place-items-center border-l-[1pt] border-black whitespace-nowrap">{studio.email}</p>
        <p className="grid place-items-center border-l-[1pt] border-black whitespace-nowrap">{studio.website}</p>
        <p className="grid place-items-center border-t-[1pt] border-l-[1pt] border-black whitespace-nowrap">{invoice.number ?? "DRAFT"}</p>
        <div className="border-t-[1pt] border-l-[1pt] border-black">
          {/* eslint-disable-next-line @next/next/no-img-element -- static print asset */}
          <img src="/invoice/cross.svg" width={110} height={28} alt="" className="block h-full w-full" />
        </div>
        <div className="flex items-stretch border-t-[1pt] border-l-[1pt] border-black" aria-hidden>
          {[100, 90, 80, 70, 60, 50, 40, 30, 20, 10].map((o) => (
            <span key={o} className="flex-1 bg-black" style={{ opacity: o / 100 }} />
          ))}
        </div>
      </footer>
    </article>
  );
}

/** Page setup for the print route and "Print" from the app. */
export function InvoicePrintStyles() {
  return (
    <style>{`
      @page { size: A4; margin: 0; }
      html, body { background: #eee !important; color: #000; }
      @media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    `}</style>
  );
}
