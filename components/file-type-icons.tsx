import type { SVGProps } from "react";

type Props = Omit<SVGProps<SVGSVGElement>, "color"> & { size?: number | string; color?: string };

/**
 * File-type glyphs (CSV, PDF) drawn on Untitled UI's 24-grid file outline —
 * the free set has none. Same props as an Untitled UI icon, so they sit in the
 * `icons` map (components/icon.tsx) and take the app's one stroke weight.
 */
function fileType(label: string, displayName: string) {
  function FileTypeIcon({ size = 24, color = "currentColor", ...props }: Props) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        stroke={color}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        <path d="M6 10V5a3 3 0 0 1 3-3h5l6 6v11a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-1" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        <rect x="1.5" y="10" width="15" height="8" rx="1.5" fill={color} stroke="none" />
        <text
          x="9"
          y="16.1"
          textAnchor="middle"
          fontSize="5.4"
          fontWeight="700"
          letterSpacing="-0.1"
          fontFamily="var(--font-sans), system-ui, sans-serif"
          stroke="none"
          className="fill-background"
        >
          {label}
        </text>
      </svg>
    );
  }
  FileTypeIcon.displayName = displayName;
  return FileTypeIcon;
}

export const FileCsv = fileType("CSV", "FileCsv");
export const FilePdf = fileType("PDF", "FilePdf");
