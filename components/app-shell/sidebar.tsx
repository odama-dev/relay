"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import type { Inbox } from "@/lib/notifications/queries";
import type { ShellUser } from "./app-shell";
import { roleLabel } from "@/lib/roles";
import { signOut } from "@/app/(auth)/actions";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { DropdownLabel, DropdownSeparator } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { SidebarWorkspaceHeader } from "@/components/sidebar-app/workspace-header";
import { SidebarUserFooter } from "@/components/sidebar-app/user-footer";
import { SidebarInsetTopbar } from "@/components/sidebar-app/inset-topbar";
import { MemberAvatar } from "@/components/member-avatar";
import { Icon, icons } from "@/components/icon";
import { useShape } from "@/lib/shape-context";
import { MetalBadge } from "@/components/metal-badge";
import { cn } from "@/lib/utils";
import { GlobalSearch } from "./global-search";
import { NotificationBell } from "./notification-bell";
import { footerItems, navGroups, visibleGroups, visibleItems, type NavItem } from "./nav-config";

const isUnder = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

const THEMES = [
  { value: "light", label: "Light", icon: icons.light },
  { value: "dark", label: "Dark", icon: icons.dark },
  { value: "system", label: "System", icon: icons.system },
] as const;

/** One nav row: a Fluid sidebar menu button rendered as a Next link; a coming-soon row is a disabled button. */
function NavLink({ item, disabled = false }: { item: NavItem; disabled?: boolean }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const active = item.exact ? pathname === item.href : isUnder(pathname, item.href);
  if (disabled) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton icon={icons[item.icon]} disabled>
          {item.label}
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        icon={icons[item.icon]}
        render={<Link href={item.href} aria-current={active ? "page" : undefined} onClick={() => isMobile && setOpenMobile(false)} />}
      >
        {item.label}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function UserMenu({ user }: { user: ShellUser }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  return (
    <SidebarUserFooter
      name={user.fullName}
      avatar={<MemberAvatar seed={user.id} src={user.avatarUrl} size={20} radius={10} />}
      menu={
        <>
          <DropdownLabel className="flex flex-col gap-0.5">
            <span className="truncate text-foreground">{user.email}</span>
            <span>
              {roleLabel(user.role)}
              {user.isAdmin && " · Admin"}
            </span>
          </DropdownLabel>
          <DropdownSeparator />
          <MenuItem index={0} icon={icons.user} label="Profile & notifications" onSelect={() => router.push("/profile")} />
          <MenuItem index={1} icon={icons.lock} label="Change password" onSelect={() => router.push("/set-password")} />
          <DropdownSeparator />
          <DropdownLabel>Theme</DropdownLabel>
          {THEMES.map((t, i) => (
            <MenuItem
              key={t.value}
              index={2 + i}
              icon={t.icon}
              label={t.label}
              checked={theme === t.value}
              closeOnClick={false}
              onSelect={() => setTheme(t.value)}
            />
          ))}
          <DropdownSeparator />
          <MenuItem index={5} icon={icons.logout} label="Sign out" onSelect={() => void signOut()} />
        </>
      }
    />
  );
}

/** The sidebar's search: a white field-styled button that opens ⌘K. */
function SearchButton({ onSearch }: { onSearch: () => void }) {
  const shape = useShape();
  return (
    <button
      type="button"
      onClick={onSearch}
      className={cn(
        "group flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 text-left outline-none",
        "bg-field shadow-field ring-1 ring-border transition-colors duration-80",
        "hover:bg-[color-mix(in_oklab,var(--field),var(--foreground)_3%)]",
        "focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
        shape.input,
      )}
    >
      <Icon name="search" size={16} className="text-muted-foreground group-hover:text-foreground shrink-0 transition-colors duration-80" />
      <span className="text-muted-foreground min-w-0 flex-1 truncate text-body">Search</span>
      <span className="flex shrink-0 gap-0.5" aria-hidden>
        {["⌘", "K"].map((k) => (
          <kbd
            key={k}
            className="text-muted-foreground grid h-[18px] min-w-[18px] place-items-center rounded-[5px] px-1 font-sans text-[length:var(--fs-micro,11px)] ring-1 ring-border"
          >
            {k}
          </kbd>
        ))}
      </span>
    </button>
  );
}

function AppSidebar({ user, inbox, onSearch }: { user: ShellUser; inbox: Inbox; onSearch: () => void }) {
  const groups = visibleGroups(user);
  const footer = visibleItems(footerItems, user);
  return (
    <Sidebar variant="sidebar" className="bg-sidebar">
      {/* Brand row shares the topbar's 48px height and hairline, so the two
          read as one header strip across the shell. */}
      <SidebarHeader className="gap-0 p-0">
        <div className="border-sidebar-border flex h-12 shrink-0 items-center gap-1 border-b px-2">
          <div className="min-w-0 flex-1">
            <SidebarWorkspaceHeader
              name="Odama OS"
              tile={
                <span className="relative block size-5 overflow-hidden rounded-[5px]">
                  <Image src="/odama-mark.png" alt="" fill sizes="20px" />
                </span>
              }
            />
          </div>
          <SidebarTrigger size="icon-compact" className="shrink-0" />
        </div>
        <div className="flex items-center gap-1.5 px-2 pt-2.5">
          <SearchButton onSearch={onSearch} />
          <NotificationBell initialInbox={inbox} />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group, i) => (
          <SidebarGroup key={group.label ?? i}>
            {group.label && (
              <SidebarGroupLabel className={cn(group.comingSoon && "justify-between")}>
                {group.label}
                {group.comingSoon && <MetalBadge>Coming soon</MetalBadge>}
              </SidebarGroupLabel>
            )}
            <SidebarMenu aria-label={group.label ?? "Primary"}>
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} disabled={group.comingSoon} />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-sidebar-border border-t">
        {footer.length > 0 && (
          <SidebarMenu aria-label="Admin">
            {footer.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </SidebarMenu>
        )}
        <UserMenu user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}

/** Screens outside the nav that still get a crumb. */
const EXTRA_CRUMBS: NavItem[] = [
  { label: "Profile", href: "/profile", icon: "user" },
  { label: "Settings", href: "/settings", icon: "settings" },
];

/** The nav entry the current path lives under (longest match wins). */
function useCurrentSection(): NavItem | undefined {
  const pathname = usePathname();
  const all = [...navGroups.flatMap((g) => g.items), ...EXTRA_CRUMBS];
  return all
    .filter((item) => (item.exact ? pathname === item.href : isUnder(pathname, item.href)))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/** Content topbar: the section crumb on a hairline, like every page header strip. */
function AppTopbar() {
  const { open, isMobile } = useSidebar();
  const section = useCurrentSection();
  const showTrigger = isMobile || !open;
  return (
    <SidebarInsetTopbar className="bg-background sticky top-0 z-20 border-b px-3 md:px-4" showTrigger={showTrigger}>
      {section && (
        <Link
          href={section.href}
          className="hover:bg-hover flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 transition-colors duration-80"
        >
          <Icon name={section.icon} size={16} className="text-muted-foreground shrink-0" />
          <span className="truncate text-body font-medium">{section.label}</span>
        </Link>
      )}
    </SidebarInsetTopbar>
  );
}

/**
 * The signed-in frame: a flat grey Fluid sidebar (collapses off-canvas with
 * "[" or the trigger; hovering the collapsed trigger only shows its tooltip,
 * no peek; a drawer below md) beside a square white
 * content area. Search and the inbox sit together at the top of the rail.
 */
export function AppFrame({
  user,
  inbox,
  defaultOpen,
  children,
}: {
  user: ShellUser;
  inbox: Inbox;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    <SidebarProvider defaultOpen={defaultOpen} peek="none" className="min-h-dvh">
      <AppSidebar user={user} inbox={inbox} onSearch={() => setSearchOpen(true)} />
      <SidebarInset>
        <AppTopbar />
        {/* --page-gutter lets page-level rows (.bleed, list tables) run to
            the content edge while their text stays on the gutter. */}
        <div
          data-slot="page"
          className="flex min-w-0 flex-1 flex-col px-4 pb-10 [--page-gutter:1rem] md:px-6 md:[--page-gutter:1.5rem]"
        >
          {children}
        </div>
      </SidebarInset>
      <GlobalSearch viewer={user} open={searchOpen} onOpenChange={setSearchOpen} />
    </SidebarProvider>
  );
}
