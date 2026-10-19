"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ProjectStatus } from "@prisma/client";
import type { ProjectDetail } from "@/lib/projects/queries";
import { PROJECT_STATUSES } from "@/lib/validation";
import { sentenceEnum } from "@/lib/format";
import { RowActions } from "@/components/row-actions";
import { ProjectFormDialog, type ClientChoice, type PmChoice } from "../project-form-dialog";
import { setProjectStatus } from "../actions";

type Project = NonNullable<ProjectDetail>;

export function ProjectHeaderActions({
  project,
  clients,
  pms,
  canEditContract,
}: {
  project: Project;
  clients: ClientChoice[];
  pms: PmChoice[];
  canEditContract: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const setStatus = async (status: ProjectStatus) => {
    const res = await setProjectStatus(project.id, status);
    if (!res.ok) return void toast.error(res.error);
    toast.success(`Project is now ${sentenceEnum(status).toLowerCase()}`);
    router.refresh();
  };

  return (
    <>
      <RowActions
        label="Project actions"
        variant="tertiary"
        actions={[
          { label: "Edit project", icon: "edit", onSelect: () => setEditing(true) },
          ...PROJECT_STATUSES.filter((s) => s !== project.status).map((s) => ({
            label: s === "archived" ? "Archive" : `Mark ${sentenceEnum(s).toLowerCase()}`,
            icon: (s === "archived" ? "archive" : "flag") as "archive" | "flag",
            onSelect: () => void setStatus(s),
          })),
        ]}
      />
      {editing && (
        <ProjectFormDialog
          open
          onOpenChange={setEditing}
          clients={clients.length ? clients : project.client ? [{ id: project.client.id, code: project.client.code, name: project.client.name, defaultCurrency: project.currency }] : []}
          pms={pms}
          canEditContract={canEditContract}
          project={{ id: project.id, code: project.code }}
          defaults={{
            name: project.name,
            kind: project.kind,
            clientId: project.client?.id ?? "",
            contractType: project.contractType ?? undefined,
            currency: project.currency as "IDR",
            contractValue: project.contractValue ?? null,
            retainerFeePerMonth: project.retainerFeePerMonth ?? null,
            pmId: project.pm.id,
            status: project.status,
            startDate: project.startDate,
            endDate: project.endDate ?? "",
            links: {
              notion: project.links.notion ?? "",
              figma: project.links.figma ?? "",
              drive: project.links.drive ?? "",
              slack_channel: project.links.slack_channel ?? "",
            },
            budget: project.budget ?? { budgetHours: null, retainerHoursPerMonth: 1, rolloverMode: "none", rolloverCapHours: null, alertThresholds: [75, 100] },
          }}
        />
      )}
    </>
  );
}
