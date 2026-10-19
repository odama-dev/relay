import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAccess } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { getClient } from "@/lib/clients/queries";
import { clientOptions } from "@/lib/projects/queries";
import { activePeopleOptions } from "@/lib/people/queries";
import { getSettings } from "@/lib/settings";
import { todayIn } from "@/lib/time/pure";
import { PageHeader } from "@/components/page-header";
import { EntityTabs } from "@/components/entity-tabs";
import { StatusBadge } from "@/components/status-badge";
import { DetailList } from "@/components/detail-list";
import { ClientHeaderActions } from "./client-header-actions";
import { ContactsPanel } from "./contacts-panel";
import { ClientProjects, ClientInvoices } from "./client-lists";
import { AddProjectButton } from "../../projects/add-project-button";

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireAccess(perms.viewClients);
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const client = await getClient(user, id);
  if (!client) notFound();
  const canEdit = perms.editClients(user);
  const canCreateProject = perms.createProjects(user) && !client.isArchived;
  const [clients, pms, settings] = canCreateProject
    ? await Promise.all([clientOptions(user), activePeopleOptions(user, ["pm", "c_level"]), getSettings()])
    : [[], [], null];

  return (
    <div className="flex flex-col">
      <PageHeader
        title={client.name}
        eyebrow={
          <Link href="/clients" className="text-muted-foreground hover:text-foreground text-caption">
            Clients
          </Link>
        }
        meta={
          <div className="flex items-center gap-2 text-body">
            <span className="tabular text-muted-foreground">{client.code}</span>
            {client.isArchived && <StatusBadge value="archived" />}
          </div>
        }
        actions={
          <>
            {canCreateProject && settings && (
              <AddProjectButton
                clients={clients}
                pms={pms}
                canEditContract={perms.editContractValue(user)}
                defaultPmId={user.role === "pm" ? user.id : ""}
                defaultThresholds={settings.default_alert_thresholds}
                today={todayIn(user.timezone)}
                clientId={client.id}
              />
            )}
            {canEdit && <ClientHeaderActions client={client} />}
          </>
        }
      />
      <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
        <EntityTabs
          initial={tab}
          items={[
            { value: "projects", label: "Projects", count: client.projects.length, content: <ClientProjects projects={client.projects} /> },
            {
              value: "contacts",
              label: "Contacts",
              count: client.contacts.length,
              content: <ContactsPanel clientId={client.id} contacts={client.contacts} canEdit={canEdit} />,
            },
            ...(perms.viewInvoices(user)
              ? [{ value: "invoices", label: "Invoices", count: client.invoices.length, content: <ClientInvoices invoices={client.invoices} /> }]
              : []),
          ]}
        />
        <DetailList
          items={[
            ["Default currency", client.defaultCurrency],
            ["Country", client.country],
            ["Time zone", client.timezone],
            ["Billing email", client.billingEmail],
            ["Billing address", client.billingAddress],
            ["Notes", client.notes],
          ]}
        />
      </div>
    </div>
  );
}
