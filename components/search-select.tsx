"use client";

import { useMemo } from "react";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";

export type SearchOption = {
  value: string;
  label: string;
  hint?: string;
  search?: string;
};

const NONE = "__none";

/**
 * A select you type into — for long lists (People, Companies, projects).
 * Matches on the label, the hint and any extra `search` text. `noneLabel`
 * adds an empty choice that maps to "". Pass the FormField id through.
 */
export function SearchSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Search…",
  emptyText = "Nothing found.",
  noneLabel,
  disabled,
}: {
  id?: string;
  value: string | null | undefined;
  onChange: (value: string) => void;
  options: SearchOption[];
  placeholder?: string;
  emptyText?: string;
  noneLabel?: string;
  disabled?: boolean;
}) {
  const items = useMemo(
    () => [
      ...(noneLabel ? [{ value: NONE, label: noneLabel, hint: undefined, search: "" }] : []),
      ...options.map((o) => ({
        ...o,
        search: `${o.label} ${o.hint ?? ""} ${o.search ?? ""}`.toLowerCase(),
      })),
    ],
    [options, noneLabel],
  );
  type Item = (typeof items)[number];

  return (
    <Combobox
      items={items}
      value={value || (noneLabel ? NONE : "")}
      onValueChange={(v) => v && onChange(v === NONE ? "" : v)}
      filter={(item, query) => {
        const q = query.trim().toLowerCase();
        return !q || (item as Item).value === NONE || (item as Item).search.includes(q);
      }}
      disabled={disabled}
    >
      <ComboboxInput id={id} placeholder={placeholder} className="w-full" />
      <ComboboxContent>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(item) => {
            const o = item as Item;
            return (
              <ComboboxItem value={o.value}>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className={o.value === NONE ? "text-muted-foreground truncate" : "truncate"}>{o.label}</span>
                  {o.hint && <span className="text-muted-foreground ml-auto shrink-0 truncate text-caption">{o.hint}</span>}
                </span>
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
