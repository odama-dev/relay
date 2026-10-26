import { requireAccess } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { crmFormOptions, loadCompanies } from "@/lib/crm/queries";
import { activePeopleOptions } from "@/lib/people/queries";
import { PageHeader } from "@/components/page-header";
import { CompaniesView } from "./companies-view";

export const metadata = { title: "Companies" };

/** Sales CRM — companies (prospects and clients) with custom columns. */
export default async function CompaniesPage() {
  const user = await requireAccess(perms.viewPipeline);
  const [data, people, options] = await Promise.all([loadCompanies(user), activePeopleOptions(user), crmFormOptions(user)]);
  return (
    <div className="flex flex-col">
      <PageHeader title="Companies" compact />
      <CompaniesView rows={data.rows} columns={data.columns} owners={people.map((p) => ({ id: p.id, name: p.name }))} options={options} canEdit={perms.manageDeals(user)} />
    </div>
  );
}
