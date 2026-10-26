"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ClientDetail } from "@/lib/clients/queries";
import { RowActions } from "@/components/row-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ClientPanel, useOpenClient } from "@/components/clients/client-panel";
import { deleteClient, setClientArchived } from "../actions";

export function ClientHeaderActions({ client }: { client: ClientDetail }) {
  const router = useRouter();
  const openClient = useOpenClient();
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <RowActions
        label="Client actions"
        variant="tertiary"
        actions={[
          // The edit form opens in the client panel, as it does from the list.
          { label: "Edit", icon: "edit", onSelect: () => openClient(client.id, { edit: true }) },
          {
            label: client.isArchived ? "Restore" : "Archive",
            icon: client.isArchived ? "restore" : "archive",
            onSelect: async () => {
              const res = await setClientArchived(client.id, !client.isArchived);
              if (!res.ok) return void toast.error(res.error);
              toast.success(client.isArchived ? "Client restored" : "Client archived");
              router.refresh();
            },
          },
          { label: "Delete", icon: "delete", destructive: true, hidden: client.hasHistory, onSelect: () => setDeleting(true) },
        ]}
      />
      <ClientPanel ids={[client.id]} scope="Clients" />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${client.name}?`}
        description="The client has no projects or invoices, so it can be removed for good."
        confirmLabel="Delete client"
        destructive
        onConfirm={async () => {
          const res = await deleteClient(client.id);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success("Client deleted");
          router.push("/clients");
        }}
      />
    </>
  );
}
