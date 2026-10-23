import { Suspense, type ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth";
import { dashboardContext } from "@/lib/dashboard/queries";
import { perms, roleLabel } from "@/lib/roles";
import { greeting } from "@/lib/dashboard/pure";
import { loadHrAgenda, loadHrCalendar, loadLeaveOverview, loadTeam } from "@/lib/hr/queries";
import { isIsoDate, monthStart, timeIn } from "@/lib/time/pure";
import { formatDateLong } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { RefreshButton } from "@/components/refresh-button";
import { LinkButton } from "@/components/link-button";
import { SummaryStrip } from "@/components/summary-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTableSkeleton } from "@/components/page-skeletons";
import { HrCalendar } from "@/components/hr/hr-calendar";
import { TeamTodayTable } from "@/components/hr/team-tables";
import { LeaveOverview } from "@/components/hr/leave";
import { AgendaList } from "@/components/hr/agenda-list";
import { AgendaLeaveTabs } from "@/components/hr/agenda-leave-tabs";
import { FilterBar } from "@/components/filter-bar";
import { SectionBody } from "./clevel/parts";
import { StripSkeleton } from "./kpi";

/**
 * The HR dashboard: today's team in one strip, HR's own calendar beside
 * today's agenda and leave requests, then the whole team today — what each
 * person is on and their week's workload.
 */
export function HrDashboard({ user, searchParams }: { user: CurrentUser; searchParams: Record<string, string | string[] | undefined> }) {
  const ctx = dashboardContext(user);
  // The calendar: ?view=week&week=yyyy-mm-dd, or ?month=yyyy-mm (default: this month).
  const view = searchParams.view === "week" ? "week" : "month";
  const rawMonth = typeof searchParams.month === "string" ? `${searchParams.month}-01` : "";
  const anchor = view === "week" ? (isIsoDate(searchParams.week) ? searchParams.week : ctx.today) : isIsoDate(rawMonth) ? rawMonth : monthStart(ctx.today);
  // Each load is shared by the strip and the section below it.
  const team = loadTeam(user, ctx.today);
  const leave = loadLeaveOverview(user, ctx.today);
  // Search on the Team today table: by name or role.
  const q = typeof searchParams.q === "string" ? searchParams.q.trim().toLowerCase() : "";
  const firstName = user.fullName.split(" ")[0] || user.fullName;
  return (
    <div className="flex flex-col">
      <PageHeader title={`${greeting(timeIn(user.timezone))}, ${firstName}`} description={`${formatDateLong(ctx.today)} · ${roleLabel(user.role)}`} actions={
          <>
            {perms.managePeopleModule(user) && (
              <LinkButton href="/performance" icon="intelligence" variant="secondary" size="compact">
                KPI & OKR builder
              </LinkButton>
            )}
            <RefreshButton />
          </>
        }
        className="bleed mb-0"
      />
      <Suspense fallback={<StripSkeleton items={4} />}>
        <SectionBody title="Today" load={() => Promise.all([team, leave])}>
          {([t, l]) => <HrStrip team={t} leave={l} />}
        </SectionBody>
      </Suspense>
      {/* Calendar and the agenda / leave column share one full-width row, split by a hairline. */}
      <div className="bleed grid border-b px-0! lg:grid-cols-[minmax(0,1fr)_360px]">
        <Suspense fallback={<Skeleton className="m-6 h-[680px] rounded-xl" />}>
          <SectionBody title="HR calendar" load={() => loadHrCalendar(user, view, anchor)}>
            {(cal) => (
              <HrCalendar
                view={cal.view}
                month={cal.month}
                weekStart={cal.weekStart}
                today={ctx.today}
                timezone={user.timezone}
                occurrences={cal.occurrences}
                series={cal.series}
                leave={cal.leave}
                obligations={cal.obligations}
                canEdit={perms.manageHrCalendar(user)}
              />
            )}
          </SectionBody>
        </Suspense>
        <aside aria-label="Agenda & leave" className="flex min-w-0 flex-col gap-2 border-t px-[var(--page-gutter,1rem)] pb-5 lg:border-t-0 lg:border-l">
          <h2 className="text-subtitle flex min-h-14 items-center font-semibold">Agenda &amp; leave</h2>
          <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
            <SectionBody title="Agenda & leave" load={() => Promise.all([loadHrAgenda(user, ctx.today), leave])}>
              {([agenda, l]) => (
                <AgendaLeaveTabs
                  initial={l.pending.length ? "leave" : "agenda"}
                  agendaCount={agenda.today.length}
                  leaveCount={l.pending.length}
                  agenda={<AgendaList today={ctx.today} events={agenda.today} upcoming={agenda.upcoming} later={agenda.later} />}
                  leave={<LeaveOverview pending={l.pending} upcoming={l.upcoming} viewerId={user.id} />}
                />
              )}
            </SectionBody>
          </Suspense>
        </aside>
      </div>
      <TableSection title="Team today" cols={6} actions={<FilterBar variant="bare" searchPlaceholder="Search people" />}>
        <SectionBody title="Team today" load={() => team}>
          {(t) => <TeamTodayTable rows={q ? t.today.filter((r) => `${r.name} ${roleLabel(r.role)}`.toLowerCase().includes(q)) : t.today} today={ctx.today} />}
        </SectionBody>
      </TableSection>
    </div>
  );
}

function TableSection({ title, cols, actions, children }: { title: string; cols: number; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col">
      <div className="bleed flex min-h-12 items-center justify-between gap-3 border-b py-2">
        <h2 className="text-body font-medium">{title}</h2>
        {actions}
      </div>
      <Suspense fallback={<DataTableSkeleton cols={cols} rows={6} />}>{children}</Suspense>
    </section>
  );
}

function HrStrip({ team, leave }: { team: Awaited<ReturnType<typeof loadTeam>>; leave: Awaited<ReturnType<typeof loadLeaveOverview>> }) {
  // Attendance, not logged hours (PRD Phase 2 "Working today").
  const working = team.today.filter((r) => r.status === "present" || r.status === "remote").length;
  const expected = team.today.filter((r) => r.status === "present" || r.status === "remote" || r.status === "not_checked_in").length;
  const over = team.workload.filter((r) => r.pct !== null && r.pct > 100).length;
  return (
    <SummaryStrip
      variant="even"
      items={[
        { label: "Working today", values: [`${working} of ${expected}`], delta: <span className="text-muted-foreground text-caption">{expected - working} not checked in yet</span> },
        {
          label: "Away today",
          values: [leave.today.length],
          delta: <span className="text-muted-foreground text-caption">{leave.upcoming.length} booked in the next 30 days</span>,
        },
        {
          label: "Leave requests",
          tone: leave.pending.length ? "destructive" : "default",
          values: [leave.pending.length],
          delta: <span className="text-muted-foreground text-caption">{leave.pending.length ? "Waiting for a decision" : "Nothing waiting"}</span>,
        },
        {
          label: "Workload over capacity",
          tone: over ? "destructive" : "default",
          values: [over],
          delta: <span className="text-muted-foreground text-caption">More work due this week than hours</span>,
        },
      ]}
    />
  );
}
