"use client";

import { useState } from "react";
import { PillButton } from "@/components/pill-button";
import { ObjectiveDialog, type OkrOptions } from "./okr-dialogs";

export function NewObjectiveButton({ cycleId, viewerId, options }: { cycleId: string; viewerId: string; options: OkrOptions }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PillButton icon="add" onClick={() => setOpen(true)}>
        New objective
      </PillButton>
      {open && <ObjectiveDialog cycleId={cycleId} viewerId={viewerId} options={options} objective={null} onClose={() => setOpen(false)} />}
    </>
  );
}
