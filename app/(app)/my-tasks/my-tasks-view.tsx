"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { TaskRow } from "@/lib/tasks/queries";
import { dueBucket, DUE_BUCKET_LABELS, type DueBucket } from "@/lib/time/pure";
import { ViewToggle, LIST_KANBAN_OPTIONS, type ViewMode } from "@/components/view-toggle";
import { EmptyState } from "@/components/states";
import { TaskLine } from "@/components/tasks/task-row";
import { TaskKanban } from "@/components/tasks/task-kanban";
import { LogTimeButton } from "@/components/time/log-time-dialog";
import { cn } from "@/lib/utils";

const ORDER: DueBucket[] = ["overdue", "today", "this_week", "later", "none"];

/** `viewParam` keeps the list / kanban choice in the URL (the dashboard uses its own, beside the calendar's `view`). */
export function MyTasksView({ tasks, today, viewParam = "view" }: { tasks: TaskRow[]; today: string; viewParam?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = (params.get(viewParam) === "list" ? "list" : "kanban") as ViewMode;
  const openTaskId = params.get("task");

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const open = (id: string) => setParam({ task: id });

  if (tasks.length === 0) {
    return <EmptyState icon="myTasks" title="Nothing on your plate" description="Tasks where you're the owner or a collaborator show up here until they're Done." />;
  }

  const groups = ORDER.map((bucket) => ({ bucket, items: tasks.filter((t) => dueBucket(t.dueDate, today) === bucket) })).filter((g) => g.items.length);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <ViewToggle value={view} onChange={(v) => setParam({ [viewParam]: v === "kanban" ? null : v })} options={LIST_KANBAN_OPTIONS} />
        <span className="text-muted-foreground text-body">
          <span className="tabular">{tasks.length}</span> open
        </span>
      </div>
      {view === "kanban" ? (
        <TaskKanban tasks={tasks} canEdit={() => true} openTaskId={openTaskId} onOpen={open} />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(({ bucket, items }) => (
            <section key={bucket} className="flex flex-col gap-1">
              <h2 className={cn("flex items-baseline gap-2 px-2 text-body font-medium", bucket === "overdue" && "text-destructive")}>
                {DUE_BUCKET_LABELS[bucket]}
                <span className="text-muted-foreground tabular text-caption font-normal">{items.length}</span>
              </h2>
              <div className="flex flex-col">
                {items.map((t) => (
                  <TaskLine
                    key={t.id}
                    task={t}
                    showProject
                    selected={openTaskId === t.id}
                    onOpen={() => open(t.id)}
                    trailing={<LogTimeButton taskId={t.id} variant="ghost" size="icon-compact" label={`Log time on ${t.title}`} className="opacity-60 group-hover:opacity-100" />}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
