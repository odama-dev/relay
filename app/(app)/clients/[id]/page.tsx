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
import { ClientProjects, ClientInvoices, ClientDeals, ClientPeople } from "./client-lists";
import { getClientSales } from "@/lib/crm/queries";
import { formatMoney } from "@/lib/format";
import { SummaryStrip } from "@/components/summary-strip";
import { NotesPanel } from "@/components/crm/notes-panel";
import { MailActivity } from "@/components/mail/mail-activity";
import { crmMail } from "@/lib/mail/queries";
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
  // Sales opens the client as an account first (notes, deals, people).
  const salesView = user.role === "sales";
  const showSales = perms.viewPipeline(user);
  const sales = showSales ? await getClientSales(user, client.id) : null;
  const mail = sales ? await crmMail(user, { companyId: sales.company?.id, personIds: sales.people.map((p) => p.id) }) : [];
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
        className={sales ? "mb-0" : undefined}
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
      {sales && (
        <SummaryStrip
          variant="even"
          className="mb-6"
          items={[
            {
              label: "Deal stage",
              values: sales.current ? [sales.current.stage] : [],
              delta: sales.current && <span className="text-muted-foreground truncate text-caption">{sales.current.title}</span>,
            },
            { label: "Deal owner", values: sales.current?.owner ? [sales.current.owner.name] : [] },
            { label: "Deal value", values: sales.current ? [formatMoney(sales.current.value, sales.current.currency)] : [] },
            {
              label: "Associated people",
              values: sales.people.length ? [sales.people.slice(0, 2).map((p) => p.name).join(", ")] : [],
              delta: sales.people.length > 2 && <span className="text-muted-foreground text-caption">+{sales.people.length - 2} more</span>,
            },
          ]}
        />
      )}
      <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
        <EntityTabs
          initial={tab ?? (salesView ? "notes" : undefined)}
          items={[
            { value: "projects", label: "Projects", count: client.projects.length, content: <ClientProjects projects={client.projects} /> },
            ...(sales
              ? [
                  {
                    value: "notes",
                    label: "Notes",
                    count: sales.notes.length,
                    content: <NotesPanel target={{ clientId: client.id }} notes={sales.notes} canWrite={perms.manageDeals(user)} timeZone={user.timezone} />,
                  },
                  { value: "deals", label: "Deals", count: sales.deals.length, content: <ClientDeals deals={sales.deals} /> },
                  {
                    value: "email",
                    label: "Email",
                    count: mail.length,
                    content: (
                      <MailActivity
                        messages={mail}
                        timeZone={user.timezone}
                        emptyTitle="No email yet"
                        emptyDescription="Mail with this company or its people shows here once a mailbox is connected in Mail."
                      />
                    ),
                  },
                  { value: "people", label: "People", count: sales.people.length, content: <ClientPeople people={sales.people} /> },
                ]
              : []),
            {
              value: "contacts",
              label: "Billing contacts",
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
            ...(sales?.company ? ([["Company", sales.company.name], ["Domain", sales.company.domain]] as [string, string | null][]) : []),
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
