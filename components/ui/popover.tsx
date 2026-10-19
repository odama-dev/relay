"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";
import { popupMotionClass } from "@/lib/popup";
import { useShape } from "@/lib/shape-context";
import { SurfaceProvider, useSurface } from "@/lib/surface-context";
import { surfaceClasses } from "@/lib/surface-classes";

// A free-form popup (date picker, notifications, pickers) on the Fluid
// Functionalism surface ladder: two steps above whatever it opens from, the
// dropdown's fixed shadow weight, the container radius of the shape context,
// and the shared popup entrance (a short rise from the trigger side + fade).

const POPOVER_OFFSET = 2;

type PopoverProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  children?: React.ReactNode;
};

function Popover({ onOpenChange, ...props }: PopoverProps) {
  return <PopoverPrimitive.Root onOpenChange={onOpenChange ? (open) => onOpenChange(open) : undefined} {...props} />;
}

type PopoverTriggerProps = React.ComponentProps<typeof PopoverPrimitive.Trigger> & {
  /** The single child element becomes the trigger (Radix spelling of `render`). */
  asChild?: boolean;
};

function PopoverTrigger({ asChild, children, render, ...props }: PopoverTriggerProps) {
  if (asChild && React.isValidElement(children)) {
    return <PopoverPrimitive.Trigger data-slot="popover-trigger" render={children as React.ReactElement} {...props} />;
  }
  return (
    <PopoverPrimitive.Trigger data-slot="popover-trigger" render={render} {...props}>
      {children}
    </PopoverPrimitive.Trigger>
  );
}

type PopoverContentProps = React.HTMLAttributes<HTMLDivElement> & {
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  alignOffset?: number;
};

function PopoverContent({
  className,
  side = "bottom",
  align = "center",
  sideOffset = 6,
  alignOffset = 0,
  children,
  ...props
}: PopoverContentProps) {
  const shape = useShape();
  const level = Math.min(useSurface() + POPOVER_OFFSET, 8);
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className="z-50 outline-none"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "flex w-72 flex-col gap-2.5 p-2.5 text-foreground outline-none",
            surfaceClasses(level, 3),
            shape.container,
            popupMotionClass,
            "transition-[opacity,scale,translate] duration-150 ease-out",
            "data-[starting-style]:translate-y-(--popup-enter-y) data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0",
            "data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:duration-100",
            "motion-reduce:transition-none",
            className,
          )}
          {...props}
        >
          <SurfaceProvider value={level}>{children}</SurfaceProvider>
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="popover-header" className={cn("flex flex-col gap-0.5", className)} {...props} />;
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("text-[length:var(--fs-subtitle,14px)] leading-[var(--lh-subtitle,20px)] font-medium", className)}
      {...props}
    />
  );
}

function PopoverDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <PopoverPrimitive.Description data-slot="popover-description" className={cn("text-muted-foreground", className)} {...props} />;
}

export { Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverTitle, PopoverDescription };
