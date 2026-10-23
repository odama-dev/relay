"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/icon";
import { Input } from "@/components/ui/input";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

/**
 * A password field with an eye toggle at its trailing edge. The toggle
 * swaps eye ↔ eye-off on spring.fast (same wait-mode swap as InputCopy) and
 * thickens its stroke on hover. Takes every Input prop, including a
 * react-hook-form `register()` spread.
 */
export function PasswordField({ className, ...props }: Omit<React.ComponentProps<typeof Input>, "type">) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={cn("pr-9", className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        disabled={props.disabled}
        className={cn(
          "absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-[inherit] text-muted-foreground transition-colors duration-80",
          "hover:text-foreground focus-visible:text-foreground focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
          "[&_svg]:stroke-[1.5] [&_svg]:transition-[stroke-width] [&_svg]:duration-80 hover:[&_svg]:stroke-[2]",
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={visible ? "off" : "on"}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={spring.fast}
            className="flex"
          >
            <Icon name={visible ? "eyeOff" : "eye"} size={16} />
          </motion.span>
        </AnimatePresence>
      </button>
    </div>
  );
}
