"use client";

import { useCallback, useId, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TabsSubtle, TabsSubtleItem, TabsSubtlePanel } from "@/components/ui/tabs-subtle";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ErrorState } from "@/components/states";
import { Icon, type IconName } from "@/components/icon";
import { usePanelWidth } from "@/components/tasks/use-panel-width";

/**
 * The record side panel (client, deal): a right-edge sheet opened by a URL
 * param over the list it came from — close, step through the list, drag the
 * left edge to resize, widen, or open the full page.
 */

/** Opens (or with null, closes) the panel on `?<param>=<id>`, keeping the other params. */
export function useOpenRecord(param: string) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set(param, id);
      else next.delete(param);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [param, params, pathname, router],
  );
}

export function useOpenRecordId(param: string) {
  return useSearchParams().get(param);
}

export function RecordPanel({
  param,
  ids,
  scope,
  noun,
  storageKey,
  title,
  fullPageHref,
  isLoading,
  error,
  children,
}: {
  param: string;
  /** The list it was opened from, in order, for ↑ / ↓. */
  ids: string[];
  /** "Clients" → "2 of 10 in Clients". */
  scope: string;
  /** "client" → "Next client". */
  noun: string;
  storageKey: string;
  title?: string;
  fullPageHref?: string;
  isLoading: boolean;
  error?: { title: string; description: string } | null;
  children?: ReactNode;
}) {
  const id = useOpenRecordId(param);
  const open = useOpenRecord(param);
  const { width, dragging, expanded, toggleExpanded, handleProps } = usePanelWidth(storageKey);
  const index = id ? ids.indexOf(id) : -1;
  const step = (by: number) => {
    const next = ids[index + by];
    if (next) open(next);
  };

  return (
    <Sheet open={Boolean(id)} onOpenChange={(o) => !o && open(null)}>
      <SheetContent
        showCloseButton={false}
        style={{ "--record-panel-w": `${width}px` } as React.CSSProperties}
        className={cn(
          "flex w-full flex-col gap-0 overflow-hidden p-0 data-[side=right]:sm:w-(--record-panel-w) data-[side=right]:sm:max-w-none",
          // Keep the sheet's slide-in (translate, opacity) when adding the resize easing.
          !dragging && "motion-safe:transition-[translate,opacity,width]",
          dragging && "select-none",
        )}
        onKeyDown={(e) => {
          // j / k step through the list, like a mail client.
          if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey) return;
          if (e.key === "j") step(1);
          else if (e.key === "k") step(-1);
        }}
      >
        <div {...handleProps} className="group absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize touch-none focus-visible:outline-none sm:block">
          <span className={cn("bg-divider absolute inset-y-0 left-0 w-px opacity-0 transition-opacity group-hover:opacity-100", dragging && "bg-foreground/40 opacity-100")} />
        </div>

        <div className="flex items-center gap-1 border-b px-3 py-2">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" onClick={() => open(null)}>
            <Icon name="close" size={16} />
          </Button>
          {index >= 0 && ids.length > 1 && (
            <>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Previous ${noun}`} disabled={index === 0} onClick={() => step(-1)}>
                <Icon name="chevronUp" size={16} />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Next ${noun}`} disabled={index === ids.length - 1} onClick={() => step(1)}>
                <Icon name="chevronDown" size={16} />
              </Button>
              <span className="text-muted-foreground tabular ml-1 truncate text-caption">
                {index + 1} of {ids.length} in {scope}
              </span>
            </>
          )}
          <div className="ml-auto flex items-center gap-1">
            {fullPageHref && (
              <Tooltip content="Open full page">
                <Button variant="ghost" size="icon-sm" aria-label="Open full page" render={<Link href={fullPageHref} />}>
                  <Icon name="external" size={15} />
                </Button>
              </Tooltip>
            )}
            <Tooltip content={expanded ? "Narrow panel" : "Widen panel"}>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={expanded ? "Narrow panel" : "Widen panel"} onClick={toggleExpanded}>
                <Icon name="expand" size={15} />
              </Button>
            </Tooltip>
          </div>
        </div>

        <SheetHeader className="sr-only">
          <SheetTitle>{title ?? noun}</SheetTitle>
        </SheetHeader>

        {isLoading && (
          <div className="flex flex-col gap-4 p-6">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-6 w-full" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          </div>
        )}
        {error && (
          <div className="p-6">
            <ErrorState title={error.title} description={error.description} />
          </div>
        )}
        {children}
      </SheetContent>
    </Sheet>
  );
}

export type RecordTab = { value: string; label: string; count?: number; content: ReactNode };

/** The record's header (icon, name, a line under it, actions) and its tabs; the body scrolls. */
export function RecordBody({
  icon,
  title,
  meta,
  actions,
  tabs,
  tab,
  onTab,
}: {
  icon: IconName;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  tabs: RecordTab[];
  tab: string;
  onTab: (value: string) => void;
}) {
  const idPrefix = useId();
  const selected = Math.max(0, tabs.findIndex((t) => t.value === tab));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-center gap-3 px-6 pt-5 pb-3">
        <span className="bg-surface-3 shadow-surface-2 text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg">
          <Icon name={icon} size={18} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-[20px] leading-[25px] font-medium">{title}</h2>
          {meta && <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-caption">{meta}</span>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div className="overflow-x-auto border-b px-6 pb-2">
        <TabsSubtle selectedIndex={selected} onSelect={(i) => onTab(tabs[i].value)} idPrefix={idPrefix}>
          {tabs.map((t, i) => (
            <TabsSubtleItem key={t.value} index={i} label={t.count != null ? `${t.label} ${t.count}` : t.label} />
          ))}
        </TabsSubtle>
      </div>
      <div className="px-6 py-5">
        {tabs.map((t, i) => (
          <TabsSubtlePanel key={t.value} index={i} selectedIndex={selected} idPrefix={idPrefix}>
            {t.content}
          </TabsSubtlePanel>
        ))}
      </div>
    </div>
  );
}

export function PanelSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-7 items-center justify-between">
        <h3 className="text-muted-foreground text-caption font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A highlight card: label and icon over a value; clickable when it leads to a tab. */
export function Highlight({ label, icon, onClick, children }: { label: string; icon: IconName; onClick?: () => void; children: ReactNode }) {
  const body = (
    <>
      <span className="text-muted-foreground flex items-center justify-between gap-2 text-caption">
        {label}
        <Icon name={icon} size={15} />
      </span>
      <div className="flex min-h-11 min-w-0 flex-col justify-end">{children}</div>
    </>
  );
  const cls = "flex min-w-0 flex-col gap-2 rounded-xl border p-3 text-left";
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, "hover:bg-hover transition-colors duration-80")}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export const HighlightEmpty = ({ children }: { children: ReactNode }) => <span className="text-muted-foreground">{children}</span>;

/** A deal's stage as segments along the visible board; Lost reads red. */
export function StageProgress({ stages, current }: { stages: { name: string; category: string }[]; current: string }) {
  const lost = stages.find((s) => s.name === current)?.category === "lost";
  const track = stages.filter((s) => s.category !== "lost");
  const reached = lost ? -1 : track.findIndex((s) => s.name === current);
  return (
    <span className="mt-1 flex gap-1" aria-hidden>
      {track.map((s, i) => (
        <span key={s.name} className={cn("h-1 flex-1 rounded-full", lost ? "bg-destructive/40" : i <= reached ? "bg-foreground/60" : "bg-foreground/10")} />
      ))}
    </span>
  );
}

export type ActivityItem = { key: string; at: string; icon: IconName; text: ReactNode; tab?: string };

/** Newest first; a row leads to the tab that holds it. */
export function ActivityList({ items, empty, onShow }: { items: ActivityItem[]; empty: string; onShow: (tab: string) => void }) {
  if (!items.length) return <p className="text-muted-foreground text-body">{empty}</p>;
  return (
    <ol className="flex flex-col rounded-xl border">
      {items.map((a) => (
        <li key={a.key} className="border-b last:border-b-0">
          <button
            type="button"
            disabled={!a.tab}
            onClick={() => a.tab && onShow(a.tab)}
            className="enabled:hover:bg-hover flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-80"
          >
            <Icon name={a.icon} size={15} className="text-muted-foreground shrink-0" />
            <span className="min-w-0 flex-1 truncate">{a.text}</span>
            <span className="text-muted-foreground shrink-0 text-caption" title={a.at}>
              {formatRelative(a.at)}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
