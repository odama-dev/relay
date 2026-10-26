"use client";

import { useMemo, useState } from "react";
import { Combobox, ComboboxChips, ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import type { SearchOption } from "@/components/search-select";

/**
 * Several values in one field, as chips: picked from `options` (team, deals),
 * typed in (`creatable`: domains, emails, phones), or both (categories, a
 * company's team). `normalize` tidies what's typed before it becomes a chip;
 * `createLabel` names the row that adds it. Pass the FormField id through.
 */
export function ChipsField({
  id,
  value,
  onChange,
  options = [],
  creatable = false,
  normalize = (v) => v.trim(),
  createLabel = (v) => `Add “${v}”`,
  placeholder,
  emptyText = "Nothing found.",
  error,
  disabled,
}: {
  id?: string;
  value: string[];
  onChange: (value: string[]) => void;
  options?: SearchOption[];
  creatable?: boolean;
  normalize?: (typed: string) => string;
  createLabel?: (typed: string) => string;
  placeholder?: string;
  emptyText?: string;
  error?: string;
  disabled?: boolean;
}) {
  // Typed values that aren't options yet; kept so a chip keeps its label.
  const [typed, setTyped] = useState<string[]>([]);
  const items = useMemo(() => {
    const known = new Set(options.map((o) => o.value));
    const extra = [...new Set([...value, ...typed])].filter((v) => !known.has(v)).map((v) => ({ value: v, label: v, hint: undefined, search: v.toLowerCase() }));
    return [...options.map((o) => ({ ...o, search: `${o.label} ${o.hint ?? ""} ${o.search ?? ""}`.toLowerCase() })), ...extra];
  }, [options, value, typed]);
  type Item = (typeof items)[number];

  return (
    <Combobox
      items={items}
      multiple
      value={value}
      onValueChange={onChange}
      hideSelected
      filter={(item, query) => {
        const q = query.trim().toLowerCase();
        return !q || (item as Item).search.includes(q);
      }}
      onCreate={
        creatable
          ? (query) => {
              const v = normalize(query);
              if (!v) return;
              setTyped((t) => (t.includes(v) ? t : [...t, v]));
              return { value: v, label: v, hint: undefined, search: v.toLowerCase() };
            }
          : undefined
      }
      createLabel={(query) => createLabel(normalize(query) || query)}
      disabled={disabled}
    >
      {/* FormField shows the message; the field only reads as invalid. */}
      <ComboboxChips id={id} placeholder={placeholder} aria-invalid={error ? true : undefined} className="w-full" />
      <ComboboxContent>
        {/* A typed-only field has no list: the add row is all there is. */}
        <ComboboxEmpty>{options.length ? emptyText : null}</ComboboxEmpty>
        <ComboboxList>
          {(item) => {
            const o = item as Item;
            return (
              <ComboboxItem value={o.value}>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate">{o.label}</span>
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

/** A list field's message: the list's own ("Add the company's domain"), else the first bad entry's. */
export function listError(e: { message?: string } | ({ message?: string } | undefined)[] | undefined): string | undefined {
  if (!e) return undefined;
  if (Array.isArray(e)) return e.find((x) => x?.message)?.message;
  return e.message ?? (Object.values(e).find((x) => typeof x === "object" && x && "message" in x) as { message?: string } | undefined)?.message;
}
