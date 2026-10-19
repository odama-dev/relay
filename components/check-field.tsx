"use client";

import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** A checkbox with its label and an optional hint underneath. */
export function CheckField({
  id,
  checked,
  onChange,
  label,
  hint,
  disabled,
  className,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <Checkbox id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} className="mt-0.5" />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="text-foreground font-normal">
          {label}
        </Label>
        {hint && <p className="text-muted-foreground text-caption">{hint}</p>}
      </div>
    </div>
  );
}
