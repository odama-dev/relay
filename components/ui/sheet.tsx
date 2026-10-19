"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";
import { useIcons } from "@/lib/icon-context";
import { SurfaceProvider } from "@/lib/surface-context";
import { surfaceClasses } from "@/lib/surface-classes";
import { Button } from "@/components/ui/button";

// An edge panel (task detail) on the Fluid surface ladder: the dialog's
// level, the dialog's backdrop, and the moderate spring's timing (160ms in,
// 120ms out, no overshoot) as a CSS slide so Base UI can see it finish.

const SHEET_LEVEL = 5;

type SheetProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  children?: React.ReactNode;
};

function Sheet({ onOpenChange, ...props }: SheetProps) {
  return <SheetPrimitive.Root onOpenChange={onOpenChange ? (open) => onOpenChange(open) : undefined} {...props} />;
}

type SlotProps = React.ComponentProps<typeof SheetPrimitive.Trigger> & { asChild?: boolean };

function SheetTrigger({ asChild, children, ...props }: SlotProps) {
  if (asChild && React.isValidElement(children)) return <SheetPrimitive.Trigger render={children as React.ReactElement} {...props} />;
  return <SheetPrimitive.Trigger {...props}>{children}</SheetPrimitive.Trigger>;
}

function SheetClose({ asChild, children, ...props }: React.ComponentProps<typeof SheetPrimitive.Close> & { asChild?: boolean }) {
  if (asChild && React.isValidElement(children)) return <SheetPrimitive.Close render={children as React.ReactElement} {...props} />;
  return <SheetPrimitive.Close {...props}>{children}</SheetPrimitive.Close>;
}

const SIDE_CLASS = {
  right: "inset-y-2 right-2 w-[calc(100%-1rem)] sm:max-w-sm data-[starting-style]:translate-x-[calc(100%+0.5rem)] data-[ending-style]:translate-x-[calc(100%+0.5rem)]",
  left: "inset-y-2 left-2 w-[calc(100%-1rem)] sm:max-w-sm data-[starting-style]:-translate-x-[calc(100%+0.5rem)] data-[ending-style]:-translate-x-[calc(100%+0.5rem)]",
  top: "inset-x-2 top-2 data-[starting-style]:-translate-y-full data-[ending-style]:-translate-y-full",
  bottom: "inset-x-2 bottom-2 data-[starting-style]:translate-y-full data-[ending-style]:translate-y-full",
} as const;

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  side?: keyof typeof SIDE_CLASS;
  showCloseButton?: boolean;
}) {
  const XIcon = useIcons().x;
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Backdrop
        className={cn(
          "fixed inset-0 z-50 bg-black/40 transition-opacity duration-160 ease-out dark:bg-black/80",
          "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[ending-style]:duration-120 motion-reduce:transition-none",
        )}
      />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col gap-4 overflow-hidden rounded-xl text-foreground outline-none",
          surfaceClasses(SHEET_LEVEL),
          "transition-[translate,opacity] duration-160 ease-out data-[ending-style]:duration-120 data-[ending-style]:ease-in motion-reduce:transition-none",
          SIDE_CLASS[side],
          className,
        )}
        {...props}
      >
        <SurfaceProvider value={SHEET_LEVEL}>
          {children}
          {showCloseButton && (
            <SheetPrimitive.Close
              render={
                <Button variant="ghost" size="icon-compact" className="absolute top-3 right-3">
                  <XIcon />
                  <span className="sr-only">Close</span>
                </Button>
              }
            />
          )}
        </SurfaceProvider>
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("flex flex-col gap-0.5 p-4", className)} {...props} />;
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-footer" className={cn("mt-auto flex flex-col gap-2 p-4", className)} {...props} />;
}

function SheetTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-[length:var(--fs-title,16px)] leading-[var(--lh-title,22px)] font-medium", className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <SheetPrimitive.Description data-slot="sheet-description" className={cn("text-muted-foreground", className)} {...props} />;
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription };
