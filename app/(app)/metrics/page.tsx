import { requireUser } from "@/lib/auth";
import { METRIC_DEFINITIONS } from "@/lib/metrics/definitions";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Metric Dictionary" };

/** PRD Phase 2 — one definition per number; every dashboard uses the same one. */
export default async function MetricsPage() {
  await requireUser();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader title="Metric Dictionary" description="What each number on a dashboard means. Two dashboards showing the same metric always show the same value." />
      <dl className="flex flex-col divide-y divide-black/4 dark:divide-white/5">
        {METRIC_DEFINITIONS.map((m) => (
          <div key={m.key} id={m.key} className="grid scroll-mt-20 gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-6">
            <dt className="text-body font-medium">{m.term}</dt>
            <dd className="flex flex-col gap-1">
              <p className="text-body">{m.definition}</p>
              <p className="text-muted-foreground text-caption">{m.usedOn.join(" · ")}</p>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
