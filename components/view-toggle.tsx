"use client";

import { icons, type IconName } from "@/components/icon";
import { Tabs, TabItem, TabsList } from "@/components/ui/tabs";

export type ViewMode = "list" | "kanban";

export type ViewToggleOption<T extends string> = {
  mode: T;
  icon: IconName;
  label: string;
};

/** List/Kanban toggle, ready to use as-is. */
export const LIST_KANBAN_OPTIONS: ViewToggleOption<ViewMode>[] = [
  { mode: "list", icon: "list", label: "List" },
  { mode: "kanban", icon: "kanban", label: "Kanban" },
];

/**
 * Segmented view switcher (Fluid Tabs). Purely presentational and controlled —
 * callers decide how the current mode is stored (URL param, local state) and
 * supply the mode/icon/label options, so Projects (List/Kanban), Tasks
 * (List/Kanban) and People (Directory/Capacity) share one component.
 */
export function ViewToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (view: T) => void;
  options: ViewToggleOption<T>[];
}) {
  // No panels — callers render the chosen view.
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as T)} size="compact">
      <TabsList aria-label="Switch view">
        {options.map((v) => (
          <TabItem key={v.mode} value={v.mode} icon={icons[v.icon]} label={v.label} />
        ))}
      </TabsList>
    </Tabs>
  );
}
