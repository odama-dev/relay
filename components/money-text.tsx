import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/** An amount in its own currency, tabular. The one way money is rendered. */
export function MoneyText({
  value,
  currency,
  compact = false,
  muted = false,
  className,
}: {
  value: number | null | undefined;
  currency: string;
  compact?: boolean;
  muted?: boolean;
  className?: string;
}) {
  if (value == null) return <span className={cn("text-muted-foreground", className)}>—</span>;
  const full = formatMoney(value, currency);
  return (
    <span className={cn("tabular", muted && "text-muted-foreground", className)} title={full}>
      {compact ? formatMoney(value, currency, { compact: true }) : full}
    </span>
  );
}
