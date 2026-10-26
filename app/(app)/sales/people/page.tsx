import { requireAccess } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { crmFormOptions, loadPeople } from "@/lib/crm/queries";
import { activePeopleOptions } from "@/lib/people/queries";
import { PageHeader } from "@/components/page-header";
import { PeopleView } from "./people-view";

export const metadata = { title: "People" };

/** Sales CRM — contacts, at a company or on their own, with custom columns. `?company=` narrows to one company. */
export default async function SalesPeoplePage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const user = await requireAccess(perms.viewPipeline);
  const { company } = await searchParams;
  const [data, people, options] = await Promise.all([loadPeople(user), activePeopleOptions(user), crmFormOptions(user)]);
  const at = company ? data.companies.find((c) => c.id === company) : undefined;
  return (
    <div className="flex flex-col">
      <PageHeader title={at ? `People · ${at.name}` : "People"} compact />
      <PeopleView
        rows={at ? data.rows.filter((r) => r.company?.id === at.id) : data.rows}
        columns={data.columns}
        companies={data.companies}
        owners={people.map((p) => ({ id: p.id, name: p.name }))}
        options={options}
        defaultCompanyId={at?.id}
        canEdit={perms.manageDeals(user)}
      />
    </div>
  );
}
