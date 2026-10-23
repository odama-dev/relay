import type { ScorePeriod } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { hasModule, perms } from "@/lib/roles";
import { kpiPeople, loadPersonKpi, loadTeamKpi } from "@/lib/kpi/queries";
import { GRADES } from "@/lib/kpi/pure";
import { formatMonth } from "@/lib/format";
import { addMonths, isIsoDate, monthStart, todayIn } from "@/lib/time/pure";
import { PageHeader } from "@/components/page-header";
import { SummaryStrip } from "@/components/summary-strip";
import { EntityTabs } from "@/components/entity-tabs";
import { EmptyState } from "@/components/states";
import { ParamSelect } from "@/components/param-select";
import { KpiItemsTable } from "@/components/kpi/kpi-items-table";
import { KpiHistory } from "@/components/kpi/kpi-history";
import { KpiTeamTable } from "@/components/kpi/kpi-team-table";

export const metadata = { title: "KPI" };

const PERIODS: { value: ScorePeriod; label: string }[] = [
  { value: "monthly", label: "This month" },
  { value: "semester", label: "This semester" },
];

/**
 * PRD Phase 2 "KPI": your score this month (live) and the recorded results;
 * managers see their reports, the People and Studio Report modules everyone.
 * Role without a KPI keeps the menu with an empty state.
 */
export default async function KpiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = todayIn(user.timezone);
  const people = await kpiPeople(user);
  const personId = typeof sp.person === "string" && people.some((p) => p.id === sp.person) ? sp.person : user.id;
  const person = people.find((p) => p.id === personId);
  const period: ScorePeriod = sp.period === "semester" ? "semester" : "monthly";
  const month = typeof sp.month === "string" && isIsoDate(`${sp.month}-01`) ? `${sp.month}-01` : monthStart(today);
  const day = month === monthStart(today) ? today : month;
  const others = people.filter((p) => p.id !== user.id);

  const [data, team] = await Promise.all([loadPersonKpi(user, personId, period, day), others.length && personId === user.id ? loadTeamKpi(user, today) : null]);
  if (!data) return null;
  const { live, history } = data;
  const months = Array.from({ length: 6 }, (_, i) => addMonths(monthStart(today), -i));
  const grade = GRADES.find((g) => g.grade === live.grade);
  const isSelf = personId === user.id;

  const header = (
    <PageHeader
      title={isSelf ? "KPI" : `KPI · ${person?.name ?? ""}`}
      compact
      actions={
        <>
          {others.length > 0 && (
            <ParamSelect
              param="person"
              value={personId}
              defaultValue={user.id}
              ariaLabel="Person"
              options={[{ value: user.id, label: "Me" }, ...others.map((p) => ({ value: p.id, label: p.name }))]}
            />
          )}
          <ParamSelect
            param="month"
            value={month.slice(0, 7)}
            defaultValue={monthStart(today).slice(0, 7)}
            ariaLabel="Month"
            options={months.map((m) => ({ value: m.slice(0, 7), label: formatMonth(m) }))}
          />
          <ParamSelect param="period" value={period} defaultValue="monthly" ariaLabel="Score period" options={PERIODS} />
        </>
      }
    />
  );

  const mine = live.hasKpi ? (
    <>
      <SummaryStrip
        variant="even"
        items={[
          {
            label: period === "monthly" ? `Score · ${formatMonth(live.window.start)}` : "Score · this semester",
            values: [live.score === null ? "—" : Math.round(live.score)],
            delta: <span className="text-muted-foreground text-caption">{live.score === null ? "No data yet this period" : "So far — recorded when the period ends"}</span>,
          },
          {
            label: "Grade",
            values: [grade ? `${grade.grade} · ${grade.label}` : "—"],
            delta: <span className="text-muted-foreground text-caption">{grade?.action ?? "Needs data"}</span>,
          },
          {
            label: "Status",
            values: [live.calibration ? "Calibration" : "Counts"],
            delta: (
              <span className="text-muted-foreground text-caption">
                {live.calibration ? "First 2 months: recorded, doesn't affect reward" : "Monthly grade for coaching, semester for bonus"}
              </span>
            ),
          },
          {
            label: "Items with data",
            values: [`${live.items.filter((i) => i.scored && i.score !== null).length} of ${live.items.filter((i) => i.scored).length}`],
            delta: <span className="text-muted-foreground text-caption">Items without data are left out</span>,
          },
        ]}
      />
      <KpiItemsTable rows={live.items} />
    </>
  ) : (
    <EmptyState
      icon="target"
      title={isSelf ? "You don't have a KPI yet" : `${person?.name ?? "This person"} doesn't have a KPI yet`}
      description="KPIs are set by HR."
    />
  );

  const tabs = [
    { value: "current", label: isSelf ? "My KPI" : "Current", content: mine },
    { value: "history", label: "Recorded", count: history.length || undefined, content: <KpiHistory rows={history} isSelf={isSelf} canDecide={perms.managePeopleModule(user)} /> },
    ...(team
      ? [
          {
            value: "team",
            label: hasModule(user, "people", "studio_report") ? "Everyone" : "My team",
            count: team.length,
            content: (
              <KpiTeamTable
                rows={team.map(({ person: p, kpi }) => ({
                  id: p.id,
                  name: p.name,
                  avatarUrl: p.avatarUrl,
                  jobRole: p.jobRole,
                  score: kpi.score,
                  grade: kpi.grade,
                  calibration: kpi.calibration,
                  hasKpi: kpi.hasKpi,
                  items: kpi.items.length,
                }))}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col">
      {header}
      <EntityTabs variant="toolbar" initial={typeof sp.tab === "string" ? sp.tab : undefined} items={tabs} />
    </div>
  );
}
