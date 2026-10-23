"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDate, formatWeekday } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/date-picker";
import { RowActions } from "@/components/row-actions";
import { EmptyState } from "@/components/states";
import { addHoliday, deleteHoliday } from "./actions";

type Holiday = { date: string; name: string };

/** National holidays: off everyone's capacity and the review SLA's working days. */
export function HolidaysPanel({ holidays }: { holidays: Holiday[] }) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");

  const act = async (p: Promise<{ ok: boolean; error?: string }>, done?: string) => {
    const res = await p;
    if (!res.ok) toast.error(res.error);
    else {
      if (done) toast.success(done);
      router.refresh();
    }
    return res.ok;
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-muted-foreground text-body">
        Holidays come off everyone&apos;s capacity and don&apos;t count as working days for review SLAs.
      </p>
      {holidays.length === 0 ? (
        <EmptyState icon="calendar" title="No holidays yet" description="Add this year's national holidays." fill={false} />
      ) : (
        <ul className="flex flex-col divide-y divide-black/4 dark:divide-white/5">
          {holidays.map((h) => (
            <li key={h.date} className="flex h-10 items-center gap-3 rounded-lg px-3 text-body hover:bg-hover">
              <span className="tabular w-28 shrink-0">{formatDate(h.date)}</span>
              <span className="text-muted-foreground w-12 shrink-0 text-caption">{formatWeekday(h.date)}</span>
              <span className="flex-1">{h.name}</span>
              <RowActions
                label={`Actions for ${h.name}`}
                actions={[{ label: "Delete", icon: "delete", destructive: true, onSelect: () => void act(deleteHoliday(h.date), "Deleted") }]}
              />
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act(addHoliday({ date, name }), "Holiday added")) {
            setDate("");
            setName("");
          }
        }}
      >
        <DatePicker value={date} onChange={setDate} aria-label="Holiday date" className="w-44" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Independence Day" className="max-w-xs" aria-label="Holiday name" />
        <Button type="submit" variant="tertiary" disabled={!date || !name.trim()}>Add</Button>
      </form>
    </div>
  );
}
