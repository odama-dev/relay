"use client";

import type { ComponentProps } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { icons, type IconName } from "@/components/icon";

/**
 * A Fluid Button that navigates. Server components use this instead of
 * `<Button asChild><Link/></Button>`: the link element has to be created on
 * the client, or SSR renders a <button> and hydration fails. `external` keeps
 * a plain <a> for file downloads and API routes.
 */
export function LinkButton({
  href,
  icon,
  external = false,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "asChild" | "render" | "leadingIcon"> & {
  href: string;
  icon?: IconName;
  external?: boolean;
}) {
  return (
    <Button asChild leadingIcon={icon ? icons[icon] : undefined} {...props}>
      {external ? <a href={href}>{children}</a> : <Link href={href}>{children}</Link>}
    </Button>
  );
}
