"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { PmProject } from "@/lib/dashboard/queries";
import type { IsoDate } from "@/lib/time/pure";
import { Tabs, TabItem, TabsList } from "@/components/ui/tabs";
import { PmCalendar } from "./pm-calendar";
import { PmTimeline } from "./pm-timeline";

/** The PM's calendar with a Timeline tab beside it (`?plan=timeline`). */
export function PmPlanner({ view, month, from, today, projects }: { view: "calendar" | "timeline"; month: IsoDate; from: IsoDate; today: IsoDate; projects: PmProject[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const switcher = (
    <Tabs
      value={view}
      onValueChange={(v) => {
        const next = new URLSearchParams(params.toString());
        if (v === "timeline") next.set("plan", "timeline");
        else next.delete("plan");
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      }}
      size="compact"
    >
      <TabsList aria-label="Calendar or timeline">
        <TabItem value="calendar" label="Calendar" />
        <TabItem value="timeline" label="Timeline" />
      </TabsList>
    </Tabs>
  );
  return view === "timeline" ? (
    <PmTimeline today={today} projects={projects} from={from} switcher={switcher} />
  ) : (
    <PmCalendar month={month} today={today} projects={projects} switcher={switcher} />
  );
}
