"use client";

import { useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { amountToInput, formatAmountInput, parseAmountInput } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Numeric input for money and hours: groups thousands as you type
 * ("6,000,000"), hands the form a number (or null when empty).
 */
export function AmountInput({
  value,
  onChange,
  decimals = 2,
  prefix,
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  decimals?: number;
  /** Shown inside the field, e.g. the currency code. */
  prefix?: string;
}) {
  const [text, setText] = useState(() => amountToInput(value, decimals));
  // Re-sync when the form resets the value from outside.
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    if (parseAmountInput(text) !== value) setText(amountToInput(value, decimals));
  }

  return (
    <div className="relative">
      {prefix && (
        <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-caption">{prefix}</span>
      )}
      <Input
        {...props}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          const next = formatAmountInput(e.target.value, decimals);
          setText(next);
          const n = parseAmountInput(next);
          const v = Number.isNaN(n) ? null : n;
          setLast(v);
          onChange(v);
        }}
        className={cn("tabular", prefix && "pl-11", className)}
      />
    </div>
  );
}
