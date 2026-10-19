import Link from "next/link";
import { loadDueTasks, loadMonthSummary, loadRecentComments, loadWeekHours, type DashboardContext, type DueTask } from "@/lib/dashboard/queries";
import { formatDateShort, formatHours, formatMonth, formatPercent, formatRelative } from "@/lib/format";
import { CardFigure, CardGroupLabel, CardList, DashboardCard } from "@/components/dashboard-card";
import { StatusBadge } from "@/components/status-badge";
import { MemberAvatar } from "@/components/member-avatar";
import { LogTimeButton } from "@/components/time/log-time-dialog";
import { cn } from "@/lib/utils";
import { defineCard } from "./card";
import { TaskRowButton, TaskStatusMenu } from "./widgets";

const MAX_ROWS = 8;

function DueRow({ task }: { task: DueTask }) {
  return (
    <TaskRowButton
      taskId={task.id}
      trailing={
        <span className="flex shrink-0 items-center gap-1">
          <TaskStatusMenu taskId={task.id} status={task.status} />
          <LogTimeButton taskId={task.id} size="icon-compact" variant="ghost" label={`Log time on ${task.title}`} />
        </span>
      }
    >
      <span className="min-w-0 truncate">{task.title}</span>
      <span className="text-muted-foreground shrink-0 text-caption">{task.projectCode}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {task.priority !== "normal" && <StatusBadge value={task.priority} className="hidden sm:inline-flex" />}
        <span className={cn("tabular w-14 text-right text-caption", task.overdue ? "text-destructive" : "text-muted-foreground")}>
          {formatDateShort(task.dueDate)}
        </span>
      </span>
    </TaskRowButton>
  );
}

/** DD-1 — what to work on now. */
export const DueTasksCard = defineCard({ id: "DD-1", title: "Due today & overdue", span: "wide" }, loadDueTasks, (data, _ctx, meta) => {
  const overdue = data.overdue.slice(0, MAX_ROWS);
  const today = data.today.slice(0, Math.max(0, MAX_ROWS - overdue.length));
  return (
    <DashboardCard
      {...meta}
      count={data.total}
      countTone={data.overdue.length ? "critical" : "neutral"}
      action={{ label: "My Tasks", href: "/my-tasks" }}
      isEmpty={data.total === 0}
      emptyText="No tasks due today."
      emptyIcon="myTasks"
    >
      <div className="flex flex-col gap-3">
        {overdue.length > 0 && (
          <div className="flex flex-col gap-1">
            <CardGroupLabel label="Overdue" count={data.overdue.length} tone="critical" />
            <CardList>{overdue.map((t) => <DueRow key={t.id} task={t} />)}</CardList>
          </div>
        )}
        {today.length > 0 && (
          <div className="flex flex-col gap-1">
            <CardGroupLabel label="Today" count={data.today.length} />
            <CardList>{today.map((t) => <DueRow key={t.id} task={t} />)}</CardList>
          </div>
        )}
        {data.total > MAX_ROWS && (
          <Link href="/my-tasks" className="text-muted-foreground hover:text-foreground self-start text-caption underline-offset-4 hover:underline">
            {data.total - MAX_ROWS} more in My Tasks
          </Link>
        )}
      </div>
    </DashboardCard>
  );
});

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });

/** DD-2 — is this week's time logged? */
export const WeekHoursCard = defineCard({ id: "DD-2", title: "Hours this week", span: "narrow" }, loadWeekHours, (data, _ctx, meta) => {
  const missing = data.days.filter((d) => d.missing).length;
  return (
    <DashboardCard {...meta} action={<LogTimeButton size="compact" variant="tertiary" />}>
      <div className="flex flex-col gap-3">
        <CardFigure
          label="Logged"
          value={formatHours(data.total)}
          hint={data.total === 0 ? "No time logged this week yet." : missing ? `${missing} workday${missing === 1 ? "" : "s"} without time` : "Every workday so far has time"}
        />
        <ol className="grid grid-cols-7 gap-1">
          {data.days.map((d) => (
            <li key={d.date}>
              <Link
                href={`/timesheet?week=${data.weekStart}`}
                title={d.missing ? "Workday without time" : undefined}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-lg px-0.5 py-1.5 text-center transition-colors",
                  d.missing
                    ? "bg-warning/12 text-warning hover:bg-warning/20"
                    : "bg-hover hover:bg-active",
                  d.isToday && !d.missing && "bg-active",
                  !d.workday && "opacity-60",
                )}
              >
                <span className={cn("text-micro", !d.missing && "text-muted-foreground")}>{WEEKDAY.format(new Date(`${d.date}T00:00:00Z`))}</span>
                <span className="tabular text-caption font-medium">{d.minutes ? formatHours(d.minutes) : "—"}</span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </DashboardCard>
  );
});

/** DD-3 — who's waiting for your reply. */
export const RecentCommentsCard = defineCard({ id: "DD-3", title: "New comments", span: "wide" }, loadRecentComments, (rows, _ctx, meta) => (
  <DashboardCard {...meta} count={rows.length} isEmpty={rows.length === 0} emptyText="No new comments." emptyIcon="chat">
    <CardList>
      {rows.map((c) => (
        <TaskRowButton key={c.id} taskId={c.task.id} className="items-start py-2">
          <MemberAvatar seed={c.author.id} src={c.author.avatarUrl} size={22} className="mt-0.5 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="shrink-0 font-medium">{c.author.name}</span>
              <span className="text-muted-foreground min-w-0 truncate text-caption">on {c.task.title}</span>
              {c.mentioned && <span className="text-mention shrink-0 text-caption">mentioned you</span>}
            </span>
            <span className="text-muted-foreground truncate">{c.text}</span>
          </span>
          <span className="text-muted-foreground shrink-0 text-caption">{formatRelative(c.createdAt)}</span>
        </TaskRowButton>
      ))}
    </CardList>
  </DashboardCard>
));

/** DD-4 — progress this month (the base of Phase 2 KPIs). */
export const MonthSummaryCard = defineCard({ id: "DD-4", title: "This month", span: "narrow" }, loadMonthSummary, (data, ctx: DashboardContext, meta) => (
  <DashboardCard {...meta} action={{ label: "My Tasks", href: "/my-tasks" }}>
    <div className="grid grid-cols-3 gap-3">
      <CardFigure label="Completed" value={data.completed} hint={formatMonth(ctx.monthStart)} />
      <CardFigure label="On time" value={formatPercent(data.onTimePct)} hint="of those with a due date" />
      <CardFigure label="Overdue now" value={data.overdue} tone={data.overdue ? "critical" : undefined} />
    </div>
  </DashboardCard>
));
