"use client";

import { useState } from "react";
import type { MailView } from "@/lib/mail/queries";
import { formatDateTime, formatRelative } from "@/lib/format";
import { DataTable, type Column } from "@/components/data-table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { DetailList } from "@/components/detail-list";

/** Who the email was with: the sender of what you received, the recipients of what you sent. */
const counterpart = (m: MailView) => (m.direction === "inbound" ? m.from.name || m.from.email : m.to.join(", ") || "—");

/**
 * Sent and received mail as a table; a row opens the message. `onReply`
 * (your own mail only) prefills a reply in the composer.
 */
export function MailActivity({
  messages,
  timeZone,
  emptyTitle = "No mail yet",
  emptyDescription,
  onReply,
}: {
  messages: MailView[];
  timeZone: string;
  emptyTitle?: string;
  emptyDescription?: string;
  onReply?: (m: MailView) => void;
}) {
  const [open, setOpen] = useState<MailView | null>(null);
  const columns: Column<MailView>[] = [
    {
      id: "direction",
      header: "",
      className: "w-8",
      cell: (m) => (
        <span className={m.direction === "inbound" ? "text-chart-in" : "text-muted-foreground"} title={m.direction === "inbound" ? "Received" : "Sent"}>
          <Icon name={m.direction === "inbound" ? "arrowDown" : "arrowUp"} size={14} />
          <span className="sr-only">{m.direction === "inbound" ? "Received" : "Sent"}</span>
        </span>
      ),
      sortValue: (m) => m.direction,
    },
    {
      id: "with",
      header: "From / to",
      primary: true,
      cell: (m) => <span className="block max-w-56 truncate">{counterpart(m)}</span>,
      sortValue: (m) => counterpart(m).toLowerCase(),
    },
    {
      id: "subject",
      header: "Subject",
      cell: (m) => (
        <button type="button" className="flex max-w-[28rem] min-w-0 gap-2 text-left" onClick={() => setOpen(m)}>
          <span className="truncate">{m.subject || "(no subject)"}</span>
          {m.snippet && <span className="text-muted-foreground truncate">{m.snippet}</span>}
        </button>
      ),
      sortValue: (m) => m.subject.toLowerCase(),
    },
    {
      id: "linked",
      header: "Linked to",
      cell: (m) => (
        <span className="block max-w-48 truncate">
          {[m.person?.name, m.company?.name].filter(Boolean).join(" · ") || <span className="text-muted-foreground">—</span>}
        </span>
      ),
      sortValue: (m) => m.company?.name ?? m.person?.name ?? "",
    },
    {
      id: "date",
      header: "Date",
      align: "right",
      cell: (m) => <span title={formatDateTime(m.sentAt, timeZone)}>{formatRelative(m.sentAt)}</span>,
      sortValue: (m) => m.sentAt,
    },
  ];
  return (
    <>
      <DataTable columns={columns} rows={messages} getRowId={(m) => m.id} pageSize={25} emptyTitle={emptyTitle} emptyDescription={emptyDescription} />
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(null)}>
          <DialogContent size="lg" className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{open.subject || "(no subject)"}</DialogTitle>
              <DialogDescription>
                {open.direction === "inbound" ? "Received" : "Sent"} {formatDateTime(open.sentAt, timeZone)}
                {open.account && ` · ${open.account}`}
              </DialogDescription>
            </DialogHeader>
            <DetailList
              items={[
                ["From", open.from.name ? `${open.from.name} <${open.from.email}>` : open.from.email],
                ["To", open.to.join(", ") || "—"],
                ...(open.cc.length ? ([["Cc", open.cc.join(", ")]] as [string, string][]) : []),
                ...(open.person || open.company
                  ? ([["Linked to", [open.person?.name, open.company?.name].filter(Boolean).join(" · ")]] as [string, string][])
                  : []),
              ]}
            />
            <div className="bg-surface-3 shadow-surface-2 max-h-[50dvh] overflow-y-auto rounded-xl p-4 text-body whitespace-pre-wrap break-words">
              {open.body || open.snippet || "No text content."}
            </div>
            <DialogFooter>
              <Button type="button" variant="tertiary" onClick={() => setOpen(null)}>
                Close
              </Button>
              {onReply && open.mine && (
                <Button
                  type="button"
                  onClick={() => {
                    onReply(open);
                    setOpen(null);
                  }}
                >
                  Reply
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
