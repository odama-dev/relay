"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Inbox, InboxItem } from "@/lib/notifications/queries";
import { listInbox, markInboxRead } from "@/app/(app)/inbox-actions";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/icon";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export const INBOX_KEY = ["inbox"] as const;
const POLL_MS = 30_000;

const TYPE_ICON: Record<string, IconName> = {
  task_assigned: "myTasks",
  task_mentioned: "chat",
  task_comment: "chat",
  task_due_tomorrow: "calendar",
  task_blocked: "warning",
  time_reminder: "timesheet",
  correction_requested: "approvals",
  correction_decided: "approvals",
  oos_digest: "flag",
  oos_decided: "flag",
  budget_threshold: "health",
  payment_received: "payments",
  payment_unmatched: "payments",
  invoice_overdue: "invoices",
};

type Tab = "all" | "unread";

/**
 * The in-app inbox: every notification the system sent you (the same ones
 * that go to Slack). Sits beside the sidebar search and opens as a panel to
 * the right of the rail. Closing the panel marks them read.
 */
export function NotificationBell({ initialInbox }: { initialInbox: Inbox }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const queryClient = useQueryClient();
  const { data: inbox = initialInbox } = useQuery({
    queryKey: INBOX_KEY,
    queryFn: () => listInbox(),
    initialData: initialInbox,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && inbox.unreadCount > 0) {
      queryClient.setQueryData<Inbox>(INBOX_KEY, (prev) =>
        prev ? { items: prev.items.map((i) => ({ ...i, unread: false })), unreadCount: 0 } : prev,
      );
      void markInboxRead();
    }
  };

  const label = inbox.unreadCount > 0 ? `Notifications (${inbox.unreadCount} unread)` : "Notifications";
  const items = tab === "unread" ? inbox.items.filter((i) => i.unread) : inbox.items;
  const tabs: { value: Tab; label: string; count: number }[] = [
    { value: "all", label: "All", count: inbox.items.length },
    { value: "unread", label: "Unread", count: inbox.unreadCount },
  ];

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="tertiary" size="icon" className="relative size-8 shrink-0" aria-label={label}>
          <Icon name="notification" size={14} />
          {/* Button wraps children in an icon-sized relative span: offsets are from the icon, not the button. */}
          {inbox.unreadCount > 0 && <span aria-hidden className="bg-brand absolute -top-0.5 -right-0.5 size-1.5 rounded-full" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={12}
        className="shadow-overlay bg-popover w-[26rem] max-w-[calc(100vw-2rem)] gap-0 p-0"
      >
        <div className="flex flex-col gap-3 px-5 pt-5 pb-3">
          <PopoverTitle className="text-[length:var(--fs-title,16px)] leading-[var(--lh-title,22px)] font-semibold">
            Notifications
          </PopoverTitle>
          <div role="tablist" aria-label="Filter notifications" className="flex gap-4">
            {tabs.map((t) => (
              <button
                key={t.value}
                role="tab"
                type="button"
                aria-selected={tab === t.value}
                onClick={() => setTab(t.value)}
                className={cn(
                  "tabular cursor-pointer text-body transition-colors duration-80",
                  tab === t.value ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label} ({t.count})
              </button>
            ))}
          </div>
        </div>
        <div className="border-t" />
        {items.length === 0 ? (
          <EmptyInbox unreadOnly={tab === "unread" && inbox.items.length > 0} onNavigate={() => onOpenChange(false)} />
        ) : (
          <ul className="flex max-h-[min(30rem,70vh)] flex-col gap-0.5 overflow-y-auto p-2">
            {items.map((item) => (
              <Row key={item.id} item={item} onNavigate={() => onOpenChange(false)} />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Bell on a dotted plate, with a way into the notification preferences. */
function EmptyInbox({ unreadOnly, onNavigate }: { unreadOnly: boolean; onNavigate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 pt-10 pb-10 text-center">
      <div
        aria-hidden
        className="text-muted-foreground/60 mb-5 grid size-28 place-items-center bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:10px_10px] [mask-image:radial-gradient(circle,black_45%,transparent_72%)]"
      >
        <Icon name="notification" size={44} />
      </div>
      <p className="text-subtitle font-semibold">{unreadOnly ? "No unread notifications" : "No notifications"}</p>
      <p className="text-muted-foreground max-w-[18rem] text-body">
        {unreadOnly
          ? "You’re all caught up."
          : "Task assignments, mentions, approvals and payment updates will show up here."}
      </p>
      <Button variant="tertiary" size="compact" className="mt-4" render={<Link href="/profile" onClick={onNavigate} />}>
        Settings
      </Button>
    </div>
  );
}

const ROW_CLASS =
  "hover:bg-hover focus-visible:bg-hover active:bg-active flex items-start gap-3 rounded-lg px-3 py-2.5 outline-none transition-colors duration-80";

function Row({ item, onNavigate }: { item: InboxItem; onNavigate: () => void }) {
  const body = (
    <>
      <Icon name={TYPE_ICON[item.type] ?? "notification"} size={16} className="text-muted-foreground mt-0.5 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-body leading-5 font-medium">{item.title}</span>
        {item.body && <span className="text-muted-foreground line-clamp-2 text-caption leading-4">{item.body}</span>}
        <span className="text-muted-foreground text-caption leading-4">{formatRelative(item.sentAt)}</span>
      </span>
      {item.unread && <span aria-label="Unread" className="bg-foreground mt-2 size-1.5 shrink-0 rounded-full" />}
    </>
  );
  return (
    <li>
      {item.url ? (
        <Link href={item.url} onClick={onNavigate} className={ROW_CLASS}>
          {body}
        </Link>
      ) : (
        <div className={ROW_CLASS}>{body}</div>
      )}
    </li>
  );
}
