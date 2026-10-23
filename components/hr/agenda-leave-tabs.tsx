"use client";

import { useState, type ReactNode } from "react";
import { Tabs, TabItem, TabPanel, TabsList } from "@/components/ui/tabs";

/** The "Agenda & leave" card's two views on a full-width segmented control. */
export function AgendaLeaveTabs({ initial, agendaCount, leaveCount, agenda, leave }: { initial: "agenda" | "leave"; agendaCount: number; leaveCount: number; agenda: ReactNode; leave: ReactNode }) {
  const [tab, setTab] = useState<string>(initial);
  return (
    <Tabs value={tab} onValueChange={setTab} size="compact" className="flex flex-col gap-4">
      <TabsList aria-label="Agenda or leave requests" className="flex w-full">
        <TabItem value="agenda" label={agendaCount ? `Today's agenda ${agendaCount}` : "Today's agenda"} className="flex-1 justify-center" />
        <TabItem value="leave" label={leaveCount ? `Leave requests ${leaveCount}` : "Leave requests"} className="flex-1 justify-center" />
      </TabsList>
      <TabPanel value="agenda">{agenda}</TabPanel>
      <TabPanel value="leave">{leave}</TabPanel>
    </Tabs>
  );
}
