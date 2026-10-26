import { requireAccess } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { listClients } from "@/lib/clients/queries";
import { PageHeader } from "@/components/page-header";
import { FilterBar } from "@/components/filter-bar";
import { EmptyState } from "@/components/states";
import { ClientPanel } from "@/components/clients/client-panel";
import { AddClientButton, ClientsTable } from "./clients-table";

export const metadata = { title: "Clients" };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAccess(perms.viewClients);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() || undefined : undefined;
  const archived = sp.status === "archived";
  const rows = await listClients(user, { q, archived });
  const canEdit = perms.editClients(user);
  const addButton = canEdit ? <AddClientButton /> : null;

  return (
    <div className="flex flex-col">
      <PageHeader title="Clients" compact actions={addButton} />
      {rows.length === 0 && !q && !archived ? (
        <>
          <EmptyState
            icon="clients"
            title="No clients yet"
            description={canEdit ? "Add a client once and reuse it on every project and invoice." : "Clients of your projects appear here."}
            action={addButton}
          />
          <ClientPanel canCreate={canEdit} />
        </>
      ) : (
        <>
          <FilterBar
            searchPlaceholder="Search name, code or contact"
            filters={[{ param: "status", label: "Status", allLabel: "Active clients", options: [{ value: "archived", label: "Archived" }] }]}
          />
          <ClientsTable rows={rows} canCreate={canEdit} />
        </>
      )}
    </div>
  );
}
