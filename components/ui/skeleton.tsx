import { cn } from "@/lib/utils";

/** Loading placeholder: the Fluid hover tint, pulsing (still under reduced motion). */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("bg-active animate-pulse rounded-lg motion-reduce:animate-none", className)} {...props} />;
}

export { Skeleton };
