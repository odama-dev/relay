import { Tooltip } from "@/components/ui/tooltip";
import { formatDate, formatMoney } from "@/lib/format";

type Outstanding = { currency: string; amount: number; count: number };

/**
 * Invoice-list Outstanding figure: everything normalised to IDR at indicative
 * ECB rates, with the per-currency amounts in a tooltip. Falls back to one
 * line per currency when there are no rates (or nothing to convert).
 */
export function OutstandingTotal({ outstanding, idr, rateDate, toIdr }: { outstanding: Outstanding[]; idr: number | null; rateDate: string; toIdr: Record<string, number> }) {
  if (idr === null || outstanding.every((o) => o.currency === "IDR")) {
    return outstanding.map((o) => <span key={o.currency}>{formatMoney(o.amount, o.currency)}</span>);
  }
  const invoices = outstanding.reduce((n, o) => n + o.count, 0);
  return (
    <Tooltip
      side="bottom"
      className="px-2.5 py-2 [text-box:normal] supports-[text-box:trim-both]:py-2"
      content={
        <div className="flex flex-col gap-1">
          {outstanding.map((o) => (
            <div key={o.currency} className="tabular flex justify-between gap-6">
              <span>
                {formatMoney(o.amount, o.currency)} <span className="opacity-60">· {o.count} {o.count === 1 ? "invoice" : "invoices"}</span>
              </span>
              {o.currency !== "IDR" && <span className="opacity-60">≈ {formatMoney(Math.round(o.amount * toIdr[o.currency]!), "IDR")}</span>}
            </div>
          ))}
          <div className="opacity-60">ECB reference rate, {formatDate(rateDate)}</div>
        </div>
      }
    >
      <span tabIndex={0} className="flex w-fit cursor-default flex-col gap-0.5 outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]">
        <span>≈ {formatMoney(idr, "IDR")}</span>
        <span className="text-muted-foreground text-caption font-normal">
          Normalized to IDR from {invoices} {invoices === 1 ? "invoice" : "invoices"} in {outstanding.length} currencies
        </span>
      </span>
    </Tooltip>
  );
}
