"use client";

import { forwardRef, useState, type ComponentProps } from "react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/input";
import { useShape } from "@/lib/shape-context";
import { useSize } from "@/lib/size-context";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

/**
 * Popover calendars that stand in for `<input type="date">`. Values stay
 * "yyyy-MM-dd" strings so forms and Zod schemas are unchanged.
 */

/**
 * Form value → local-midnight Date. Form fields are typed `unknown` (Zod
 * preprocess input) and hold "yyyy-MM-dd" strings, occasionally a Date.
 * Strings are split by hand: `new Date("yyyy-MM-dd")` is UTC and can shift the day.
 */
function parseDay(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== "string" || !value) return undefined;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

/** Same field as <Input> and the Select trigger: hairline at rest, tint on hover, card + ring when open. */
const DateTrigger = forwardRef<HTMLButtonElement, ComponentProps<"button"> & { empty: boolean }>(
  ({ empty, className, children, ...props }, ref) => {
    const size = useSize();
    const shape = useShape();
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          fieldClass,
          size.control,
          size.text,
          size.px,
          size.gap,
          shape.input,
          "group flex cursor-pointer items-center text-left data-[popup-open]:bg-card",
          empty && "text-muted-foreground",
          className,
        )}
        {...props}
      >
        <Icon name="calendar" size={size.icon} className="text-muted-foreground group-hover:text-foreground shrink-0 transition-colors duration-80" />
        {children}
      </button>
    );
  },
);
DateTrigger.displayName = "DateTrigger";

type TriggerA11y = Pick<ComponentProps<"button">, "id" | "aria-invalid" | "aria-describedby" | "aria-label">;

function ClearButton({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex justify-end px-3 pb-3">
      <Button type="button" variant="ghost" size="compact" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}

/** The calendar hands back local-midnight Dates; keep the local day. */
function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  clearable = false,
  disabled,
  isDayDisabled,
  className,
  ...a11y
}: TriggerA11y & {
  value: unknown;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Optional fields get a Clear action; required ones don't. */
  clearable?: boolean;
  disabled?: boolean;
  /** Days that can't be picked, as "yyyy-mm-dd" (e.g. locked timesheet weeks). */
  isDayDisabled?: (day: string) => boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const date = parseDay(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <DateTrigger empty={!date} disabled={disabled} className={className} {...a11y}>
          <span className="truncate">{date ? format(date, "PPP") : placeholder}</span>
        </DateTrigger>
      </PopoverTrigger>
      <PopoverContent className="w-auto gap-0 p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          defaultMonth={date}
          disabled={isDayDisabled ? (d: Date) => isDayDisabled(toDateInputValue(d)) : undefined}
          onSelect={(d) => {
            onChange(d ? toDateInputValue(d) : "");
            if (d) setOpen(false);
          }}
        />
        {clearable && date && (
          <ClearButton
            onClear={() => {
              onChange("");
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = "Pick a date range",
  clearable = false,
  disabled,
  className,
  ...a11y
}: TriggerA11y & {
  from: unknown;
  to: unknown;
  onChange: (range: { from: string; to: string }) => void;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const range: DateRange | undefined = from ? { from: parseDay(from), to: parseDay(to) } : undefined;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <DateTrigger empty={!range?.from} disabled={disabled} className={className} {...a11y}>
          {range?.from ? (
            <span className="truncate">
              {format(range.from, "LLL dd, y")}
              {range.to ? ` – ${format(range.to, "LLL dd, y")}` : " – …"}
            </span>
          ) : (
            <span>{placeholder}</span>
          )}
        </DateTrigger>
      </PopoverTrigger>
      <PopoverContent className="w-auto gap-0 p-0" align="start">
        <Calendar
          mode="range"
          defaultMonth={range?.from}
          selected={range}
          numberOfMonths={2}
          onSelect={(r) =>
            onChange({
              from: r?.from ? toDateInputValue(r.from) : "",
              to: r?.to ? toDateInputValue(r.to) : "",
            })
          }
        />
        {clearable && range?.from && <ClearButton onClear={() => onChange({ from: "", to: "" })} />}
      </PopoverContent>
    </Popover>
  );
}
