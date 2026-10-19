"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { FluidRoot } from "@/components/fluid-root";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    // Follows the OS by default; each viewer can pick light or dark from the
    // account menu (saved in localStorage by next-themes).
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="odama-theme"
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <FluidRoot>{children}</FluidRoot>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
