import { requireAccess } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { loadBuilder } from "@/lib/kpi/builder";
import { PageHeader } from "@/components/page-header";
import { EntityTabs } from "@/components/entity-tabs";
import { MetricsPanel } from "@/components/kpi-builder/metrics-panel";
import { TemplatesPanel } from "@/components/kpi-builder/templates-panel";
import { AssignmentsPanel } from "@/components/kpi-builder/assignments-panel";
import { FormsPanel } from "@/components/kpi-builder/forms-panel";
import { CyclesPanel, ObjectionsPanel } from "@/components/kpi-builder/cycles-panel";

export const metadata = { title: "KPI & OKR Builder" };

/**
 * PRD Phase 2 "KPI & OKR builder": HR builds metrics, rating forms, KPI
 * templates and OKR cycles without a developer. Every change is logged and
 * versioned; recorded scores never change.
 */
export default async function PerformancePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireAccess(perms.managePeopleModule);
  const [{ tab }, data] = await Promise.all([searchParams, loadBuilder(user)]);
  return (
    <div className="flex flex-col">
      <PageHeader title="KPI & OKR Builder" compact />
      <EntityTabs
        variant="toolbar"
        initial={tab}
        items={[
          { value: "metrics", label: "Metrics", count: data.metrics.filter((m) => m.status === "active").length, content: <MetricsPanel metrics={data.metrics} taskTypes={data.taskTypes} /> },
          { value: "templates", label: "Templates", count: data.templates.length, content: <TemplatesPanel templates={data.templates} metrics={data.metrics} /> },
          { value: "assignments", label: "Assignments", content: <AssignmentsPanel data={data} /> },
          { value: "forms", label: "Rating forms", count: data.forms.length, content: <FormsPanel data={data} /> },
          { value: "cycles", label: "OKR cycles", count: data.cycles.length, content: <CyclesPanel cycles={data.cycles} /> },
          { value: "objections", label: "Objections", count: data.objections.length || undefined, content: <ObjectionsPanel rows={data.objections} /> },
        ]}
      />
    </div>
  );
}
