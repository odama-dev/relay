"use client";

import { DropdownContent, DropdownMenu, DropdownTrigger } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { Button } from "@/components/ui/button";
import { icons } from "@/components/icon";

type Option<T extends string> = { value: T; label: string };

/** Compact dropdown used in card headers ("Last 6 months ⌄"). */
export function PillSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const checked = Math.max(0, options.findIndex((o) => o.value === value));

  return (
    <DropdownMenu size="compact">
      <DropdownTrigger
        render={
          <Button variant="secondary" size="compact" trailingIcon={icons.chevronDown} aria-label={ariaLabel} className={className}>
            {options[checked]?.label}
          </Button>
        }
      />
      <DropdownContent align="end" checkedIndex={checked} className="w-auto min-w-40">
        {options.map((o, i) => (
          <MenuItem key={o.value} index={i} label={o.label} checked={i === checked} onSelect={() => onChange(o.value)} />
        ))}
      </DropdownContent>
    </DropdownMenu>
  );
}
