"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states";
import { retrySlackLink } from "../people/actions";
import { relinkSlack, sendSlackTest } from "./actions";

/** M0.6 — people not yet matched to Slack by email, with retries and a test DM. */
export function SlackPanel({
  configured,
  unlinked,
  linkedCount,
}: {
  configured: boolean;
  unlinked: { id: string; fullName: string; email: string }[];
  linkedCount: number;
}) {
  const router = useRouter();

  if (!configured) {
    return (
      <EmptyState
        icon="chat"
        title="Slack isn't connected"
        description="Create the Odama Slack app with a bot (users:read, users:read.email, chat:write, im:write) and set SLACK_BOT_TOKEN. Until then, notifications only appear in the in-app inbox."
      />
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body">
          <span className="tabular">{linkedCount}</span> linked · <span className="tabular">{unlinked.length}</span> not linked
        </p>
        <div className="flex gap-2">
          <Button
            variant="tertiary"
            size="sm"
            onClick={async () => {
              const res = await relinkSlack();
              if (!res.ok) return void toast.error(res.error);
              toast.success(`Linked ${res.data.linked}; ${res.data.missing} still without a Slack account`);
              router.refresh();
            }}
          >
            Retry all
          </Button>
          <Button
            variant="tertiary"
            size="sm"
            disabled={linkedCount === 0}
            onClick={async () => {
              const res = await sendSlackTest();
              if (!res.ok) return void toast.error(res.error);
              toast.success(`Test DM sent to ${res.data.sent} people${res.data.failed ? `, ${res.data.failed} failed` : ""}`);
            }}
          >
            Send test DM to everyone
          </Button>
        </div>
      </div>
      {unlinked.length === 0 ? (
        <p className="text-muted-foreground text-body">Everyone active is linked to Slack.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-black/4 dark:divide-white/5">
          {unlinked.map((p) => (
            <li key={p.id} className="flex h-11 items-center gap-3 rounded-lg px-3 text-body">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{p.fullName}</span>
                <span className="text-muted-foreground truncate text-caption">{p.email}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const res = await retrySlackLink(p.id);
                  if (!res.ok) return void toast.error(res.error);
                  toast.success(`${p.fullName} linked`);
                  router.refresh();
                }}
              >
                Retry
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
