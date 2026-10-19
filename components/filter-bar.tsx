"use client";

import { useCallback, useEffect, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { InputField, InputGroup } from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { icons } from "@/components/icon";

export type FilterOption = { value: string; label: string };

export type FilterDef = {
  /** URL search param the filter writes to. */
  param: string;
  label: string;
  /** Label of the "no filter" option, e.g. "All statuses". */
  allLabel: string;
  options: FilterOption[];
};

const ALL = "__all";

/**
 * Search + dropdown filters, synced to the URL so results are shareable and
 * survive reloads. The page reads the same params server-side. `q` is search.
 * Layout follows the design: filters lead, search sits opposite them.
 */
export function FilterBar({
  searchPlaceholder = "Search…",
  filters = [],
  variant = "toolbar",
  search: showSearch = true,
  actions,
}: {
  searchPlaceholder?: string;
  filters?: FilterDef[];
  /** "toolbar": an edge-to-edge row on a hairline under a list page's header.
   *  "inline": search leads at full width, for centred management pages.
   *  "bare": just the controls, to sit inside another row (a page header's
   *  actions, a section toolbar). */
  variant?: "toolbar" | "inline" | "bare";
  /** Render the search field. Off when a bare bar only carries filters. */
  search?: boolean;
  /** Trailing controls (e.g. an Invite button) in the inline variant. */
  actions?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(() => params.get("q") ?? "");

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const qs = next.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [params, pathname, router],
  );

  // Debounce typing so every keystroke doesn't hit the server.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === (params.get("q") ?? "")) return;
    const t = setTimeout(() => update({ q: trimmed || null }), 250);
    return () => clearTimeout(t);
  }, [query, params, update]);

  // Clear only touches the params this bar owns, so two bars can split one page's filters.
  const hasActive = (showSearch && Boolean(params.get("q"))) || filters.some((f) => params.get(f.param));

  const clear = () => {
    if (showSearch) setQuery("");
    update({ ...(showSearch ? { q: null } : {}), ...Object.fromEntries(filters.map((f) => [f.param, null])) });
  };

  const search = showSearch && (
    <InputGroup size="compact" className={variant === "inline" ? "min-w-48 flex-1" : "w-full sm:w-[294px]"}>
      <InputField
        index={0}
        label={searchPlaceholder}
        labelHidden
        icon={icons.search}
        type="search"
        value={query}
        onChange={setQuery}
        placeholder={searchPlaceholder}
      />
    </InputGroup>
  );

  return (
    <div
      role="search"
      className={
        variant === "inline"
          ? "flex w-full flex-wrap items-center gap-[8px]"
          : variant === "bare"
            ? "flex flex-wrap items-center gap-[8px]"
            : "bleed flex flex-wrap items-center justify-between gap-[8px] border-b py-2"
      }
      aria-busy={pending}
    >
      {variant === "inline" && search}
      <div className="flex flex-wrap items-center gap-[8px]">
        {filters.map((f) => (
          <Select
            key={f.param}
            size="compact"
            value={params.get(f.param) ?? ALL}
            onValueChange={(v) => update({ [f.param]: v === ALL ? null : v })}
          >
            <SelectTrigger aria-label={f.label} className="min-w-0" />
            <SelectContent>
              <SelectItem index={0} value={ALL}>
                {f.allLabel}
              </SelectItem>
              {f.options.map((o, i) => (
                <SelectItem key={o.value} index={i + 1} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}

        {hasActive && (
          <Button variant="ghost" size="compact" onClick={clear}>
            Clear
          </Button>
        )}
        {actions}
      </div>

      {variant !== "inline" && search}

      <span aria-live="polite" className="sr-only">
        {pending ? "Updating…" : ""}
      </span>
    </div>
  );
}
