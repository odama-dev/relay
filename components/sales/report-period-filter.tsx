"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PillSelect } from "@/components/pill-select";
import { DateRangePicker } from "@/components/date-picker";
import { REPORT_RANGES, type ReportRange } from "@/lib/sales/pure";

type Choice = ReportRange | "custom";
const OPTIONS: { value: Choice; label: string }[] = [...REPORT_RANGES.map((r) => ({ value: r.value, label: r.label })), { value: "custom", label: "Custom range" }];

/**
 * Report period as a dropdown: presets in `?range=` (last 3, 6, 12 months,
 * all time) or "Custom range", which shows a date-range picker kept in
 * `?from=&to=`. Picking a preset clears the custom range; clearing the
 * custom range goes back to the default preset.
 */
export function ReportPeriodFilter({ range, from, to }: { range: Choice; from?: string; to?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // "Custom range" picked but no dates yet: show the picker before the URL changes.
  const [picking, setPicking] = useState(false);
  const choice: Choice = picking ? "custom" : range;
  const go = (set: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(set)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <PillSelect
        ariaLabel="Report period"
        variant="tertiary"
        value={choice}
        options={OPTIONS}
        onChange={(v) => {
          if (v === "custom") return setPicking(true);
          setPicking(false);
          go({ range: v, from: null, to: null });
        }}
      />
      {choice === "custom" && (
        <DateRangePicker
          aria-label="Custom period"
          from={from ?? ""}
          to={to ?? ""}
          clearable
          placeholder="Pick dates"
          className="w-full sm:w-56"
          onChange={({ from: f, to: t }) => {
            if (!f) setPicking(false);
            go({ from: f || null, to: t || null, range: null });
          }}
        />
      )}
    </div>
  );
}
