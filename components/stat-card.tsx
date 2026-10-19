import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "@/components/icon";

type Props = {
  label: string;
  value: ReactNode;
  sublabel?: ReactNode;
  icon?: IconName;
  /** 0..1 ratio change vs previous period, optional. */
  delta?: number | null;
  className?: string;
};

export function StatCard({ label, value, sublabel, icon, delta, className }: Props) {
  return (
    <div className={cn("bg-surface-3 shadow-surface-2 rounded-xl p-4", className)}>
      <div className="flex items-center justify-between">
        <p className="text-caption text-muted-foreground">{label}</p>
        {icon && <Icon name={icon} size={15} className="text-muted-foreground" />}
      </div>
      <p className="tabular text-display mt-2 font-semibold">{value}</p>
      {(sublabel || delta != null) && (
        <div className="text-caption text-muted-foreground mt-1 flex items-center gap-1.5">
          {delta != null && Number.isFinite(delta) && (
            <span
              className={cn(
                "tabular font-medium",
                delta > 0 && "text-success",
                delta < 0 && "text-destructive",
              )}
            >
              {delta > 0 ? "+" : ""}
              {(delta * 100).toFixed(1)}%
            </span>
          )}
          {sublabel}
        </div>
      )}
    </div>
  );
}
