import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ProgressTone = "success" | "warning" | "destructive" | "brand" | "neutral" | "muted";

// The tone sets `color`; the fill paints with currentColor (see .progress-fill in globals.css).
const TONE: Record<ProgressTone, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  brand: "text-foreground",
  neutral: "text-foreground/60",
  muted: "text-muted-foreground/40",
};

/**
 * The one progress bar: neutral track, flat fill in the tone's colour,
 * eased like Fluid's moderate spring. Size it with `className` (height/width); `children`
 * render on top of the track (e.g. threshold ticks).
 */
export function ProgressBar({
  value,
  tone = "brand",
  label,
  className,
  children,
}: {
  /** 0–100; clamped. */
  value: number;
  tone?: ProgressTone;
  /** Accessible name; without it the bar is decorative. */
  label?: string;
  className?: string;
  children?: ReactNode;
}) {
  const pct = Math.max(0, Math.min(value, 100));
  return (
    <span
      className={cn("progress-track relative block h-2 rounded-full", className)}
      {...(label
        ? { role: "progressbar", "aria-label": label, "aria-valuenow": Math.round(value), "aria-valuemin": 0, "aria-valuemax": 100 }
        : { "aria-hidden": true })}
    >
      {pct > 0 && (
        <span
          className={cn("progress-fill absolute inset-y-0 left-0 min-w-[6px] rounded-full transition-[width] duration-160 ease-out motion-reduce:transition-none", TONE[tone])}
          style={{ width: `${pct}%` }}
        />
      )}
      {children}
    </span>
  );
}
