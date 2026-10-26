"use client";

import { COUNTRIES } from "@/lib/geo/countries";
import { countryLabel } from "@/lib/geo/pure";
import { SearchSelect } from "@/components/search-select";

/** Every country, as people write them, valued by the world map's name (what the country tracker counts). */
export const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c, label: countryLabel(c), search: c.toLowerCase() })).sort((a, b) => a.label.localeCompare(b.label));
/** The same list for a table cell or other ref picker. */
export const COUNTRY_REFS = COUNTRY_OPTIONS.map((o) => ({ id: o.value, name: o.label }));

/** A country picked from the list (type to search). `noneLabel` allows none. Pass the FormField id through. */
export function CountrySelect({
  id,
  value,
  onChange,
  noneLabel,
  disabled,
}: {
  id?: string;
  value: string | null | undefined;
  onChange: (value: string) => void;
  noneLabel?: string;
  disabled?: boolean;
}) {
  return (
    <SearchSelect
      id={id}
      value={value}
      onChange={onChange}
      options={COUNTRY_OPTIONS}
      placeholder="Search countries…"
      emptyText="No country found."
      noneLabel={noneLabel}
      disabled={disabled}
    />
  );
}
