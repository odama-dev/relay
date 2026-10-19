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
  className?: string;
};

/** The one avatar used app-wide: the person's photo, else a deterministic mesh gradient. */
export function MemberAvatar({ seed, src, size = 34, radius = "9999px", className }: Props) {
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
    </span>
  );
}
