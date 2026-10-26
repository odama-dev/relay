import type { IconName } from "@/components/icon";
import { perms, type Viewer } from "@/lib/roles";

export type NavItem = {
  label: string;
  href: string;
  icon: IconName;
  /** Who sees the item. Undefined = everyone. */
  visible?: (viewer: Viewer) => boolean;
  /** Exact match only. */
  exact?: boolean;
};

export type NavGroup = {
  label?: string;
  /** Not open yet, for everyone: a "Coming soon" badge beside the label and
   *  disabled rows. Each route also renders ComingSoon from its layout.tsx. */
  comingSoon?: boolean;
  items: NavItem[];
};

/** Main navigation (PRD M0.7): Dashboard, My Tasks, Projects, Timesheet, Invoices, People, Settings; plus Expenses (Finance, C-Level) and Business Data (C-Level dashboard inputs). */
export const navGroups: NavGroup[] = [
  {
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
      { label: "My Tasks", href: "/my-tasks", icon: "myTasks", visible: perms.viewTasks },
      { label: "Timesheet", href: "/timesheet", icon: "timesheet" },
    ],
  },
  {
    label: "Work",
    items: [
      { label: "Projects", href: "/projects", icon: "projects", visible: (v) => v.role !== "sales" },
      { label: "Clients", href: "/clients", icon: "clients", visible: perms.viewClients },
      { label: "Mail", href: "/mail", icon: "mail" },
      { label: "Project Health", href: "/health", icon: "health", visible: perms.viewHealthOverview },
      { label: "Approvals", href: "/approvals", icon: "approvals", visible: perms.reviewApprovals },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "Pipeline", href: "/sales", icon: "trend", visible: perms.viewPipeline, exact: true },
      { label: "Companies", href: "/sales/companies", icon: "clients", visible: perms.viewPipeline },
      { label: "People", href: "/sales/people", icon: "user", visible: perms.viewPipeline },
      { label: "Sales Report", href: "/sales/report", icon: "bar", visible: perms.viewPipeline },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Finance Overview", href: "/finance", icon: "finance", visible: perms.viewFinanceOverview },
      { label: "Invoices", href: "/invoices", icon: "invoices", visible: perms.viewInvoices },
      { label: "Payments", href: "/payments", icon: "payments", visible: perms.viewPayments },
      { label: "Expenses", href: "/expenses", icon: "wallet", visible: perms.manageExpenses },
    ],
  },
  {
    label: "Performance",
    comingSoon: true,
    items: [
      { label: "KPI", href: "/kpi", icon: "target" },
      { label: "OKR", href: "/okr", icon: "flag" },
      { label: "Work Log", href: "/work-log", icon: "checklist" },
      { label: "Ratings", href: "/ratings", icon: "star" },
      { label: "KPI & OKR Builder", href: "/performance", icon: "intelligence", visible: perms.managePeopleModule },
    ],
  },
  {
    label: "Team",
    items: [
      { label: "People", href: "/people", icon: "people", exact: true },
      { label: "Time Compliance", href: "/people/compliance", icon: "time", visible: perms.viewCompliance },
      { label: "People Setup", href: "/people/setup", icon: "checklist", visible: perms.managePeopleModule },
      { label: "Business Data", href: "/business", icon: "target", visible: perms.viewBusinessData },
      { label: "Metric Dictionary", href: "/metrics", icon: "info" },
    ],
  },
];

/** Pinned to the sidebar footer, above the account block. */
export const footerItems: NavItem[] = [
  { label: "Settings", href: "/settings", icon: "settings", visible: perms.manageSettings },
];

export function visibleItems(items: NavItem[], viewer: Viewer): NavItem[] {
  return items.filter((i) => !i.visible || i.visible(viewer));
}

export function visibleGroups(viewer: Viewer): NavGroup[] {
  return navGroups
    .map((g) => ({ ...g, items: visibleItems(g.items, viewer) }))
    .filter((g) => g.items.length > 0);
}

/** Where "/" lands: the role's dashboard (PRD/OVERVIEW-SPEC.md §1.1). */
export function homePath(): string {
  return "/dashboard";
}
