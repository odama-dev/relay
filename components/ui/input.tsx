"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useShape } from "@/lib/shape-context";
import { useSize } from "@/lib/size-context";

/**
 * A single text input dressed as a Fluid Functionalism field: a white field
 * fill with the select trigger's hairline at rest, a faint hover tint, the
 * focus ring when focused. Height, text and padding follow the size ladder.
 */
export const fieldClass = cn(
  "w-full min-w-0 border border-border bg-field shadow-field text-foreground outline-none transition-all duration-80",
  "placeholder:text-muted-foreground hover:bg-[color-mix(in_oklab,var(--field),var(--foreground)_3%)] focus-visible:bg-field focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
  "disabled:pointer-events-none disabled:opacity-50",
  "aria-invalid:border-destructive/50 aria-invalid:hover:bg-destructive-light/60",
);

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  const shape = useShape();
  const size = useSize();
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClass,
        size.control,
        size.field,
        size.px,
        shape.input,
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:font-medium file:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
