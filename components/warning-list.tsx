import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

/** Non-blocking warnings (PRD Phase 2 "Peringatan, tidak memblokir"): a hairline row per warning. */
export function WarningList({ warnings, className }: { warnings: string[]; className?: string }) {
  if (!warnings.length) return null;
  return (
    <ul className={cn("bleed flex flex-col border-b py-2", className)} aria-label="Warnings">
      {warnings.map((w) => (
        <li key={w} className="text-warning flex items-start gap-2 py-1 text-caption">
          <Icon name="warning" size={14} className="mt-0.5 shrink-0" />
          <span>{w}</span>
        </li>
      ))}
    </ul>
  );
}
