import type { ReactNode } from "react";
import Image from "next/image";

/** Centered single-column frame shared by every signed-out screen. */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="relative size-7 shrink-0 overflow-hidden rounded-md">
            <Image src="/odama-mark.png" alt="" fill sizes="28px" />
          </span>
          <span className="text-subtitle font-semibold">Odama OS</span>
        </div>
        <h1 className="text-title font-medium tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-body text-muted-foreground">{description}</p>}
        {children}
      </div>
    </div>
  );
}

/** Inline notice for auth screens (errors carried in `?error=`). */
export function AuthNotice({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="bg-destructive/10 text-destructive mt-6 rounded-lg px-3 py-2.5 text-caption leading-5"
    >
      {children}
    </p>
  );
}
