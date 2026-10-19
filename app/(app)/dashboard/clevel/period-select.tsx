"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PERIOD_KINDS, PERIOD_LABELS, type PeriodKind } from "@/lib/clevel/pure";
import { PillSelect } from "@/components/pill-select";
import { DateRangePicker } from "@/components/date-picker";
import { cn } from "@/lib/utils";

/** §2.2 — This month (default), Last month, This quarter, Year to date, Custom; kept in `?period=&from=&to=`. */
export function PeriodSelect({ kind, from, to }: { kind: PeriodKind; from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-60")}>
      <PillSelect
        ariaLabel="Period"
        value={kind}
        options={PERIOD_KINDS.map((k) => ({ value: k, label: PERIOD_LABELS[k] }))}
        onChange={(k) => go(k === "custom" ? { period: k, from, to } : { period: k === "month" ? null : k, from: null, to: null })}
      />
      {kind === "custom" && (
        <DateRangePicker
          aria-label="Custom period"
          from={from}
          to={to}
          className="w-64"
          onChange={(r) => r.from && r.to && go({ period: "custom", from: r.from, to: r.to })}
        />
      )}
    </div>
  );
}
