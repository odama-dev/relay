"use client";

import Link from "next/link";
import type { PmProject } from "@/lib/dashboard/queries";
import { PROJECT_STANDINGS, type ProjectStanding } from "@/lib/dashboard/pure";
import { formatDateShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CardGroupLabel, CardList, cardRowClass, panelSection, panelSections } from "@/components/dashboard-card";
import { StatusBadge } from "@/components/status-badge";
import { ProjectColorPicker } from "./project-color-picker";

const GROUPS: Record<ProjectStanding, { label: string; tone?: "critical" | "warning" }> = {
  delayed: { label: "Delayed", tone: "critical" },
  at_risk: { label: "At risk", tone: "warning" },
  on_track: { label: "On track" },
};

/**
 * Every project you run by where it stands — delayed, at risk, on track —
 * with the reasons. A row opens the project; its dot sets the calendar colour.
 */
export function ProjectStatusList({ projects, today }: { projects: PmProject[]; today: string }) {
  if (projects.length === 0) return <p className="text-muted-foreground py-1 text-body">No active projects yet.</p>;
  return (
    <div className={panelSections}>
      {PROJECT_STANDINGS.map((standing) => {
        const rows = projects.filter((p) => p.standing === standing);
        if (rows.length === 0) return null;
        const g = GROUPS[standing];
        return (
          <div key={standing} className={panelSection}>
            <CardGroupLabel label={g.label} count={rows.length} tone={g.tone} />
            <CardList>
              {rows.map((p) => (
                <li key={p.id} className={cn(cardRowClass, "items-start gap-1 py-1.5 pl-1")}>
                  <ProjectColorPicker projectId={p.id} label={p.code} color={p.color} />
                  <Link href={`/projects/${p.id}`} className="flex min-w-0 flex-1 items-start gap-2 outline-none focus-visible:underline">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">
                        <span className="text-muted-foreground tabular">{p.code}</span> {p.name}
                      </span>
                      <span title={p.reasons.join(" · ") || undefined} className={cn("truncate text-caption", g.tone === "critical" && p.reasons.length ? "text-destructive" : "text-muted-foreground")}>
                        {p.reasons.length ? p.reasons.join(" · ") : p.endDate ? `${p.client} · ends ${formatDateShort(p.endDate)}` : `${p.client} · no end date`}
                      </span>
                    </span>
                    <StatusBadge value={p.standing} className="mt-0.5 shrink-0" />
                  </Link>
                </li>
              ))}
            </CardList>
          </div>
        );
      })}
      <p className="text-muted-foreground px-[var(--page-gutter,1rem)] py-3 text-caption">
        Delayed: past the end date or with overdue tasks. At risk: budget warning, blocked work, on hold, or ending within a week with open tasks. As of {formatDateShort(today)}.
      </p>
    </div>
  );
}
