import type { AccessLevel, AppModule, Division, UserRole } from "@prisma/client";

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

// Phase 2 dimensions (PRD/PRD_Fase-2.md "Role & akses"). The role above
// stays as the dashboard preset; modules and the reporting line decide the
// Phase 2 screens.
export const DIVISIONS = ["design", "development", "project", "sales", "people", "finance", "executive"] as const;
export const ACCESS_LEVELS = ["manager", "member"] as const;
export const APP_MODULES = ["people", "finance", "sales", "studio_report"] as const;
export const LEVELS = [1, 2, 3, 4, 5] as const;

const DIVISION_LABELS: Record<Division, string> = {
  design: "Design",
  development: "Development",
  project: "Project",
  sales: "Sales",
  people: "People",
  finance: "Finance",
  executive: "Executive",
};
export const divisionLabel = (d: Division) => DIVISION_LABELS[d];

/** Divisions whose hours count toward utilization (Metric Dictionary). */
export const BILLABLE_DIVISIONS: readonly Division[] = ["design", "development", "project"];

const ACCESS_LABELS: Record<AccessLevel, string> = { manager: "Manager", member: "Member" };
export const accessLabel = (a: AccessLevel) => ACCESS_LABELS[a];

const MODULE_LABELS: Record<AppModule, string> = {
  people: "People",
  finance: "Finance",
  sales: "Sales",
  studio_report: "Studio Report",
};
export const moduleLabel = (m: AppModule) => MODULE_LABELS[m];

const MODULE_HINTS: Record<AppModule, string> = {
  people: "Attendance, leave, and KPI & OKR management.",
  finance: "Invoices, payment verification, expenses, receivables.",
  sales: "Pipeline, deals and invoices.",
  studio_report: "Studio finances and everyone's KPIs.",
};
export const moduleHint = (m: AppModule) => MODULE_HINTS[m];

const LEVEL_LABELS: Record<number, string> = {
  1: "1 · Junior Staff",
  2: "2 · Senior Staff",
  3: "3 · Specialist",
  4: "4 · Expert",
  5: "5 · Lead / Director",
};
export const levelLabel = (l: number) => LEVEL_LABELS[l] ?? String(l);

/** The subset of the signed-in user the permission hints need. */
export type Viewer = {
  id: string;
  role: UserRole;
  isAdmin: boolean;
  accessLevel: AccessLevel;
  modules: readonly AppModule[];
};

const is = (viewer: Viewer, ...roles: UserRole[]) => roles.includes(viewer.role);
/** Admins hold every module (RLS: app.has_module). */
export const hasModule = (viewer: Viewer, ...mods: AppModule[]) =>
  viewer.isAdmin || mods.some((m) => viewer.modules.includes(m));

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
  /** Health in the UI — Sales works the pipeline and doesn't see delivery health. */
  showHealth: (v: Viewer) => !is(v, "sales", "hr"),

  // Tasks (M2)
  /** Everyone keeps their own tasks (My Tasks) on projects they're on. */
  viewTasks: (v: Viewer) => is(v, "designer_dev", "pm", "sales", "c_level", "finance", "hr"),
  /** On the project board; Sales adds from My Tasks, into the project's "Sales" section. */
  createTasks: (v: Viewer) => is(v, "designer_dev", "pm", "c_level", "finance", "hr"),
  /** A task for yourself on any open project you find by search (you join it). */
  createOwnTasks: (v: Viewer) => is(v, "designer_dev", "pm", "sales", "c_level", "finance", "hr"),

  // Time (M3/M4)
  /** Everyone logs time except C-Level, for whom it is optional (M3). */
  mustLogTime: (v: Pick<Viewer, "role">) => v.role !== "c_level",
  viewCompliance: (v: Viewer) => is(v, "hr", "c_level") || v.isAdmin,
  viewHealthOverview: (v: Viewer) => is(v, "pm", "c_level"),
  reviewApprovals: (v: Viewer) => is(v, "pm", "hr", "c_level"),

  // Invoices (M5)
  viewInvoices: (v: Viewer) => is(v, "sales", "finance", "c_level", "pm") || hasModule(v, "sales", "finance", "studio_report"),
  editInvoices: (v: Viewer) => is(v, "sales", "finance"),
  viewPayments: (v: Viewer) => is(v, "finance", "sales", "c_level") || hasModule(v, "sales", "finance", "studio_report"),
  viewFinanceOverview: (v: Viewer) => is(v, "finance", "sales", "c_level"),
  matchPayments: (v: Viewer) => is(v, "finance"),

  // Expenses — Finance and C-Level read and record (RLS: expenses_*).
  manageExpenses: (v: Viewer) => is(v, "finance", "c_level"),

  // C-Level dashboard inputs (PRD/Clevel dashboard.md §7) — same rules as the RLS policies.
  viewBusinessData: (v: Viewer) => is(v, "hr", "c_level", "pm", "finance") || v.isAdmin,
  manageCosts: (v: Viewer) => is(v, "hr", "c_level"),
  viewCapacity: (v: Viewer) => is(v, "hr", "c_level", "pm") || v.isAdmin,
  manageCapacity: (v: Viewer) => is(v, "hr") || v.isAdmin,
  /** The HR calendar is HR's alone (RLS: hr_events). */
  manageHrCalendar: (v: Viewer) => is(v, "hr"),
  /** Decide leave requests (RLS: leave_requests guard) — never your own. */
  decideLeave: (v: Viewer) => is(v, "hr") || v.isAdmin,
  viewUtilizationTargets: (v: Viewer) => is(v, "hr", "c_level") || v.isAdmin,
  manageUtilizationTargets: (v: Viewer) => is(v, "hr") || v.isAdmin,
  manageRevenueTargets: (v: Viewer) => is(v, "c_level"),
  manageFxRates: (v: Viewer) => is(v, "finance", "c_level"),
  manageDashboardRules: (v: Viewer) => is(v, "c_level") || v.isAdmin,

  // Phase 2 — modules (RLS: app.has_module) and access.
  /** Job role, division, level, title, manager; job roles, task types, holidays. */
  managePeopleModule: (v: Viewer) => hasModule(v, "people"),
  /** Access level and module grants. */
  manageAccess: (v: Viewer) => v.isAdmin,
  viewStudioReport: (v: Viewer) => hasModule(v, "studio_report"),
  /** Pipeline and Sales report (RLS: deals_select). */
  viewPipeline: (v: Viewer) => hasModule(v, "sales", "studio_report"),
  /** Deals and stages (RLS: deals_write, pipeline_stages_write). */
  manageDeals: (v: Viewer) => hasModule(v, "sales"),
  isManager: (v: Viewer) => v.accessLevel === "manager" || v.isAdmin,
} as const;
