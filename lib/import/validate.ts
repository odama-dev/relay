import type { ContractType, EmploymentType, ProjectStatus, RolloverMode, UserRole } from "@prisma/client";
import { EMPLOYMENT_TYPES, USER_ROLES } from "@/lib/roles";
import { CONTRACT_TYPES, CURRENCIES, PROJECT_STATUSES, ROLLOVER_MODES } from "@/lib/validation";
import { isIsoDate } from "@/lib/time/pure";
import type { CsvRecord } from "./csv";

/**
 * Row validation for the one-off import (PRD "Import CSV"). Pure: the server
 * passes in what already exists, so the preview and the import agree.
 */

export type ImportMode = "skip" | "update";
export type RowAction = "create" | "update" | "skip" | "error";
export type ValidatedRow<T> = { line: number; key: string; action: RowAction; errors: string[]; data?: T };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMBER = /^\d+(\.\d+)?$/; // dot decimal, no thousands separator

function decide<T>(line: number, key: string, errors: string[], data: T, exists: boolean, mode: ImportMode): ValidatedRow<T> {
  if (errors.length) return { line, key, action: "error", errors };
  return { line, key, action: exists ? (mode === "update" ? "update" : "skip") : "create", errors, data };
}

function checkTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// --- users.csv -------------------------------------------------------------

export type UserImport = { fullName: string; email: string; role: UserRole; employmentType: EmploymentType; isAdmin: boolean };

export function validateUsers(records: CsvRecord[], ctx: { existingEmails: Set<string> }, mode: ImportMode): ValidatedRow<UserImport>[] {
  const seen = new Set<string>();
  return records.map(({ line, values: v }) => {
    const errors: string[] = [];
    const email = v.email.toLowerCase();
    if (!v.full_name) errors.push("full_name is required");
    if (!EMAIL.test(email)) errors.push("email is not valid");
    else if (seen.has(email)) errors.push("email appears twice in the file");
    seen.add(email);
    if (!USER_ROLES.includes(v.role as UserRole)) errors.push(`role must be one of ${USER_ROLES.join(", ")}`);
    if (!EMPLOYMENT_TYPES.includes(v.employment_type as EmploymentType)) errors.push(`employment_type must be one of ${EMPLOYMENT_TYPES.join(", ")}`);
    const admin = (v.is_admin || "false").toLowerCase();
    if (admin !== "true" && admin !== "false") errors.push("is_admin must be true or false");
    return decide(
      line,
      email,
      errors,
      { fullName: v.full_name, email, role: v.role as UserRole, employmentType: v.employment_type as EmploymentType, isAdmin: admin === "true" },
      ctx.existingEmails.has(email),
      mode,
    );
  });
}

// --- clients.csv -----------------------------------------------------------

export type ClientImport = {
  code: string;
  name: string;
  country: string | null;
  timezone: string | null;
  defaultCurrency: string;
  billingEmail: string | null;
  billingAddress: string | null;
  notes: string | null;
  contact: { name: string; email: string | null; title: string | null } | null;
};

export function validateClients(
  records: CsvRecord[],
  ctx: {
    /** Matched by name (PRD). */
    byName: Map<string, { code: string; hasProjects: boolean }>;
    /** Code → client name, to catch a code taken by another client. */
    codes: Map<string, string>;
  },
  mode: ImportMode,
): ValidatedRow<ClientImport>[] {
  const seenNames = new Set<string>();
  const seenCodes = new Set<string>();
  return records.map(({ line, values: v }) => {
    const errors: string[] = [];
    const code = v.code.toUpperCase();
    const existing = ctx.byName.get(v.name);
    if (!/^[A-Z]{2,6}$/.test(code) || code === "INT") errors.push("code must be 2–6 capital letters (not INT)");
    else if (seenCodes.has(code)) errors.push("code appears twice in the file");
    else {
      const owner = ctx.codes.get(code);
      if (owner && owner !== v.name) errors.push(`code ${code} already belongs to ${owner}`);
    }
    seenCodes.add(code);
    if (!v.name) errors.push("name is required");
    else if (seenNames.has(v.name)) errors.push("name appears twice in the file");
    seenNames.add(v.name);
    if (existing && mode === "update" && existing.code !== code && existing.hasProjects) {
      errors.push("the code can't change: the client already has projects");
    }
    if (!CURRENCIES.includes(v.default_currency as (typeof CURRENCIES)[number])) errors.push(`default_currency must be one of ${CURRENCIES.join(", ")}`);
    if (v.timezone && !checkTimeZone(v.timezone)) errors.push("timezone is not a valid IANA zone");
    if (v.billing_email && !EMAIL.test(v.billing_email)) errors.push("billing_email is not valid");
    if (v.contact_email && !EMAIL.test(v.contact_email)) errors.push("contact_email is not valid");
    if (!v.contact_name && (v.contact_email || v.contact_title)) errors.push("contact_name is required with contact details");
    return decide(
      line,
      v.name,
      errors,
      {
        code,
        name: v.name,
        country: v.country || null,
        timezone: v.timezone || null,
        defaultCurrency: v.default_currency,
        billingEmail: v.billing_email.toLowerCase() || null,
        billingAddress: v.billing_address || null,
        notes: v.notes || null,
        contact: v.contact_name ? { name: v.contact_name, email: v.contact_email.toLowerCase() || null, title: v.contact_title || null } : null,
      },
      Boolean(existing),
      mode,
    );
  });
}

// --- projects.csv ----------------------------------------------------------

export type ProjectImport = {
  name: string;
  kind: "client" | "internal";
  clientId: string | null;
  contractType: ContractType | null;
  currency: string;
  contractValue: number | null;
  pmId: string;
  status: ProjectStatus;
  startDate: string;
  endDate: string | null;
  budgetHours: number | null;
  retainerHoursPerMonth: number | null;
  rolloverMode: RolloverMode;
  rolloverCapHours: number | null;
  memberIds: string[];
  links: { notion?: string; figma?: string; drive?: string; slack_channel?: string };
};

export function validateProjects(
  records: CsvRecord[],
  ctx: {
    clients: Map<string, { id: string; defaultCurrency: string }>;
    people: Map<string, { id: string; role: UserRole; deactivated: boolean }>;
    /** `${clientId ?? "internal"}:${name}` of projects that exist. */
    existing: Set<string>;
  },
  mode: ImportMode,
): ValidatedRow<ProjectImport>[] {
  const seen = new Set<string>();
  return records.map(({ line, values: v }) => {
    const errors: string[] = [];
    const kind = v.kind as "client" | "internal";
    if (!v.name) errors.push("name is required");
    if (kind !== "client" && kind !== "internal") errors.push("kind must be client or internal");

    const client = kind === "client" ? ctx.clients.get(v.client_name) : undefined;
    if (kind === "client") {
      if (!v.client_name) errors.push("client_name is required for client projects");
      else if (!client) errors.push(`client "${v.client_name}" not found — import clients first`);
      if (!CONTRACT_TYPES.includes(v.contract_type as ContractType)) errors.push(`contract_type must be one of ${CONTRACT_TYPES.join(", ")}`);
    }
    const currency = v.currency || client?.defaultCurrency || "IDR";
    if (!CURRENCIES.includes(currency as (typeof CURRENCIES)[number])) errors.push(`currency must be one of ${CURRENCIES.join(", ")}`);

    const num = (field: string, value: string): number | null => {
      if (!value) return null;
      if (!NUMBER.test(value)) {
        errors.push(`${field} must be a number like 15000.50`);
        return null;
      }
      return Number(value);
    };
    const contractValue = num("contract_value", v.contract_value);
    const budgetHours = num("budget_hours", v.budget_hours);
    const retainerHours = num("retainer_hours_per_month", v.retainer_hours_per_month);
    const capHours = num("rollover_cap_hours", v.rollover_cap_hours);

    const pm = ctx.people.get(v.pm_email.toLowerCase());
    if (!v.pm_email) errors.push("pm_email is required");
    else if (!pm) errors.push(`PM ${v.pm_email} not found — import users first`);
    else if (pm.deactivated) errors.push(`PM ${v.pm_email} is deactivated`);
    else if (pm.role !== "pm" && pm.role !== "c_level") errors.push(`${v.pm_email} isn't a PM or C-Level`);

    const status = (v.status || "active") as ProjectStatus;
    if (!PROJECT_STATUSES.includes(status)) errors.push(`status must be one of ${PROJECT_STATUSES.join(", ")}`);
    if (!isIsoDate(v.start_date)) errors.push("start_date must be YYYY-MM-DD");
    if (v.end_date && !isIsoDate(v.end_date)) errors.push("end_date must be YYYY-MM-DD");
    else if (v.end_date && isIsoDate(v.start_date) && v.end_date < v.start_date) errors.push("end_date is before start_date");

    const rollover = (v.rollover_mode || "none") as RolloverMode;
    const retainer = kind === "client" && v.contract_type === "retainer";
    if (!ROLLOVER_MODES.includes(rollover)) errors.push(`rollover_mode must be one of ${ROLLOVER_MODES.join(", ")}`);
    if (retainer && !retainerHours) errors.push("retainer_hours_per_month is required for retainers");
    if (retainer && rollover === "capped" && !capHours) errors.push("rollover_cap_hours is required when rollover_mode is capped");

    const memberIds: string[] = [];
    for (const email of v.member_emails.split(";").map((e) => e.trim().toLowerCase()).filter(Boolean)) {
      const person = ctx.people.get(email);
      if (!person) errors.push(`member ${email} not found`);
      else if (person.deactivated) errors.push(`member ${email} is deactivated`);
      else memberIds.push(person.id);
    }

    for (const field of ["notion_url", "figma_url", "drive_url"] as const) {
      if (v[field] && !/^https?:\/\//.test(v[field])) errors.push(`${field} must start with http(s)://`);
    }

    const key = `${client?.id ?? "internal"}:${v.name}`;
    if (seen.has(key)) errors.push("this project appears twice in the file");
    seen.add(key);

    return decide(
      line,
      key,
      errors,
      {
        name: v.name,
        kind,
        clientId: client?.id ?? null,
        contractType: kind === "client" ? (v.contract_type as ContractType) : null,
        currency,
        contractValue,
        pmId: pm?.id ?? "",
        status,
        startDate: v.start_date,
        endDate: v.end_date || null,
        budgetHours: retainer ? null : budgetHours,
        retainerHoursPerMonth: retainer ? retainerHours : null,
        rolloverMode: retainer ? rollover : "none",
        rolloverCapHours: retainer && rollover === "capped" ? capHours : null,
        memberIds,
        links: {
          notion: v.notion_url || undefined,
          figma: v.figma_url || undefined,
          drive: v.drive_url || undefined,
          slack_channel: v.slack_channel || undefined,
        },
      },
      ctx.existing.has(key),
      mode,
    );
  });
}
