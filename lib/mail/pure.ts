/**
 * Mailbox math with no I/O (unit-tested): addresses, snippets, linking an
 * email to the CRM, and the IMAP UID window to fetch next.
 */

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** "acme.co" from "Rina <rina@Acme.co>" or "rina@acme.co"; null when there's no domain. */
export function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email
    .slice(at + 1)
    .replace(/[>\s].*$/, "")
    .toLowerCase();
  return domain.includes(".") ? domain : null;
}

/** Webmail and ISP domains never identify a company. */
const PUBLIC_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.id",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "gmx.com",
  "zoho.com",
]);

/** A company domain stored as "https://www.acme.co/" compares as "acme.co". */
export function cleanDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const d = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return d.includes(".") ? d : null;
}

/** A short, single-line preview of a message body (quoted replies and signatures dropped). */
export function snippetOf(text: string | null | undefined, max = 180): string {
  if (!text) return "";
  const lines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^On .+wrote:$/.test(line.trim()) || line.trim() === "--") break;
    if (line.trim().startsWith(">")) continue;
    lines.push(line.trim());
  }
  const flat = lines.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export type CrmPersonRef = {
  id: string;
  email: string | null;
  companyId: string | null;
};
export type CrmCompanyRef = { id: string; domain: string | null };

/**
 * Links an email to the CRM by its other party: inbound mail by the sender,
 * outbound by the recipients. A person with that address wins (and brings
 * their company); otherwise a company whose domain matches — never a
 * webmail domain, and never the mailbox's own domain.
 */
export function linkToCrm(
  counterparts: string[],
  ownDomain: string | null,
  people: CrmPersonRef[],
  companies: CrmCompanyRef[],
): { personId: string | null; companyId: string | null } {
  const emails = counterparts.map(normalizeEmail);
  const person = people.find((p) => p.email && emails.includes(normalizeEmail(p.email)));
  if (person) return { personId: person.id, companyId: person.companyId };
  const domains = emails.map(domainOf).filter((d): d is string => d !== null && d !== ownDomain && !PUBLIC_DOMAINS.has(d));
  const company = companies.find((c) => {
    const d = cleanDomain(c.domain);
    return d !== null && domains.includes(d);
  });
  return { personId: null, companyId: company?.id ?? null };
}

export type FolderState = { uid: number; validity: string };

/**
 * Which UIDs to fetch from a folder: everything after the last one seen, or —
 * on the first sync and after the server reset the folder's UIDVALIDITY — a
 * fresh start from a date window (`since`).
 */
export function nextWindow(state: FolderState | undefined, validity: string): { from: number } | { since: true } {
  if (!state || state.validity !== validity) return { since: true };
  return { from: state.uid + 1 };
}

/** Common hosts for a domain's mailbox — a starting point the user can change. */
export function suggestServers(email: string): {
  imapHost: string;
  smtpHost: string;
} {
  const domain = domainOf(email) ?? "";
  return {
    imapHost: domain ? `imap.${domain}` : "",
    smtpHost: domain ? `smtp.${domain}` : "",
  };
}
