import { requireUser } from "@/lib/auth";
import { perms, USER_ROLES, roleLabel } from "@/lib/roles";
import { jobRoleOptions, listPeople, parsePeopleFilters } from "@/lib/people/queries";
import { PageHeader } from "@/components/page-header";
import { FilterBar } from "@/components/filter-bar";
import { PeopleTable } from "./people-table";
import { InviteButton } from "./invite-dialog";

export const metadata = { title: "People" };

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const canManage = perms.managePeople(user) || perms.managePeopleModule(user);
  const filters = parsePeopleFilters(await searchParams, canManage);
  const [people, jobRoles] = await Promise.all([listPeople(user, filters), canManage ? jobRoleOptions(user) : []]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <PageHeader
        title="People"
        description={
          canManage
            ? "Manage studio members, set roles and access, and invite new people."
            : "Everyone working at the studio."
        }
        className="mb-2"
      />
      <FilterBar
        variant="inline"
        actions={canManage ? <InviteButton canGrantAdmin={user.isAdmin} /> : null}
        searchPlaceholder="Search name or email"
        filters={[
          {
            param: "role",
            label: "Role",
            allLabel: "All roles",
            options: USER_ROLES.map((r) => ({ value: r, label: roleLabel(r) })),
          },
          ...(canManage
            ? [
                {
                  param: "status",
                  label: "Status",
                  allLabel: "Active",
                  options: [
                    { value: "invited", label: "Invited" },
                    { value: "deactivated", label: "Deactivated" },
                  ],
                },
              ]
            : []),
        ]}
      />
      <div className="overflow-hidden rounded-lg border [--page-gutter:0px]">
        <PeopleTable
          rows={people}
          currentUserId={user.id}
          canManage={canManage}
          isAdmin={user.isAdmin}
          canManagePeopleModule={perms.managePeopleModule(user)}
          jobRoles={jobRoles}
        />
      </div>
    </div>
  );
}
