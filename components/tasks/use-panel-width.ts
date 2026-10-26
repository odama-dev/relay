"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const PANEL_DEFAULT_WIDTH = 576; // sm:max-w-xl, the original width
const MIN_WIDTH = 420;
const KEY_STEP = 32;

/** Widest the panel may get: 90% of the viewport, at most 1280px. */
const maxWidth = () => Math.min(Math.round(window.innerWidth * 0.9), 1280);
const clamp = (w: number) => Math.max(MIN_WIDTH, Math.min(w, maxWidth()));

function readStored(key: string): number | null {
  try {
    const n = Number(window.localStorage.getItem(key));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function store(key: string, width: number) {
  try {
    window.localStorage.setItem(key, String(Math.round(width)));
  } catch {
    // Private mode / blocked storage — the width just isn't remembered.
  }
}

/**
 * Drag-to-resize width for a right-edge panel (task, client); each panel
 * remembers its own width under `storageKey`. The width is a per-viewer
 * convenience, so it lives in localStorage (never shared, safe to lose).
 */
export function usePanelWidth(storageKey = "task-panel-width") {
  // Lazy read is safe: the sheet renders in a client-only portal, so this
  // width never has to match server HTML.
  const [width, setWidth] = useState(() =>
    typeof window === "undefined"
      ? PANEL_DEFAULT_WIDTH
      : clamp(readStored(storageKey) ?? PANEL_DEFAULT_WIDTH),
  );
  const [dragging, setDragging] = useState(false);
  // Width to return to when "Collapse" undoes "Expand".
  const beforeExpand = useRef(PANEL_DEFAULT_WIDTH);

  useEffect(() => {
    const onResize = () => setWidth((w) => clamp(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const commit = useCallback((w: number) => {
    const next = clamp(w);
    setWidth(next);
    store(storageKey, next);
  }, [storageKey]);

  const handleProps = {
    role: "separator" as const,
    "aria-orientation": "vertical" as const,
    "aria-label": "Resize panel",
    "aria-valuenow": Math.round(width),
    "aria-valuemin": MIN_WIDTH,
    tabIndex: 0,
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (!dragging) return;
      // Panel is pinned to the right edge: its width is the distance to it.
      setWidth(clamp(window.innerWidth - e.clientX));
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      if (!dragging) return;
      e.currentTarget.releasePointerCapture(e.pointerId);
      setDragging(false);
      commit(window.innerWidth - e.clientX);
    },
    onDoubleClick: () => commit(PANEL_DEFAULT_WIDTH),
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      // Left widens (the handle sits on the panel's left edge).
      if (e.key === "ArrowLeft") commit(width + KEY_STEP);
      else if (e.key === "ArrowRight") commit(width - KEY_STEP);
      else if (e.key === "Home") commit(MIN_WIDTH);
      else if (e.key === "End") commit(maxWidth());
      else return;
      e.preventDefault();
    },
  };

  const expanded = typeof window !== "undefined" && width >= maxWidth() - 1;
  const toggleExpanded = () => {
    if (expanded) {
      commit(beforeExpand.current);
    } else {
      beforeExpand.current = width;
      commit(maxWidth());
    }
  };

  return { width, dragging, expanded, toggleExpanded, handleProps };
}
