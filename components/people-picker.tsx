"use client";

import { useMemo } from "react";
import {
  Combobox,
  ComboboxChips,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { MemberAvatar } from "@/components/member-avatar";

export type PickablePerson = { id: string; name: string; avatarUrl?: string | null };

/** Multi-select of people (collaborators, members) with search: a Fluid chips combobox. */
export function PeoplePicker({
  people,
  value,
  onChange,
  placeholder = "Add people",
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  people: PickablePerson[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const items = useMemo(() => people.map((p) => ({ value: p.id, label: p.name, avatarUrl: p.avatarUrl })), [people]);

  return (
    <Combobox items={items} multiple value={value} onValueChange={onChange} disabled={disabled}>
      <ComboboxChips placeholder={placeholder} aria-label={ariaLabel} className={className} />
      <ComboboxContent>
        <ComboboxEmpty>No one found.</ComboboxEmpty>
        <ComboboxList>
          {(item) => {
            const person = item as (typeof items)[number];
            return (
              <ComboboxItem value={person.value}>
                <span className="flex min-w-0 items-center gap-2">
                  <MemberAvatar seed={person.value} src={person.avatarUrl} size={18} />
                  <span className="truncate">{person.label}</span>
                </span>
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
