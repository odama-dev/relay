import { Suspense } from "react";
import type { CurrentUser } from "@/lib/auth";
import { roleLabel } from "@/lib/roles";
import { dashboardContext, loadActivityHeatmap, loadProjectCalendar, loadRecentComments, loadWorkSummary, type RecentComment } from "@/lib/dashboard/queries";
import { greeting, parseWorkPeriodKind, resolveWorkPeriod, type WorkPeriod } from "@/lib/dashboard/pure";
import { formatDateLong, formatHours, formatPercent, formatRelative } from "@/lib/format";
import { isIsoDate, monthStart, timeIn } from "@/lib/time/pure";
import { CardList, panelSection, panelSections } from "@/components/dashboard-card";
import { PageHeader } from "@/components/page-header";
import { RefreshButton } from "@/components/refresh-button";
import { SummaryStrip } from "@/components/summary-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityHeatmap } from "@/components/activity-heatmap";
import { MemberAvatar } from "@/components/member-avatar";
import { TaskRowButton } from "./widgets";
import { SectionBody } from "./clevel/parts";
import { WorkPeriodSelect } from "./work-period-select";
import { Change, StripSkeleton } from "./kpi";
import { WorkCalendar } from "./work-calendar";
import { getMyTasks } from "@/lib/tasks/queries";
import { LogTimeButton } from "@/components/time/log-time-dialog";
import { MyTasksView } from "../my-tasks/my-tasks-view";

/** Weeks on the logged-time heatmap — as many as fit the side column. */
const HEATMAP_WEEKS = 18;

/** DD-3 — who's waiting for your reply: recent comments on your tasks, or mentioning you. */
function CommentList({ rows }: { rows: RecentComment[] }) {
  if (rows.length === 0) return <p className="text-muted-foreground py-1 text-body">No new comments this week.</p>;
  return (
    <CardList>
      {rows.map((c) => (
        <TaskRowButton key={c.id} taskId={c.task.id} className="items-start py-2">
          <MemberAvatar seed={c.author.id} src={c.author.avatarUrl} size={22} className="mt-0.5 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="shrink-0 font-medium">{c.author.name}</span>
              <span className="text-muted-foreground min-w-0 truncate text-caption">on {c.task.title}</span>
              <span className="text-muted-foreground ml-auto shrink-0 text-caption">{formatRelative(c.createdAt)}</span>
            </span>
            <span className="text-muted-foreground line-clamp-2">{c.text}</span>
          </span>
        </TaskRowButton>
      ))}
    </CardList>
  );
}

// ---------------------------------------------------------------------------
// The dashboard: KPIs over a period, then your calendar and activity
// ---------------------------------------------------------------------------

type Summary = Awaited<ReturnType<typeof loadWorkSummary>>;

/**
 * The Designer & Developer dashboard, laid out like the C-Level overview:
 * your KPIs for the chosen period in one strip, then the calendar of the
 * projects you're on beside your logged-time heatmap and new comments.
 */
export function DesignerDevDashboard({ user, searchParams }: { user: CurrentUser; searchParams: Record<string, string | string[] | undefined> }) {
  const ctx = dashboardContext(user);
  const kind = parseWorkPeriodKind(searchParams.period);
  const period = resolveWorkPeriod(kind, ctx.today);
  const summary = loadWorkSummary(ctx, period);
  // The calendar: ?view=week&week=yyyy-mm-dd, or ?month=yyyy-mm (default: this month).
  const view = searchParams.view === "week" ? "week" : "month";
  const rawMonth = typeof searchParams.month === "string" ? `${searchParams.month}-01` : "";
  const anchor = view === "week" ? (isIsoDate(searchParams.week) ? searchParams.week : ctx.today) : isIsoDate(rawMonth) ? rawMonth : monthStart(ctx.today);
  const firstName = user.fullName.split(" ")[0] || user.fullName;
  return (
    <div className="flex flex-col">
      <PageHeader
        title={`${greeting(timeIn(user.timezone))}, ${firstName}`}
        description={`${formatDateLong(ctx.today)} · ${roleLabel(user.role)}`}
        actions={
          <>
            <WorkPeriodSelect kind={kind} />
            <RefreshButton />
          </>
        }
        className="bleed mb-0"
      />
      <Suspense fallback={<StripSkeleton />}>
        <SectionBody title="Your KPIs" load={() => summary}>
          {(s) => <KpiStrip s={s} period={period} />}
        </SectionBody>
      </Suspense>
      {/* PRD Phase 2: your to-do and kanban are the main view; log time (non-billable too) from here. */}
      <section aria-label="Your work" className="bleed flex flex-col gap-3 border-b py-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-subtitle font-semibold">Your work</h2>
          <LogTimeButton variant="primary" />
        </div>
        <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
          <SectionBody title="Your work" load={() => getMyTasks(user)}>
            {(tasks) => <MyTasksView tasks={tasks} today={ctx.today} viewParam="tasks" />}
          </SectionBody>
        </Suspense>
      </section>
      {/* Calendar and the activity column share one full-width row, split by a hairline. */}
      <div className="bleed grid border-b px-0! lg:grid-cols-[minmax(0,1fr)_360px]">
        <Suspense fallback={<Skeleton className="m-6 h-[680px] rounded-xl" />}>
          <SectionBody title="Project timeline" load={() => loadProjectCalendar(ctx, view, anchor)}>
            {(cal) => (
              <WorkCalendar view={cal.view} month={cal.month} weekStart={cal.weekStart} today={ctx.today} projects={cal.projects} tasks={cal.tasks} minutesByDay={cal.minutesByDay} />
            )}
          </SectionBody>
        </Suspense>
        <aside aria-label="Activity" className="flex min-w-0 flex-col border-t px-[var(--page-gutter,1rem)] pb-5 lg:border-t-0 lg:border-l">
          <div className={panelSections}>
            <section aria-label="Hours logged" className={panelSection}>
              <h2 className="text-subtitle flex min-h-14 items-center font-semibold">Hours logged</h2>
              <Suspense fallback={<Skeleton className="h-36 rounded-xl" />}>
                <SectionBody title="Hours logged" load={() => loadActivityHeatmap(ctx, HEATMAP_WEEKS)}>
                  {(h) => <ActivityHeatmap weeks={h.weeks} today={h.today} />}
                </SectionBody>
              </Suspense>
            </section>
            <section aria-label="Activity" className={panelSection}>
              <h2 className="text-subtitle flex min-h-10 items-center font-semibold">Activity</h2>
              <Suspense fallback={<Skeleton className="h-48 rounded-xl" />}>
                <SectionBody title="Activity" load={() => loadRecentComments(ctx)}>
                  {(rows) => <CommentList rows={rows} />}
                </SectionBody>
              </Suspense>
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}

function KpiStrip({ s, period }: { s: Summary; period: WorkPeriod }) {
  const billablePct = s.hours.value ? Math.round((s.hours.billable / s.hours.value) * 100) : null;
  return (
    <SummaryStrip
      variant="even"
      items={[
        { label: "Shots made", values: [s.shots.value], delta: <Change value={s.shots.value} previous={s.shots.previous} period={period} /> },
        {
          label: "Tasks completed",
          values: [s.tasks.value],
          delta: (
            <span className="text-muted-foreground text-caption">
              {s.tasks.onTimePct === null ? "No due dates to score" : `${formatPercent(s.tasks.onTimePct)} on time`}
            </span>
          ),
        },
        {
          label: "Projects worked on",
          values: [s.projects.value],
          delta: (
            <span className="text-muted-foreground text-caption">
              {s.projects.client} client · {s.projects.internal} internal
            </span>
          ),
        },
        {
          label: "Working hours",
          values: [
            <span key="v">
              {formatHours(s.hours.value)}
              {billablePct !== null && <span className="text-muted-foreground ml-2 text-subtitle font-normal">{billablePct}% billable</span>}
            </span>,
          ],
          delta: <Change value={s.hours.value} previous={s.hours.previous} period={period} hours />,
        },
      ]}
    />
  );
}
