import { cookies } from "next/headers";
import type { ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth";
import { getInbox } from "@/lib/notifications/queries";
import { SIDEBAR_COOKIE_NAME } from "@/components/ui/sidebar-core";
import { AppFrame } from "./sidebar";

/** What the client-side shell needs about the signed-in user. */
export type ShellUser = Pick<CurrentUser, "id" | "email" | "fullName" | "role" | "isAdmin" | "accessLevel" | "modules" | "avatarUrl">;

export async function AppShell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  const [inbox, cookieStore] = await Promise.all([getInbox(user), cookies()]);
  // Fluid's SidebarProvider persists its open state here, so the first paint
  // already has the right layout.
  const defaultOpen = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false";
  const shellUser: ShellUser = {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    isAdmin: user.isAdmin,
    accessLevel: user.accessLevel,
    modules: user.modules,
    avatarUrl: user.avatarUrl,
  };

  return (
    <AppFrame user={shellUser} inbox={inbox} defaultOpen={defaultOpen}>
      {children}
    </AppFrame>
  );
}
