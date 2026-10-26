"use client";

import { useMemo, useState } from "react";
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
 * adds an empty choice that maps to "". With `createLabel`, a name that
 * matches nothing can be picked as typed: the value is then that name (the
 * caller creates the record on save). Pass the FormField id through.
 */
export function SearchSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Search…",
  emptyText = "Nothing found.",
  noneLabel,
  createLabel,
  disabled,
}: {
  id?: string;
  value: string | null | undefined;
  onChange: (value: string) => void;
  options: SearchOption[];
  placeholder?: string;
  emptyText?: string;
  noneLabel?: string;
  /** Offer to pick what was typed, e.g. (name) => `Create company “${name}”`. */
  createLabel?: (typed: string) => string;
  disabled?: boolean;
}) {
  // A name picked as typed; kept as an item so the field shows it.
  const [typed, setTyped] = useState<string | null>(null);
  const items = useMemo(
    () => [
      ...(noneLabel ? [{ value: NONE, label: noneLabel, hint: undefined, search: noneLabel.toLowerCase() }] : []),
      ...options.map((o) => ({
        ...o,
        search: `${o.label} ${o.hint ?? ""} ${o.search ?? ""}`.toLowerCase(),
      })),
      ...(typed && !options.some((o) => o.value === typed) ? [{ value: typed, label: typed, hint: "New", search: typed.toLowerCase() }] : []),
    ],
    [options, noneLabel, typed],
  );
  type Item = (typeof items)[number];

  return (
    <Combobox
      items={items}
      value={value || (noneLabel ? NONE : "")}
      onValueChange={(v) => v && onChange(v === NONE ? "" : v)}
      filter={(item, query) => {
        const q = query.trim().toLowerCase();
        // The empty choice is a match like any other, so Enter on a typed name picks a real row (or creates it).
        return !q || (item as Item).search.includes(q);
      }}
      onCreate={
        createLabel
          ? (query) => {
              setTyped(query);
              return { value: query, label: query, hint: "New", search: query.toLowerCase() };
            }
          : undefined
      }
      createLabel={createLabel}
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
