"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PillSelect } from "@/components/pill-select";
import { cn } from "@/lib/utils";

/**
 * A PillSelect kept in the URL (`?<param>=`): the default value clears the
 * param, so links stay short. Same control as WorkPeriodSelect.
 */
export function ParamSelect({
  param,
  value,
  defaultValue,
  options,
  ariaLabel,
}: {
  param: string;
  value: string;
  defaultValue: string;
  options: { value: string; label: string }[];
  ariaLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const go = (v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v === defaultValue) next.delete(param);
    else next.set(param, v);
    const qs = next.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  return <PillSelect ariaLabel={ariaLabel} value={value} options={options} onChange={go} className={cn("transition-opacity", pending && "opacity-60")} />;
}
