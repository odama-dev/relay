import type { HrEventColor } from "@prisma/client";
import { badgeColors } from "@/components/ui/badge";
import { eventTone } from "@/components/hr/event-tone";

const HUES = ["blue", "green", "amber", "purple", "teal", "red", "indigo", "orange"] as const;

/**
 * A project's dot on the calendars: the colour its PM picked, else one taken
 * from its id so it keeps the same hue from month to month.
 */
export function projectHue(id: string, color: HrEventColor | null) {
  if (color) return eventTone(color).dot;
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return badgeColors[HUES[h % HUES.length]!];
}
