"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { WORK_PERIODS, WORK_PERIOD_LABELS, type WorkPeriodKind } from "@/lib/dashboard/pure";
import { PillSelect } from "@/components/pill-select";
import { cn } from "@/lib/utils";

/** This week (default), This month, Last 3 / 6 months; kept in `?period=`. */
export function WorkPeriodSelect({ kind }: { kind: WorkPeriodKind }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const go = (k: WorkPeriodKind) => {
    const next = new URLSearchParams(params.toString());
    if (k === "week") next.delete("period");
    else next.set("period", k);
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  return (
    <PillSelect
      ariaLabel="Period"
      value={kind}
      options={WORK_PERIODS.map((k) => ({ value: k, label: WORK_PERIOD_LABELS[k] }))}
      onChange={go}
      className={cn("transition-opacity", pending && "opacity-60")}
    />
  );
}
