"use client";

import type { ComponentProps } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { icons, type IconName } from "@/components/icon";

/** The page-level primary action ("Add client", "Create invoice"): a Fluid primary button. Pass `href` to make it a link. */
export function PillButton({
  icon = "add",
  variant = "primary",
  href,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "asChild"> & { icon?: IconName | null; href?: string }) {
  const leadingIcon = icon ? icons[icon] : undefined;
  if (href) {
    return (
      <Button variant={variant} leadingIcon={leadingIcon} className={className} asChild {...props}>
        <Link href={href}>{children}</Link>
      </Button>
    );
  }
  return (
    <Button variant={variant} leadingIcon={leadingIcon} className={className} {...props}>
      {children}
    </Button>
  );
}
