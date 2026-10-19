"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TabsSubtle, TabsSubtleItem, TabsSubtlePanel } from "@/components/ui/tabs-subtle";

export type EntityTab = {
  value: string;
  label: string;
  count?: number;
  content: ReactNode;
};

/**
 * Detail-page tabs, shared across every entity (Client, Project, …). The
 * active tab is mirrored to `?tab=` (without a server round-trip) so reloads
 * and shared links land on the same tab.
 */
export function EntityTabs({
  items,
  initial,
  fill = false,
  variant = "section",
}: {
  items: EntityTab[];
  initial?: string;
  /** "section": tabs under a full page header, closing it with a hairline.
   *  "toolbar": a list page's edge-to-edge tab row under a compact header,
   *  like FilterBar. */
  variant?: "section" | "toolbar";
  /** Stretch to the remaining page height, so a tab's empty state can centre in it. */
  fill?: boolean;
}) {
  const idPrefix = useId();
  const [selected, setSelected] = useState(() => Math.max(0, items.findIndex((i) => i.value === initial)));

  const onSelect = (index: number) => {
    setSelected(index);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", items[index].value);
    window.history.replaceState(null, "", url);
  };

  return (
    <div data-slot="entity-tabs" className={cn("flex flex-col", variant === "toolbar" ? "gap-4" : "gap-6", fill && "flex-1")}>
      {/* (toolbar) A tab that opens with a table sits flush on the tab row, like under FilterBar. */}
      {/* The tab row sits on a hairline that closes the page header. */}
      <div className={variant === "toolbar" ? "bleed border-b py-2" : "border-b pb-2"}>
        <TabsSubtle selectedIndex={selected} onSelect={onSelect} idPrefix={idPrefix}>
          {items.map((i, index) => (
            <TabsSubtleItem key={i.value} index={index} label={i.count != null ? `${i.label} ${i.count}` : i.label} />
          ))}
        </TabsSubtle>
      </div>
      {items.map((i, index) => (
        <TabsSubtlePanel
          key={i.value}
          index={index}
          selectedIndex={selected}
          idPrefix={idPrefix}
          className={cn(
            fill && index === selected && "flex flex-1 flex-col",
            variant === "toolbar" && "has-[>[data-slot=data-table]:first-child]:-mt-4",
          )}
        >
          {i.content}
        </TabsSubtlePanel>
      ))}
    </div>
  );
}
