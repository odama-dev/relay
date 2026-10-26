import { after } from "next/server";
import { requireUser } from "@/lib/auth";
import { myMailActivity, myMailboxes, type MailFilters } from "@/lib/mail/queries";
import { syncStale } from "@/lib/mail/client";
import { FilterBar } from "@/components/filter-bar";
import { MailPage } from "./mail-view";

export const metadata = { title: "Mail" };

/** Your connected mailboxes and their activity (sent and received). */
export default async function Mail({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const mailboxes = await myMailboxes(user);
  const filters: MailFilters = {
    accountId: mailboxes.some((m) => m.id === get("account")) ? get("account") : undefined,
    direction: get("direction") === "inbound" || get("direction") === "outbound" ? (get("direction") as MailFilters["direction"]) : undefined,
    q: get("q")?.trim() || undefined,
  };
  const messages = mailboxes.length ? await myMailActivity(user, filters) : [];

  // Vercel's cron runs once a day, so opening Mail catches it up. Ownership is
  // proven: these rows came back under RLS.
  if (mailboxes.length) after(() => syncStale(mailboxes));

  return (
    <MailPage
      mailboxes={mailboxes}
      messages={messages}
      timeZone={user.timezone}
      filters={
        <FilterBar
          variant="bare"
          searchPlaceholder="Search subject, text or address"
          filters={[
            ...(mailboxes.length > 1
              ? [
                  {
                    param: "account",
                    label: "Mailbox",
                    allLabel: "All mailboxes",
                    options: mailboxes.map((m) => ({
                      value: m.id,
                      label: m.email,
                    })),
                  },
                ]
              : []),
            {
              param: "direction",
              label: "Direction",
              allLabel: "Sent & received",
              options: [
                { value: "inbound", label: "Received" },
                { value: "outbound", label: "Sent" },
              ],
            },
          ]}
        />
      }
    />
  );
}
