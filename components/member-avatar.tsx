"use client";

import { GradientAvatar } from "@outpacelabs/avatars";
import { cn } from "@/lib/utils";

type Props = {
  /** Stable identity (profile id) — the same seed always paints the same avatar. */
  seed: string;
  /** Uploaded avatar; the gradient is the fallback. */
  src?: string | null;
  size?: number;
  /** Corner radius; defaults to a full circle. */
  radius?: number | string;
  /** Shows the person's initials over the gradient (PRD Phase 2: Members columns). */
  name?: string;
  className?: string;
};

/** "Ana Wijaya" → "AW"; one name → its first two letters. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** The one avatar used app-wide: the person's photo, else a deterministic mesh gradient. */
export function MemberAvatar({ seed, src, size = 34, radius = "9999px", name, className }: Props) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary external avatar URLs
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 object-cover", className)}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden", className)}
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {/* The library blurs the canvas edge; scaling pushes that rim outside the clip. */}
      <GradientAvatar seed={seed} size={size} radius={radius} pattern="mesh" className="[&>canvas]:scale-125" />
      {name && (
        <span className="absolute inset-0 flex items-center justify-center font-semibold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.35)]" style={{ fontSize: Math.max(8, Math.round(size * 0.4)) }}>
          {initialsOf(name)}
        </span>
      )}
    </span>
  );
}
