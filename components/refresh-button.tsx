"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { icons } from "@/components/icon";

/** Reloads the server data of the current page (dashboard header, a card's "Try again"). */
export function RefreshButton({ label = "Refresh", size = "compact", variant = "tertiary" }: { label?: string; size?: "compact" | "default"; variant?: "tertiary" | "ghost" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant={variant} size={size} leadingIcon={icons.refresh} loading={pending} onClick={() => start(() => router.refresh())}>
      {label}
    </Button>
  );
}
