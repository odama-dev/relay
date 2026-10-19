import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { unstable_rethrow } from "next/navigation";
import type { DashboardContext, OpenRequest } from "@/lib/dashboard/queries";
import type { Money } from "@/lib/dashboard/pure";
import { formatDateShort } from "@/lib/format";
import { DashboardCard, cardRowClass, type CardSpan } from "@/components/dashboard-card";
import { MoneyText } from "@/components/money-text";
import { cn } from "@/lib/utils";

export type CardMeta = { id: string; title: string; span: CardSpan };

/**
 * A dashboard card as a self-contained slot (PRD/OVERVIEW-SPEC.md §1.5): its
 * own Suspense skeleton, and a failed load renders the card's error state
 * instead of breaking the page. Each card makes its own (single) query.
 */
export function defineCard<T>(
  meta: CardMeta,
  load: (ctx: DashboardContext) => Promise<T>,
  render: (data: T, ctx: DashboardContext, meta: CardMeta) => ReactNode,
) {
  async function Loaded({ ctx }: { ctx: DashboardContext }) {
    let data: T;
    try {
      data = await load(ctx);
    } catch (err) {
      unstable_rethrow(err);
      console.error(`[dashboard] ${meta.id} failed`, err);
      return <DashboardCard title={meta.title} span={meta.span} state="error" />;
    }
    return render(data, ctx, meta);
  }
  function Card({ ctx }: { ctx: DashboardContext }) {
    return (
      <Suspense fallback={<DashboardCard title={meta.title} span={meta.span} state="loading" />}>
        <Loaded ctx={ctx} />
      </Suspense>
    );
  }
  Card.displayName = `DashboardCard(${meta.id})`;
  return Card;
}

/** Amounts per original currency, one per line (§1.4). */
export function MoneyList({ items, className, empty = "—" }: { items: Money[]; className?: string; empty?: string }) {
  if (items.length === 0) return <span className={cn("text-muted-foreground tabular", className)}>{empty}</span>;
  return (
    <span className={cn("flex flex-col", className)}>
      {items.map((m) => (
        <MoneyText key={m.currency} value={m.amount} currency={m.currency} />
      ))}
    </span>
  );
}

/** One pending payment request: invoice, label, client, amount, due / days late (PM-4, CL-1, FN-3). */
export function RequestRow({ r, showCreator = false }: { r: OpenRequest; showCreator?: boolean }) {
  return (
    <li>
      <Link href={`/invoices/${r.invoice.id}`} className={cn(cardRowClass, "items-start py-2")}>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">
            <span className="tabular">{r.invoice.number ?? "Draft"}</span> <span className="text-muted-foreground">· {r.label}</span>
          </span>
          <span className="text-muted-foreground truncate text-caption">
            {r.client.name}
            {showCreator && r.invoice.createdBy && <> · by {r.invoice.createdBy}</>}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <MoneyText value={r.amount} currency={r.currency} />
          <span className={cn("tabular text-caption", r.state === "late" ? "text-destructive" : "text-muted-foreground")}>
            {r.state === "late" ? `${r.daysLate}d late · ${formatDateShort(r.dueDate)}` : `Due ${formatDateShort(r.dueDate)}`}
          </span>
        </span>
      </Link>
    </li>
  );
}
