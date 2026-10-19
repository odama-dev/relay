import { requireAccess } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { getApprovalQueues } from "@/lib/time/approvals";
import { PageHeader } from "@/components/page-header";
import { EntityTabs } from "@/components/entity-tabs";
import { OosQueue } from "./oos-queue";
import { CorrectionsQueue } from "./corrections-queue";

export const metadata = { title: "Approvals" };

/**
 * What waits for a decision: out-of-scope work on the projects you run
 * (M4.3) and time corrections you review — the project's PM, or HR for
 * non-billable time (M3.5).
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireAccess(perms.reviewApprovals);
  const { tab } = await searchParams;
  const { managesProjects, oosRows, correctionRows } = await getApprovalQueues(user);

  return (
    <div className="flex flex-col">
      <PageHeader title="Approvals" compact />
      <EntityTabs
        variant="toolbar"
        initial={tab ?? (oosRows.length || !correctionRows.length ? "out-of-scope" : "corrections")}
        items={[
          ...(managesProjects ? [{ value: "out-of-scope", label: "Out of scope", count: oosRows.length, content: <OosQueue rows={oosRows} /> }] : []),
          { value: "corrections", label: "Time corrections", count: correctionRows.length, content: <CorrectionsQueue rows={correctionRows} /> },
        ]}
      />
    </div>
  );
}
