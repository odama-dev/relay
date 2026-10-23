import type { HrEventColor } from "@prisma/client";
import { badgeColors } from "@/components/ui/badge";

/**
 * Calendar chip colours: every chip sits on the same neutral fill (the theme's
 * `--accent`, as a gray Badge does) so the timeline reads calm; only the dot
 * carries the event's hue, at full strength from the Badge palette.
 */
export function eventTone(color: HrEventColor): { fill: React.CSSProperties; dot: string } {
  return {
    fill: { backgroundColor: "var(--accent)", borderColor: "var(--border)" },
    dot: color === "gray" ? "var(--muted-foreground)" : badgeColors[color],
  };
}

export const EVENT_COLOR_LABELS: Record<HrEventColor, string> = { gray: "Gray", blue: "Blue", green: "Green", amber: "Amber", red: "Red", purple: "Purple", teal: "Teal" };
