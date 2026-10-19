"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ProjectDetail } from "@/lib/projects/queries";
import { roleLabel } from "@/lib/roles";
import { formatDate, sentenceEnum } from "@/lib/format";
import { addMembers, removeMember } from "../actions";
import { Button } from "@/components/ui/button";
import { MemberAvatar } from "@/components/member-avatar";
import { DetailList } from "@/components/detail-list";
import { MoneyText } from "@/components/money-text";
import { RowActions } from "@/components/row-actions";
import { PeoplePicker } from "@/components/people-picker";
import { TextLink } from "@/components/text-link";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { icons } from "@/components/icon";

type Project = NonNullable<ProjectDetail>;

/** Project info, links and members (M1.2, M1.4). */
export function OverviewPanel({ project, people }: { project: Project; people: { id: string; name: string; avatarUrl: string | null }[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const memberIds = new Set(project.members.map((m) => m.id));
  const candidates = people.filter((p) => !memberIds.has(p.id));
  const links = [
    ["Notion", project.links.notion],
    ["Figma", project.links.figma],
    ["Drive", project.links.drive],
  ].filter(([, url]) => url) as [string, string][];

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-body font-medium">
            Members <span className="text-muted-foreground tabular font-normal">{project.members.length}</span>
          </h3>
          {project.viewer.canManage && (
            <Button variant="tertiary" size="sm" onClick={() => setAdding(true)} leadingIcon={icons.invite}>
              Add members
            </Button>
          )}
        </div>
        <ul className="flex flex-col divide-y divide-black/4 dark:divide-white/5">
          {project.members.map((m) => (
            <li key={m.id} className="flex h-12 items-center gap-3 rounded-lg px-3 text-body">
              <MemberAvatar seed={m.id} src={m.avatarUrl} size={26} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">
                  {m.name}
                  {!m.active && <span className="text-muted-foreground"> · deactivated</span>}
                </span>
                <span className="text-muted-foreground truncate text-caption">{m.isPm ? "Project manager" : roleLabel(m.role)}</span>
              </span>
              {project.viewer.canManage && !m.isPm && (
                <RowActions
                  label={`Actions for ${m.name}`}
                  actions={[
                    {
                      label: "Remove from project",
                      icon: "delete",
                      destructive: true,
                      onSelect: async () => {
                        const res = await removeMember(project.id, m.id);
                        if (!res.ok) return void toast.error(res.error);
                        toast.success(`${m.name} removed — their history stays`);
                        router.refresh();
                      },
                    },
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-caption">Only members see and work on the project&apos;s tasks. Removed members stay in task, comment and time history.</p>
      </section>

      <DetailList
        items={[
          ["Code", <span key="c" className="tabular">{project.code}</span>],
          ["Client", project.client ? <TextLink key="cl" href={`/clients/${project.client.id}`}>{project.client.name}</TextLink> : "Internal"],
          ["Contract", project.contractType ? (project.contractType === "time_and_material" ? "Time & material" : sentenceEnum(project.contractType)) : "—"],
          ["Currency", project.currency],
          ...(project.viewer.canSeeContract ? ([["Contract value", <MoneyText key="v" value={project.contractValue ?? null} currency={project.currency} />]] as [string, React.ReactNode][]) : []),
          ["PM", project.pm.name],
          ["Dates", `${formatDate(project.startDate)} → ${project.endDate ? formatDate(project.endDate) : "open-ended"}`],
          ["Links", links.length ? (
            <span key="l" className="flex flex-wrap gap-x-3">
              {links.map(([label, url]) => (
                <TextLink key={label} href={url} external>
                  {label}
                </TextLink>
              ))}
            </span>
          ) : null],
          ["Slack channel", project.links.slack_channel],
        ]}
      />

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add members</DialogTitle>
            <DialogDescription>Only active people can be added.</DialogDescription>
          </DialogHeader>
          <PeoplePicker people={candidates} value={picked} onChange={setPicked} placeholder="Choose people" className="border" />
          <DialogFooter>
            <Button variant="tertiary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              disabled={picked.length === 0}
              onClick={async () => {
                const res = await addMembers(project.id, picked);
                if (!res.ok) return void toast.error(res.error);
                toast.success(`Added ${picked.length}`);
                setPicked([]);
                setAdding(false);
                router.refresh();
              }}
            >
              Add {picked.length || ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
