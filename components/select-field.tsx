"use client";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string; hint?: string };

const NONE = "__none";

/**
 * The form select: options in, value out. `noneLabel` adds an empty choice
 * that maps to "" (e.g. "Unassigned"). Pass the FormField a11y props through.
 */
export function SelectField({
  value,
  onChange,
  options,
  placeholder = "Select…",
  noneLabel,
  disabled,
  size = "default",
  className,
  ...a11y
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  noneLabel?: string;
  disabled?: boolean;
  size?: "compact" | "default";
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const current = value ? value : noneLabel ? NONE : "";
  return (
    <Select value={current} onValueChange={(v) => onChange(v === NONE ? "" : v)} disabled={disabled} size={size}>
      <SelectTrigger placeholder={placeholder} className={cn("w-full min-w-0", className)} {...a11y} />
      <SelectContent>
        {noneLabel && (
          <SelectItem index={0} value={NONE}>
            {noneLabel}
          </SelectItem>
        )}
        {options.map((o, i) => (
          // A plain-string label, so the trigger can show it before the popup has mounted.
          <SelectItem key={o.value} index={i + (noneLabel ? 1 : 0)} value={o.value}>
            {o.hint ? `${o.label} · ${o.hint}` : o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
