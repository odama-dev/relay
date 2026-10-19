"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  CommandMenu,
  CommandMenuDialog,
  CommandMenuEmpty,
  CommandMenuFooter,
  CommandMenuInput,
  CommandMenuList,
  defaultCommandMenuFilter,
  type CommandMenuItemData,
} from "@/components/ui/command-menu";
import { icons, type IconName } from "@/components/icon";
import type { SearchGroup, SearchHit } from "@/lib/search";
import { perms, type Viewer } from "@/lib/roles";
import { CREATE_PARAM } from "@/lib/hooks/use-open-from-url";

const MIN_CHARS = 2; // lib/search.ts SEARCH_MIN_CHARS (server-only module)
const DEBOUNCE_MS = 200;
const ACTIONS_GROUP = "Actions";

const GROUP_ICON: Record<SearchGroup, IconName> = {
  Projects: "projects",
  Tasks: "myTasks",
  Clients: "clients",
  People: "people",
  Invoices: "invoices",
};

type PaletteAction = {
  label: string;
  icon: IconName;
  href: string;
  /** Hidden unless the role may do this (lib/roles.ts). */
  allowed: (viewer: Viewer) => boolean;
};

// Each create action opens the page with ?create=1, where the page's own
// Add button opens its form (lib/hooks/use-open-from-url.ts).
const create = (path: string) => `${path}${path.includes("?") ? "&" : "?"}${CREATE_PARAM}=1`;
const ACTIONS: PaletteAction[] = [
  { label: "Log time…", icon: "time", href: create("/timesheet"), allowed: () => true },
  { label: "Create project…", icon: "projects", href: create("/projects"), allowed: perms.createProjects },
  { label: "Create client…", icon: "clients", href: create("/clients"), allowed: perms.editClients },
  { label: "Create invoice…", icon: "invoices", href: "/invoices/new", allowed: perms.editInvoices },
  { label: "Invite person…", icon: "invite", href: create("/people"), allowed: perms.managePeople },
];

/** Actions match the typed words; record hits are already matched by the server. */
const filter = (item: CommandMenuItemData, query: string) =>
  item.group !== ACTIONS_GROUP || defaultCommandMenuFilter(item, query);

async function fetchHits(q: string): Promise<SearchHit[]> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error("Search failed");
  return ((await res.json()) as { hits: SearchHit[] }).hits;
}

/**
 * Command palette (⌘K / Ctrl+K, Fluid CommandMenu): quick actions, and a
 * search over every record the user can open — projects, tasks, clients,
 * people and invoices — via /api/search (lib/search.ts, under RLS).
 */
export function GlobalSearch({
  viewer,
  open,
  onOpenChange,
}: {
  viewer: Viewer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const searching = debounced.length >= MIN_CHARS;
  const {
    data: hits = [],
    isFetching,
    isError,
  } = useQuery({
    queryKey: ["global-search", debounced],
    queryFn: () => fetchHits(debounced),
    enabled: open && searching,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const changeOpen = (next: boolean) => {
    onOpenChange(next);
    if (!next) setQuery("");
  };

  const items = useMemo<CommandMenuItemData[]>(() => {
    const actions = ACTIONS.filter((a) => a.allowed(viewer)).map((a) => ({
      value: `action:${a.href}`,
      label: a.label,
      icon: icons[a.icon],
      group: ACTIONS_GROUP,
      onSelect: () => router.push(a.href),
    }));
    const records = searching
      ? hits.map((hit) => ({
          value: `${hit.group}:${hit.id}`,
          label: hit.title,
          description: hit.subtitle ?? undefined,
          icon: icons[GROUP_ICON[hit.group]],
          group: hit.group,
          action: "Open",
          onSelect: () => router.push(hit.href),
        }))
      : [];
    return [...actions, ...records];
  }, [viewer, searching, hits, router]);

  const pending = searching && (isFetching || query.trim() !== debounced);

  return (
    <CommandMenuDialog
      open={open}
      onOpenChange={changeOpen}
      title="Search"
      description="Search projects, tasks, clients, people and invoices"
    >
      <CommandMenu items={items} filter={filter} query={query} onQueryChange={setQuery}>
        <CommandMenuInput placeholder="Type a command or search…" />
        <CommandMenuList>
          <CommandMenuEmpty>
            {pending
              ? "Searching…"
              : isError
                ? "Search isn't available right now."
                : searching
                  ? `No results for "${query.trim()}".`
                  : `Type ${MIN_CHARS}+ characters to search records.`}
          </CommandMenuEmpty>
        </CommandMenuList>
        <CommandMenuFooter />
      </CommandMenu>
    </CommandMenuDialog>
  );
}
