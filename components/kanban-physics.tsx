"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { DropAnimation } from "@dnd-kit/core";
import { usePrefersReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/** Springy ease (slight overshoot) shared by every Kanban interaction. */
export const SPRING_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * Card surface shared by every Kanban board: hover lift, press-in, keyboard
 * focus ring, a selected state, and the "land" animation on (re)mount. Uses
 * Tailwind's `translate`/`scale` properties so it never fights dnd-kit's or
 * the keyframe's `transform`.
 */
export function kanbanCardClass({
  draggable,
  isDragging,
  selected,
}: {
  draggable?: boolean;
  isDragging?: boolean;
  selected?: boolean;
}) {
  return cn(
    "bg-card border shadow-field relative touch-none rounded-lg p-3 select-none outline-none",
    "transition-[translate,scale,box-shadow,background-color,opacity] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
    "motion-safe:animate-[kanban-card-land_320ms_cubic-bezier(0.34,1.56,0.64,1)]",
    "hover:shadow-md motion-safe:hover:-translate-y-0.5",
    "motion-safe:active:translate-y-0 motion-safe:active:scale-[0.98] active:shadow-none active:duration-100",
    "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
    draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
    selected && "shadow-md ring-1 ring-[color:var(--focus-ring,#6B97FF)]",
    // The source card stays behind as a faded slot while the overlay moves.
    isDragging && "opacity-30 shadow-none hover:translate-y-0",
  );
}

/** Neighbours sliding apart to open a gap — springy, like the drop. */
export const SORT_TRANSITION = { duration: 300, easing: SPRING_EASE };

/** Drop settle with a slight overshoot; none under prefers-reduced-motion. */
export function useKanbanDropAnimation(): DropAnimation | null {
  const reducedMotion = usePrefersReducedMotion();
  return reducedMotion ? null : { duration: 320, easing: SPRING_EASE };
}

// Spring constants for the drag tilt — tuned to settle in ~400ms with one
// soft wobble rather than oscillating.
const STIFFNESS = 320;
const DAMPING = 20;
const MAX_TILT = 7; // degrees
const VELOCITY_TO_TILT = 9; // degrees per (px/ms)
const TILT_DECAY = 0.002; // fraction of target tilt left after 1s of no movement

/**
 * Wraps the DragOverlay card: lifts it and tilts it in the direction of travel
 * on a damped spring driven by pointer velocity, so a fast flick swings the
 * card and it rights itself when the pointer slows. Static under reduced motion.
 */
export function KanbanDragTilt({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion) return;

    let lastX: number | null = null;
    let lastT = 0;
    let target = 0;
    let angle = 0;
    let velocity = 0;
    let prev = performance.now();
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      const now = performance.now();
      if (lastX !== null) {
        const vx = (e.clientX - lastX) / Math.max(now - lastT, 1);
        target = Math.max(-MAX_TILT, Math.min(MAX_TILT, vx * VELOCITY_TO_TILT));
      }
      lastX = e.clientX;
      lastT = now;
    };

    const tick = (now: number) => {
      const dt = Math.min((now - prev) / 1000, 1 / 30);
      prev = now;
      target *= Math.pow(TILT_DECAY, dt);
      const accel = -STIFFNESS * (angle - target) - DAMPING * velocity;
      velocity += accel * dt;
      angle += velocity * dt;
      el.style.rotate = `${angle.toFixed(2)}deg`;
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [reducedMotion]);

  return (
    <div
      ref={ref}
      className={cn(
        "cursor-grabbing [&>*]:animate-none [&>*]:shadow-lg",
        !reducedMotion && "scale-[1.03] animate-in zoom-in-[0.97] duration-150",
      )}
    >
      {children}
    </div>
  );
}
