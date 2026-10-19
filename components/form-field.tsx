import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Shared form layout primitives. Settings and every entity dialog use these so
 * labels, hints and errors look and behave the same everywhere.
 */

export function FormSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** Compact control aligned with the section heading (e.g. a currency picker). */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    // Consecutive sections are split by a hairline, like settings panes.
    <section className="flex flex-col gap-4 [section+&]:border-t [section+&]:pt-8">
      {description || action ? (
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-subtitle font-semibold">{title}</h2>
            {description && (
              <p className="text-caption text-muted-foreground">{description}</p>
            )}
          </div>
          {action}
        </div>
      ) : (
        <h2 className="text-subtitle font-semibold">{title}</h2>
      )}
      {children}
    </section>
  );
}

export function FormField({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && (
          <span aria-hidden="true" className="-ml-1 text-muted-foreground">
            *
          </span>
        )}
      </Label>
      {children}
      {hint && !error && (
        <p
          id={htmlFor ? `${htmlFor}-hint` : undefined}
          className="text-caption text-muted-foreground"
        >
          {hint}
        </p>
      )}
      {error && (
        <p
          id={htmlFor ? `${htmlFor}-error` : undefined}
          className="text-destructive text-caption"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** Wires an input to its FormField label, hint and error for assistive tech. */
export function fieldA11y(id: string, error?: string, hasHint = false) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error
      ? `${id}-error`
      : hasHint
        ? `${id}-hint`
        : undefined,
  } as const;
}
