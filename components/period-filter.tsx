"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DateRangePicker } from "@/components/date-picker";

/** A date-range filter kept in `?from=&to=` (invoice issue dates M5.9, expense dates). */
export function PeriodFilter({ from, to, label, placeholder }: { from?: string; to?: string; label: string; placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <DateRangePicker
      aria-label={label}
      from={from ?? ""}
      to={to ?? ""}
      clearable
      placeholder={placeholder}
      className="w-64"
      onChange={({ from: f, to: t }) => {
        const next = new URLSearchParams(params.toString());
        if (f) next.set("from", f);
        else next.delete("from");
        if (t) next.set("to", t);
        else next.delete("to");
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      }}
    />
  );
}
