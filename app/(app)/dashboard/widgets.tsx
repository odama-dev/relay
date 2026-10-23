"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { TaskStatus } from "@prisma/client";
import { TASK_STATUSES } from "@/lib/validation";
import { updateTask } from "@/app/(app)/tasks/actions";
import { StatusBadge, statusLabel } from "@/components/status-badge";
import { DropdownContent, DropdownMenu, DropdownTrigger } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { cardRowClass } from "@/components/dashboard-card";
import { cn } from "@/lib/utils";

/** Opens the task panel mounted on the dashboard (`?task=<id>`, see TaskPanel). */
export function useOpenTask() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("task", id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
}

/** A card row that opens a task; `trailing` holds inline controls outside the button. */
export function TaskRowButton({ taskId, children, trailing, className }: { taskId: string; children: ReactNode; trailing?: ReactNode; className?: string }) {
  const open = useOpenTask();
  return (
    <li className={cn(cardRowClass, className)}>
      <button type="button" onClick={() => open(taskId)} className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none">
        {children}
      </button>
      {trailing}
    </li>
  );
}

/** DD-1 — change a task's status from the card. */
export function TaskStatusMenu({ taskId, status }: { taskId: string; status: TaskStatus }) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const change = async (next: TaskStatus) => {
    const before = value;
    setValue(next);
    const res = await updateTask(taskId, { status: next });
    if (!res.ok) {
      setValue(before);
      return void toast.error(res.error);
    }
    router.refresh();
  };
  return (
    <DropdownMenu size="compact">
      <DropdownTrigger
        aria-label="Change status"
        className="shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]"
      >
        <StatusBadge value={value} />
      </DropdownTrigger>
      <DropdownContent align="end" checkedIndex={TASK_STATUSES.indexOf(value)}>
        {TASK_STATUSES.map((s, i) => (
          <MenuItem key={s} index={i} label={statusLabel(s)} checked={s === value} onSelect={() => void change(s)} />
        ))}
      </DropdownContent>
    </DropdownMenu>
  );
}
