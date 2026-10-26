"use client";

import { useMemo } from "react";
import { SearchSelect, type SearchOption } from "@/components/search-select";

/** "GMT+07:00" for Asia/Jakarta, "GMT" for UTC. */
function offsetOf(timeZone: string, at: Date): string {
  const part = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

let cached: SearchOption[] | null = null;

/** Every IANA zone the runtime knows, labelled "Asia/Jakarta" with its current offset; search by city or offset. */
function timeZoneOptions(): SearchOption[] {
  if (cached) return cached;
  const now = new Date();
  cached = Intl.supportedValuesOf("timeZone").map((tz) => {
    const hint = offsetOf(tz, now);
    return { value: tz, label: tz.replaceAll("_", " "), hint, search: `${tz.toLowerCase()} ${hint.replace("GMT", "utc")}` };
  });
  return cached;
}

/** A time zone picked from the list (type to search). `noneLabel` allows none. Pass the FormField id through. */
export function TimezoneSelect({
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
  const options = useMemo(() => {
    const all = timeZoneOptions();
    // A value saved before the list (or an alias) stays selectable.
    return value && !all.some((o) => o.value === value) ? [{ value, label: value }, ...all] : all;
  }, [value]);
  return (
    <SearchSelect
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      placeholder="Search time zones…"
      emptyText="No time zone found."
      noneLabel={noneLabel}
      disabled={disabled}
    />
  );
}
