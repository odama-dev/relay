import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  description?: string;
  /** Rendered above the title — e.g. a breadcrumb on detail pages. */
  eyebrow?: ReactNode;
  /** Rendered under the description — e.g. a detail page's key attributes. */
  meta?: ReactNode;
  actions?: ReactNode;
  /** List pages: an edge-to-edge toolbar row (title + actions) on a hairline. */
  compact?: boolean;
  className?: string;
};

export function PageHeader({ title, description, eyebrow, meta, actions, compact = false, className }: Props) {
  if (compact) {
    return (
      <div
        data-slot="page-header"
        className={cn("bleed flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b py-2", className)}
      >
        <h1 className="truncate text-[length:var(--fs-subtitle,14px)] leading-[var(--lh-subtitle,20px)] font-semibold">
          {title}
        </h1>
        {actions && <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
      </div>
    );
  }
  // Full header: a bold, modest title over a hairline that closes the section.
  // When tabs follow, their own hairline closes it instead.
  return (
    <div
      data-slot="page-header"
      className={cn(
        "mb-6 flex flex-col gap-3 border-b pt-8 pb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
        "[&:has(+[data-slot=entity-tabs])]:border-b-0 [&:has(+[data-slot=entity-tabs])]:pb-0",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="truncate text-[22px] leading-7 font-semibold tracking-[-0.01em]">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-body">{description}</p>}
        {meta && <div className="mt-3">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
