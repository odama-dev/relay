import { Suspense } from "react";
import type { CurrentUser } from "@/lib/auth";
import { roleLabel } from "@/lib/roles";
import { dashboardContext, loadPmProjects, loadPmSummary, loadPmTeam } from "@/lib/dashboard/queries";
import { greeting, parseWorkPeriodKind, resolveWorkPeriod, type WorkPeriod } from "@/lib/dashboard/pure";
import { formatDateLong, formatHours, formatHoursValue, formatPercent } from "@/lib/format";
import { addDays, isIsoDate, monthStart, timeIn } from "@/lib/time/pure";
import { PageHeader } from "@/components/page-header";
import { RefreshButton } from "@/components/refresh-button";
import { SummaryStrip } from "@/components/summary-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTableSkeleton } from "@/components/page-skeletons";
import { PmPlanner } from "@/components/pm/pm-planner";
import { ProjectStatusList } from "@/components/pm/project-status-list";
import { PmTeamTable } from "@/components/pm/team-table";
import { cn } from "@/lib/utils";
import { SectionBody } from "./clevel/parts";
import { WorkPeriodSelect } from "./work-period-select";
import { Change, StripSkeleton } from "./kpi";

type Summary = Awaited<ReturnType<typeof loadPmSummary>>;
type Team = Awaited<ReturnType<typeof loadPmTeam>>;

/**
 * The PM dashboard, laid out like HR's: the projects you run over the chosen
 * period in one strip, a calendar of their timelines beside where each one
 * stands, then everyone on them today with the team's figures.
 */
export function PmDashboard({ user, searchParams }: { user: CurrentUser; searchParams: Record<string, string | string[] | undefined> }) {
  const ctx = dashboardContext(user);
  const kind = parseWorkPeriodKind(searchParams.period);
  const period = resolveWorkPeriod(kind, ctx.today);
  // The calendar: ?month=yyyy-mm (default: this month).
  const rawMonth = typeof searchParams.month === "string" ? `${searchParams.month}-01` : "";
  const month = isIsoDate(rawMonth) ? rawMonth : monthStart(ctx.today);
  // The timeline: ?plan=timeline, twelve weeks from ?from= (default: two weeks back).
  const plan = searchParams.plan === "timeline" ? "timeline" : "calendar";
  const from = isIsoDate(searchParams.from) ? searchParams.from : addDays(ctx.today, -14);
  // Each load is shared by the parts that read it (projects: calendar + status list).
  const summary = loadPmSummary(ctx, period);
  const projects = loadPmProjects(ctx);
  const team = loadPmTeam(ctx);
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
      <Suspense fallback={<StripSkeleton items={5} />}>
        <SectionBody title="Your projects" load={() => summary}>
          {(s) => <PmStrip s={s} period={period} />}
        </SectionBody>
      </Suspense>
      {/* Calendar and the project status column share one full-width row, split by a hairline. */}
      <div className="bleed grid border-b px-0! lg:grid-cols-[minmax(0,1fr)_360px]">
        <Suspense fallback={<Skeleton className="m-6 h-[560px] rounded-xl" />}>
          <SectionBody title="Project calendar" load={() => projects}>
            {(p) => <PmPlanner view={plan} month={month} from={from} today={ctx.today} projects={p} />}
          </SectionBody>
        </Suspense>
        <aside aria-label="Project status" className="flex min-w-0 flex-col gap-2 border-t px-[var(--page-gutter,1rem)] pb-5 lg:border-t-0 lg:border-l">
          <h2 className="text-subtitle flex min-h-14 items-center font-semibold">Project status</h2>
          <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
            <SectionBody title="Project status" load={() => projects}>
              {(p) => <ProjectStatusList projects={p} today={ctx.today} />}
            </SectionBody>
          </Suspense>
        </aside>
      </div>
      <section aria-label="Team" className="flex flex-col">
        <div className="bleed flex min-h-12 items-center justify-between gap-3 border-b py-2">
          <h2 className="text-body font-medium">Team today</h2>
          <span className="text-muted-foreground text-caption">Everyone on your projects — excluding you</span>
        </div>
        <Suspense
          fallback={
            <>
              <StripSkeleton items={5} />
              <DataTableSkeleton cols={6} rows={6} />
            </>
          }
        >
          <SectionBody title="Team today" load={() => team}>
            {(t) => (
              <>
                <TeamStrip t={t} />
                <PmTeamTable rows={t.rows} />
              </>
            )}
          </SectionBody>
        </Suspense>
      </section>
    </div>
  );
}

function PmStrip({ s, period }: { s: Summary; period: WorkPeriod }) {
  const billablePct = s.hours.value ? Math.round((s.hours.billable / s.hours.value) * 100) : null;
  const muted = "text-muted-foreground ml-2 text-subtitle font-normal";
  return (
    <SummaryStrip
      variant="even"
      items={[
        {
          label: "Active projects",
          values: [s.projects.value],
          delta: (
            <span className="text-muted-foreground text-caption">
              {s.projects.overBudget > 0 && <span className="text-destructive">{s.projects.overBudget} over budget · </span>}
              {s.projects.warning} warning
            </span>
          ),
        },
        {
          label: "Team hours · incl. you",
          values: [
            <span key="v">
              {formatHours(s.hours.value)}
              {billablePct !== null && <span className={muted}>{billablePct}% billable</span>}
            </span>,
          ],
          delta: <Change value={s.hours.value} previous={s.hours.previous} period={period} hours />,
        },
        {
          label: "Tasks completed",
          values: [
            <span key="v">
              {s.tasks.value}
              {s.tasks.onTimePct !== null && <span className={muted}>{formatPercent(s.tasks.onTimePct)} on time</span>}
            </span>,
          ],
          delta: <Change value={s.tasks.value} previous={s.tasks.previous} period={period} />,
        },
        {
          label: "Out of scope approved",
          values: [formatHours(s.oos.approved)],
          delta: (
            <span className={cn("text-caption", s.oos.pending ? "text-warning" : "text-muted-foreground")}>
              {s.oos.pending ? `${formatHours(s.oos.pending)} waiting for you` : "Nothing waiting"}
            </span>
          ),
        },
        {
          label: "Overdue tasks",
          tone: s.risk.overdue ? "destructive" : "default",
          values: [s.risk.overdue],
          delta: (
            <span className="text-muted-foreground text-caption">
              {s.risk.blocked} blocked · {s.risk.noOwner} without owner
            </span>
          ),
        },
      ]}
    />
  );
}

/** The team's figures, under the table header: who's on billable work, utilization, today's hours, who's away. */
function TeamStrip({ t }: { t: Team }) {
  const s = t.summary;
  const caption = "text-muted-foreground text-caption";
  return (
    <SummaryStrip
      variant="even"
      items={[
        {
          label: "On billable projects",
          values: [`${s.onBillable} of ${s.present}`],
          delta: <span className={caption}>{s.present - s.onBillable ? `${s.present - s.onBillable} on internal work only` : "Everyone in today"}</span>,
        },
        {
          label: "Team utilization",
          values: [s.utilization === null ? "—" : formatPercent(s.utilization)],
          delta: (
            <span className={caption}>
              {formatHoursValue(s.billableMinutes / 60)} billable of {formatHoursValue(s.capacityHours)} this week
            </span>
          ),
        },
        {
          label: "Logged today",
          values: [formatHours(s.todayMinutes)],
          delta: (
            <span className={caption}>
              {s.loggedToday} of {s.present} people
            </span>
          ),
        },
        {
          label: "Away today",
          values: [s.away],
          delta: <span className={caption}>{s.away ? "On leave, permit or sick" : "Nobody away"}</span>,
        },
        {
          label: "Overdue on your projects",
          tone: s.overdueTasks ? "destructive" : "default",
          values: [s.overdueTasks],
          delta: <span className={caption}>Tasks owned by the team</span>,
        },
      ]}
    />
  );
}
