"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { HrEventColor } from "@prisma/client";
import { HR_EVENT_COLORS } from "@/lib/validation";
import { setProjectColor } from "@/app/(app)/projects/actions";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EVENT_COLOR_LABELS, eventTone } from "@/components/hr/event-tone";
import { projectHue } from "@/components/calendar/project-hue";

/**
 * A project's dot that opens a row of colours; picking one sets the project's
 * colour on every calendar. The dot changes at once and goes back if refused.
 */
export function ProjectColorPicker({ projectId, label, color }: { projectId: string; label: string; color: HrEventColor | null }) {
  const router = useRouter();
  const [value, setValue] = useState(color);
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const pick = async (next: HrEventColor) => {
    const before = value;
    setValue(next);
    setOpen(false);
    const res = await setProjectColor(projectId, next);
    if (!res.ok) {
      setValue(before);
      return void toast.error(res.error);
    }
    start(() => router.refresh());
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Change ${label}'s colour`}
          title="Change colour"
          className="hover:bg-hover grid size-6 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]"
        >
          <span className="size-2 rounded-full" style={{ backgroundColor: projectHue(projectId, value) }} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div role="radiogroup" aria-label={`${label} colour`} className="flex gap-1.5">
          {HR_EVENT_COLORS.map((c) => {
            const tone = eventTone(c);
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={value === c}
                aria-label={EVENT_COLOR_LABELS[c]}
                title={EVENT_COLOR_LABELS[c]}
                onClick={() => void pick(c)}
                className={cn(
                  "grid size-7 place-items-center rounded-full border outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]",
                  value === c && "ring-foreground ring-2 ring-offset-2 ring-offset-[var(--background)]",
                )}
                style={tone.fill}
              >
                <span className="size-2.5 rounded-full" style={{ backgroundColor: tone.dot }} />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
