import "server-only";
import { env, slackConfigured } from "@/lib/env";

/**
 * Minimal Slack Web API client for the Odama bot (M0.6). The bot needs the
 * `users:read`, `users:read.email`, `chat:write` and `im:write` scopes.
 */
async function slackApi<T extends { ok: boolean; error?: string }>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.slackBotToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: `http_${res.status}` } as T;
  return (await res.json()) as T;
}

/** Slack user id for a work email, or null when no Slack account matches. */
export async function lookupSlackUserId(email: string): Promise<{ id: string | null; error?: string }> {
  if (!slackConfigured) return { id: null, error: "slack_not_configured" };
  // users.lookupByEmail is a GET-style method; it accepts form params only.
  const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${env.slackBotToken}` },
  });
  const body = (await res.json().catch(() => ({ ok: false, error: "bad_response" }))) as {
    ok: boolean;
    error?: string;
    user?: { id: string };
  };
  if (!body.ok) return { id: null, error: body.error };
  return { id: body.user?.id ?? null };
}

export type SlackBlock = Record<string, unknown>;

/** Direct message from the bot. Posting to a user id opens the DM. */
export async function sendSlackDm(
  slackUserId: string,
  text: string,
  blocks?: SlackBlock[],
): Promise<{ ok: boolean; error?: string }> {
  if (!slackConfigured) return { ok: false, error: "slack_not_configured" };
  try {
    const res = await slackApi<{ ok: boolean; error?: string }>("chat.postMessage", {
      channel: slackUserId,
      text,
      blocks,
      unfurl_links: false,
    });
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "slack_unreachable" };
  }
}

/** Escapes text for Slack mrkdwn. */
export function slackEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
