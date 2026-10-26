"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PillSelect } from "@/components/pill-select";
import { DEFAULT_REPORT_RANGE, REPORT_RANGES, type ReportRange } from "@/lib/sales/pure";
import { cn } from "@/lib/utils";

const OPTIONS = REPORT_RANGES.map((r) => ({ value: r.value, label: r.label }));

/** Period presets (last 3, 6, 12 months, all time) as a dropdown, kept in `?range=`; the default leaves the URL clean. */
export function RangeSelect({ value, className }: { value: ReportRange; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const pick = (r: ReportRange) => {
    const next = new URLSearchParams(params.toString());
    if (r === DEFAULT_REPORT_RANGE) next.delete("range");
    else next.set("range", r);
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  return (
    <div className={cn("transition-opacity", pending && "opacity-60", className)}>
      <PillSelect ariaLabel="Period" variant="tertiary" value={value} options={OPTIONS} onChange={(v) => v !== value && pick(v)} />
    </div>
  );
}
