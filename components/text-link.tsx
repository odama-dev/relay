import Link from "next/link";
import type { MouseEventHandler, ReactNode } from "react";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

/**
 * Inline text link with the shared hover/focus treatment. `external` opens in a
 * new tab with an indicator; mailto:/tel: links render as plain anchors.
 */
export function TextLink({
  href,
  external = false,
  muted = false,
  className,
  onClick,
  children,
}: {
  href: string;
  external?: boolean;
  muted?: boolean;
  className?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  children: ReactNode;
}) {
  const cls = cn(
    "rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
    muted && "text-muted-foreground hover:text-foreground",
    className,
  );

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        className={cn(cls, "inline-flex items-center gap-1")}
      >
        {children}
        <Icon name="external" size={12} className="opacity-60" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    );
  }

  if (/^(mailto|tel):/.test(href)) {
    return (
      <a href={href} onClick={onClick} className={cls}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} onClick={onClick} className={cls}>
      {children}
    </Link>
  );
}
