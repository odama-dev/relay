"use client";

import { Fragment } from "react";
import { DropdownContent, DropdownMenu, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { Button } from "@/components/ui/button";
import { Icon, icons, type IconName } from "@/components/icon";

export type RowAction = {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  destructive?: boolean;
  hidden?: boolean;
};

/** Destructive rows keep the Fluid menu row, only the label and icon turn red. */
const destructiveItem = "[&_span]:text-destructive! [&_svg]:text-destructive!";

/**
 * The "⋯" overflow menu for a table row or a page header. Destructive actions
 * are separated from the rest. Renders nothing when no action is permitted.
 */
export function RowActions({
  label,
  actions,
  variant = "ghost",
}: {
  /** Accessible name of the trigger, e.g. "Actions for Sari Wijaya". */
  label: string;
  actions: RowAction[];
  variant?: "ghost" | "tertiary";
}) {
  const visible = actions.filter((a) => !a.hidden);
  if (visible.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownTrigger
        render={
          <Button
            variant={variant}
            size={variant === "tertiary" ? "icon" : "icon-compact"}
            aria-label={label}
            onClick={(e) => e.stopPropagation()}
          >
            <Icon name="more" />
          </Button>
        }
      />
      <DropdownContent align="end" className="w-48">
        {visible.map((action, i) => (
          <Fragment key={action.label}>
            {action.destructive && i > 0 && <DropdownSeparator />}
            <MenuItem
              index={i}
              icon={action.icon ? icons[action.icon] : undefined}
              label={action.label}
              onSelect={action.onSelect}
              className={action.destructive ? destructiveItem : undefined}
            />
          </Fragment>
        ))}
      </DropdownContent>
    </DropdownMenu>
  );
}
