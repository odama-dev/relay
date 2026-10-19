"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Click-to-edit title (PRD §6) — saves on blur/Enter, Escape reverts. */
export function TaskTitle({
  title,
  editable,
  onSave,
}: {
  title: string;
  editable: boolean;
  onSave: (title: string) => void;
}) {
  const [value, setValue] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const editing = value !== null;

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const startEditing = () => setValue(title);

  const commit = () => {
    const trimmed = (value ?? "").trim();
    setValue(null);
    if (trimmed && trimmed !== title) onSave(trimmed);
  };

  if (!editable) {
    return <h2 className="text-xl font-medium tracking-tight">{title}</h2>;
  }

  if (editing) {
    return (
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            setValue(null);
          }
        }}
        aria-label="Task title"
        className="w-full rounded-md border border-transparent bg-transparent text-xl font-medium tracking-tight outline-none focus:border-border"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      className={cn(
        "w-full rounded-md px-0 text-left text-xl font-medium tracking-tight",
        "hover:bg-accent/50 -mx-1 px-1 py-0.5",
      )}
    >
      {title}
    </button>
  );
}
