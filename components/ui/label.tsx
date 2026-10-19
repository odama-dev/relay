import * as React from "react";
import { cn } from "@/lib/utils";

/** Field label on the Fluid type scale: body size, muted, no extra weight. */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "text-muted-foreground flex items-center gap-2 text-[length:var(--fs-body,13px)] leading-[var(--lh-body,20px)] select-none",
        "group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
