"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useShape } from "@/lib/shape-context";
import { useSize } from "@/lib/size-context";
import { fieldClass } from "@/components/ui/input";

/** Multi-line twin of Input: same Fluid field states, grows with its content. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  const shape = useShape();
  const size = useSize();
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldClass, "field-sizing-content flex min-h-16 py-2", size.field, size.px, shape.input, className)}
      {...props}
    />
  );
}

export { Textarea };
