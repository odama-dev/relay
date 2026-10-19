"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { Icon } from "@/components/icon";

/** Toasts on a Fluid floating surface (surface 6 + its shadow), Untitled UI icons, following the theme. */
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      className="toaster group"
      icons={{
        success: <Icon name="success" size={16} />,
        info: <Icon name="info" size={16} />,
        warning: <Icon name="warning" size={16} />,
        error: <Icon name="error" size={16} />,
        loading: <Icon name="refresh" size={16} className="animate-spin motion-reduce:animate-none" />,
      }}
      style={
        {
          "--normal-bg": "var(--surface-6)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "transparent",
          "--border-radius": "12px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "shadow-surface-6! text-[length:var(--fs-body,13px)]!",
          description: "text-muted-foreground!",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
