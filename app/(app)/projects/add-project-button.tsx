"use client";

import { useOpenFromUrl } from "@/lib/hooks/use-open-from-url";
import { PillButton } from "@/components/pill-button";
import { ProjectFormDialog, type ClientChoice, type PmChoice } from "./project-form-dialog";

export function AddProjectButton({
  clients,
  pms,
  canEditContract,
  defaultPmId,
  defaultThresholds,
  today,
  clientId,
}: {
  clients: ClientChoice[];
  pms: PmChoice[];
  canEditContract: boolean;
  defaultPmId: string;
  defaultThresholds: number[];
  today: string;
  /** Opened from a client page: that client is preselected. */
  clientId?: string;
}) {
  const [open, setOpen] = useOpenFromUrl();
  const client = clients.find((c) => c.id === clientId);
  return (
    <>
      <PillButton onClick={() => setOpen(true)}>New project</PillButton>
      {open && (
        <ProjectFormDialog
          open
          onOpenChange={setOpen}
          clients={clients}
          pms={pms}
          canEditContract={canEditContract}
          defaults={{
            name: "",
            kind: clients.length === 0 ? "internal" : "client",
            clientId: client?.id ?? "",
            contractType: "fixed",
            currency: (client?.defaultCurrency as "IDR") ?? "IDR",
            contractValue: null,
            retainerFeePerMonth: null,
            pmId: defaultPmId,
            status: "active",
            startDate: today,
            endDate: "",
            links: { notion: "", figma: "", drive: "", slack_channel: "" },
            budget: { budgetHours: null, retainerHoursPerMonth: null, rolloverMode: "none", rolloverCapHours: null, alertThresholds: defaultThresholds },
          }}
        />
      )}
    </>
  );
}
