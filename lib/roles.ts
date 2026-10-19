import type { UserRole } from "@prisma/client";

/**
 * Role vocabulary and UI-side permission hints (PRD "Role & hak akses").
 *
 * These decide what the UI *offers* — which nav items, buttons and columns
 * appear. They are not the security boundary: the same rules are enforced by
 * the RLS policies in prisma/migrations/*_rls, and a server action that slips
 * past a hint is still refused by the database.
 */

export const USER_ROLES = ["c_level", "pm", "designer_dev", "sales", "finance", "hr"] as const;
export const EMPLOYMENT_TYPES = ["full_time", "contract", "freelancer"] as const;

const ROLE_LABELS: Record<UserRole, string> = {
  c_level: "C-Level",
  pm: "Project Manager",
  designer_dev: "Designer & Developer",
  sales: "Sales & Marketing",
  finance: "Finance",
  hr: "HR",
};

export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role];
}

const EMPLOYMENT_LABELS: Record<(typeof EMPLOYMENT_TYPES)[number], string> = {
  full_time: "Full-time",
  contract: "Contract",
  freelancer: "Freelancer",
};

export function employmentLabel(type: (typeof EMPLOYMENT_TYPES)[number]): string {
  return EMPLOYMENT_LABELS[type];
}

/** The subset of the signed-in user the permission hints need. */
export type Viewer = { id: string; role: UserRole; isAdmin: boolean };

const is = (viewer: Viewer, ...roles: UserRole[]) => roles.includes(viewer.role);

export const perms = {
  // People (M0)
  managePeople: (v: Viewer) => v.isAdmin || is(v, "hr"),
  grantAdmin: (v: Viewer) => v.isAdmin,
  manageSettings: (v: Viewer) => v.isAdmin,

  // Clients & projects (M1)
  viewClients: (v: Viewer) => is(v, "pm", "sales", "finance", "c_level", "designer_dev"),
  editClients: (v: Viewer) => is(v, "pm", "sales", "c_level"),
  createProjects: (v: Viewer) => is(v, "pm", "sales", "c_level"),
  /** Contract value: Sales / C-Level edit; Finance always reads; a PM reads on their projects. */
  viewContractValue: (v: Viewer, isMember: boolean) =>
    is(v, "sales", "finance", "c_level") || (is(v, "pm") && isMember),
  editContractValue: (v: Viewer) => is(v, "sales", "c_level"),
  /** Hour budget & health: everyone but HR (Designer & Dev on their projects). */
  viewBudget: (v: Viewer, isMember: boolean) =>
    is(v, "sales", "finance", "c_level") || (is(v, "pm", "designer_dev") && isMember),
  editBudget: (v: Viewer, isMember: boolean) => is(v, "c_level") || (is(v, "pm") && isMember),

  // Tasks (M2)
  viewTasks: (v: Viewer) => is(v, "designer_dev", "pm", "sales", "c_level"),
  createTasks: (v: Viewer) => is(v, "designer_dev", "pm", "c_level"),

  // Time (M3/M4)
  /** Everyone logs time except C-Level, for whom it is optional (M3). */
  mustLogTime: (v: Pick<Viewer, "role">) => v.role !== "c_level",
  viewCompliance: (v: Viewer) => is(v, "hr", "c_level") || v.isAdmin,
  viewHealthOverview: (v: Viewer) => is(v, "pm", "c_level"),
  reviewApprovals: (v: Viewer) => is(v, "pm", "hr", "c_level"),

  // Invoices (M5)
  viewInvoices: (v: Viewer) => is(v, "sales", "finance", "c_level", "pm"),
  editInvoices: (v: Viewer) => is(v, "sales", "finance"),
  viewPayments: (v: Viewer) => is(v, "finance", "sales", "c_level"),
  viewFinanceOverview: (v: Viewer) => is(v, "finance", "sales", "c_level"),
  matchPayments: (v: Viewer) => is(v, "finance"),

  // Expenses — Finance and C-Level read and record (RLS: expenses_*).
  manageExpenses: (v: Viewer) => is(v, "finance", "c_level"),

  // C-Level dashboard inputs (PRD/Clevel dashboard.md §7) — same rules as the RLS policies.
  viewBusinessData: (v: Viewer) => is(v, "hr", "c_level", "pm", "finance") || v.isAdmin,
  manageCosts: (v: Viewer) => is(v, "hr", "c_level"),
  viewCapacity: (v: Viewer) => is(v, "hr", "c_level", "pm") || v.isAdmin,
  manageCapacity: (v: Viewer) => is(v, "hr") || v.isAdmin,
  viewUtilizationTargets: (v: Viewer) => is(v, "hr", "c_level") || v.isAdmin,
  manageUtilizationTargets: (v: Viewer) => is(v, "hr") || v.isAdmin,
  manageRevenueTargets: (v: Viewer) => is(v, "c_level"),
  manageFxRates: (v: Viewer) => is(v, "finance", "c_level"),
  manageDashboardRules: (v: Viewer) => is(v, "c_level") || v.isAdmin,
} as const;
