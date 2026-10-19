"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ClientDetail } from "@/lib/clients/queries";
import { RowActions } from "@/components/row-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ClientFormDialog } from "../client-form-dialog";
import { deleteClient, setClientArchived } from "../actions";

export function ClientHeaderActions({ client }: { client: ClientDetail }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <RowActions
        label="Client actions"
        variant="tertiary"
        actions={[
          { label: "Edit", icon: "edit", onSelect: () => setEditing(true) },
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
      <ClientFormDialog
        open={editing}
        onOpenChange={setEditing}
        client={{
          id: client.id,
          codeLocked: client.codeLocked,
          values: {
            code: client.code,
            name: client.name,
            country: client.country ?? "",
            timezone: client.timezone ?? "",
            defaultCurrency: client.defaultCurrency as "IDR",
            billingEmail: client.billingEmail ?? "",
            billingAddress: client.billingAddress ?? "",
            notes: client.notes ?? "",
          },
        }}
      />
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
