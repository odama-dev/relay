"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col py-10">
      <ErrorState
        description={error.message || "An unexpected error occurred."}
        action={
          <Button variant="tertiary" size="sm" onClick={reset}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
