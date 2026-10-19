"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { TaskStatus, UserRole } from "@prisma/client";
import { TASK_STATUSES } from "@/lib/validation";
import { roleLabel } from "@/lib/roles";
import { updateTask } from "@/app/(app)/tasks/actions";
import { resendInvite } from "@/app/(app)/people/actions";
import { showInviteLink } from "@/app/(app)/people/invite-dialog";
import { StatusBadge, statusLabel } from "@/components/status-badge";
import { SelectField } from "@/components/select-field";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { DropdownContent, DropdownMenu, DropdownTrigger } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { cardRowClass } from "@/components/dashboard-card";
import { cn } from "@/lib/utils";

/** Opens the task panel mounted on the dashboard (`?task=<id>`, see TaskPanel). */
function useOpenTask() {
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

/** PM-3 — give an ownerless task an owner from the project's members. */
export function AssignOwner({ taskId, members }: { taskId: string; members: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <SelectField
      aria-label="Assign owner"
      size="compact"
      className="w-36 shrink-0"
      placeholder="Assign owner"
      disabled={busy || members.length === 0}
      value=""
      options={members.map((m) => ({ value: m.id, label: m.name }))}
      onChange={async (ownerId) => {
        if (!ownerId) return;
        setBusy(true);
        const res = await updateTask(taskId, { ownerId });
        setBusy(false);
        if (!res.ok) return void toast.error(res.error);
        toast.success("Owner assigned");
        router.refresh();
      }}
    />
  );
}

type PersonTasks = { id: string; name: string; role: UserRole; open: number; overdue: number; done: number };

/** HR-3 — sortable table; most overdue first by default. */
export function TasksPerPersonTable({ rows }: { rows: PersonTasks[] }) {
  const columns: Column<PersonTasks>[] = [
    { id: "name", header: "Person", cell: (r) => r.name, sortValue: (r) => r.name },
    { id: "role", header: "Role", cell: (r) => roleLabel(r.role), sortValue: (r) => roleLabel(r.role) },
    { id: "open", header: "Open", align: "right", cell: (r) => <span className="tabular">{r.open}</span>, sortValue: (r) => r.open },
    {
      id: "overdue",
      header: "Overdue",
      align: "right",
      cell: (r) => <span className={cn("tabular", r.overdue > 0 && "text-destructive")}>{r.overdue}</span>,
      sortValue: (r) => r.overdue,
    },
    { id: "done", header: "Done this month", align: "right", cell: (r) => <span className="tabular">{r.done}</span>, sortValue: (r) => r.done },
  ];
  return <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} pageSize={8} />;
}

/** HR-4 — send an invitation again (7-day link, M0.1). */
export function ResendInviteButton({ personId }: { personId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="compact"
      variant="ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await resendInvite(personId);
        setBusy(false);
        if (!res.ok) return void toast.error(res.error);
        showInviteLink(res.data.link, res.data.emailed);
      }}
    >
      Resend
    </Button>
  );
}
