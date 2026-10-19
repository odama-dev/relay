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
      { label: "Projects", href: "/projects", icon: "projects" },
      { label: "Clients", href: "/clients", icon: "clients", visible: perms.viewClients },
      { label: "Project Health", href: "/health", icon: "health", visible: perms.viewHealthOverview },
      { label: "Approvals", href: "/approvals", icon: "approvals", visible: perms.reviewApprovals },
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
    label: "Team",
    items: [
      { label: "People", href: "/people", icon: "people", exact: true },
      { label: "Time Compliance", href: "/people/compliance", icon: "time", visible: perms.viewCompliance },
      { label: "Business Data", href: "/business", icon: "target", visible: perms.viewBusinessData },
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
