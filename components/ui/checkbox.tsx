"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { cn } from "@/lib/utils";
import { omit } from "@/lib/omit";
import { useSize } from "@/lib/size-context";

// A standalone checkbox for places a CheckboxGroup row doesn't fit (a table
// row, a bulk-select bar, a form field with a hint). It draws exactly what a
// Fluid CheckboxItem draws: a 1.5px hairline box that darkens on hover, which
// fills with primary under a check that draws itself in (0.08s) and retracts
// (0.04s).

type CheckedState = boolean | "indeterminate";

type CheckboxProps = Omit<React.ComponentProps<typeof CheckboxPrimitive.Root>, "checked" | "onCheckedChange" | "indeterminate"> & {
  checked: CheckedState;
  onCheckedChange?: (checked: boolean) => void;
};

const stripMotionConflicts = (props: object) =>
  omit(props as React.HTMLAttributes<SVGSVGElement>, [
    "style",
    "onDrag",
    "onDragStart",
    "onDragEnd",
    "onAnimationStart",
    "onAnimationEnd",
    "onAnimationIteration",
  ]);

function Checkbox({ checked, onCheckedChange, className, ...props }: CheckboxProps) {
  const compact = useSize().variant === "compact";
  const on = checked === true;
  const mixed = checked === "indeterminate";
  const glyph = compact ? 16 : 18;

  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      checked={on}
      indeterminate={mixed}
      onCheckedChange={(next) => onCheckedChange?.(next)}
      className={cn(
        "group/checkbox relative shrink-0 cursor-pointer appearance-none border-0 bg-transparent p-0 outline-none",
        "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50",
        compact ? "size-[14px] rounded-[4px]" : "size-[16px] rounded-[5px]",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 border-[1.5px] border-solid transition-all duration-80",
          compact ? "rounded-[4px]" : "rounded-[5px]",
          on || mixed
            ? "border-transparent bg-primary"
            : "border-border group-hover/checkbox:border-neutral-400 dark:group-hover/checkbox:border-neutral-500",
        )}
      />
      <AnimatePresence initial={false}>
        {(on || mixed) && (
          <CheckboxPrimitive.Indicator
            keepMounted
            render={(indicatorProps) => (
              <motion.svg
                {...stripMotionConflicts(indicatorProps)}
                width={glyph}
                height={glyph}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-primary-foreground absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                initial={{ opacity: 1 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 1 }}
              >
                <motion.path
                  d={mixed ? "M7 12H17" : "M6 12L10 16L18 8"}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1, transition: { duration: 0.08, ease: "easeOut" } }}
                  exit={{ pathLength: 0, transition: { duration: 0.04, ease: "easeIn" } }}
                />
              </motion.svg>
            )}
          />
        )}
      </AnimatePresence>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
