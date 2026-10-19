"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { PersonRow } from "@/lib/people/queries";
import { employmentLabel, roleLabel } from "@/lib/roles";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { MemberAvatar } from "@/components/member-avatar";
import { RowActions } from "@/components/row-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { resendInvite, retrySlackLink, setPersonActive } from "./actions";
import { PersonDialog } from "./person-dialog";
import { showInviteLink } from "./invite-dialog";

export function PeopleTable({
  rows,
  currentUserId,
  canManage,
  isAdmin,
}: {
  rows: PersonRow[];
  currentUserId: string;
  canManage: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const [toggling, setToggling] = useState<PersonRow | null>(null);

  const columns: Column<PersonRow>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (r) => r.fullName.toLowerCase(),
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <MemberAvatar seed={r.id} src={r.avatarUrl} size={24} />
          {r.fullName}
          {r.isAdmin && <Badge size="compact">Admin</Badge>}
        </div>
      ),
    },
    { id: "email", header: "Email", sortValue: (r) => r.email, cell: (r) => r.email },
    { id: "role", header: "Role", sortValue: (r) => roleLabel(r.role), cell: (r) => roleLabel(r.role) },
    {
      id: "employment",
      header: "Employment",
      sortValue: (r) => r.employmentType,
      cell: (r) => employmentLabel(r.employmentType),
    },
    ...(canManage
      ? [
          { id: "status", header: "Status", sortValue: (r: PersonRow) => r.status, cell: (r: PersonRow) => <StatusBadge value={r.status} /> },
          {
            id: "slack",
            header: "Slack",
            sortValue: (r: PersonRow) => (r.slackLinked ? 1 : 0),
            cell: (r: PersonRow) =>
              r.slackLinked ? <span>Linked</span> : <span>Not linked</span>,
          },
          {
            id: "actions",
            header: "",
            className: "w-12 text-right",
            cell: (r: PersonRow) => (
              <RowActions
                label={`Actions for ${r.fullName}`}
                actions={[
                  { label: "Edit", icon: "edit", onSelect: () => setEditing(r) },
                  {
                    label: "Resend invitation",
                    icon: "mail",
                    hidden: r.status !== "invited",
                    onSelect: async () => {
                      const res = await resendInvite(r.id);
                      if (!res.ok) return void toast.error(res.error);
                      showInviteLink(res.data.link, res.data.emailed);
                    },
                  },
                  {
                    label: "Retry Slack link",
                    icon: "refresh",
                    hidden: !isAdmin || r.slackLinked || r.status !== "active",
                    onSelect: async () => {
                      const res = await retrySlackLink(r.id);
                      if (!res.ok) toast.error(res.error);
                      else toast.success("Linked to Slack");
                    },
                  },
                  {
                    label: r.status === "deactivated" ? "Reactivate" : "Deactivate",
                    icon: r.status === "deactivated" ? "reactivate" : "deactivate",
                    destructive: r.status !== "deactivated",
                    hidden: r.id === currentUserId,
                    onSelect: () => setToggling(r),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        isRowInactive={(r) => r.status === "deactivated"}
        emptyTitle="No people found"
        emptyDescription="Try another search or filter."
      />
      {editing && (
        <PersonDialog
          person={editing}
          canGrantAdmin={isAdmin}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(o) => !o && setToggling(null)}
        title={
          toggling?.status === "deactivated" ? `Reactivate ${toggling.fullName}?` : `Deactivate ${toggling?.fullName ?? ""}?`
        }
        description={
          toggling?.status === "deactivated"
            ? "They can sign in again and be picked as owner, collaborator or member."
            : "They're signed out right away and can't sign in. Their tasks, comments, time and invoices stay in the history."
        }
        confirmLabel={toggling?.status === "deactivated" ? "Reactivate" : "Deactivate"}
        destructive={toggling?.status !== "deactivated"}
        onConfirm={async () => {
          if (!toggling) return;
          const res = await setPersonActive(toggling.id, toggling.status === "deactivated");
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success(toggling.status === "deactivated" ? "Reactivated" : "Deactivated");
          router.refresh();
        }}
      />
    </>
  );
}
