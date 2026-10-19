import { Icon } from "@/components/icon";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Small "↑ 12% vs last month" read-out. Green when the move is good, red when
 * it is bad (`goodWhenUp: false` for spending). Without a base (previous was 0)
 * it reads "— vs last month".
 */
export function TrendDelta({
  pct,
  goodWhenUp = true,
  label = "vs last month",
  className,
}: {
  /** Change in %, null when the previous value was 0. */
  pct: number | null;
  goodWhenUp?: boolean;
  label?: string;
  className?: string;
}) {
  if (pct === null) return <span className={cn("text-muted-foreground text-caption", className)}>— {label}</span>;
  const up = pct > 0;
  const tone = pct === 0 ? "text-muted-foreground" : up === goodWhenUp ? "text-success" : "text-destructive";
  return (
    <span className={cn("text-muted-foreground flex items-center gap-1 text-caption", className)}>
      <span className={cn("tabular flex items-center gap-0.5 font-medium", tone)}>
        {pct !== 0 && <Icon name={up ? "arrowUp" : "arrowDown"} size={12} />}
        {formatPercent(Math.abs(pct), 0)}
      </span>
      {label}
    </span>
  );
}
