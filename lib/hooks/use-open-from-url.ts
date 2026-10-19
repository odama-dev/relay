"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/** The query flag the ⌘K palette's actions add, e.g. `/clients?create=1`. */
export const CREATE_PARAM = "create";

/**
 * Open state for a "create" dialog that the ⌘K palette can open from
 * another page: it navigates to the page with `?create=1`, and the page's
 * Add button opens its form. The flag is removed from the URL straight away
 * (history.replaceState, which Next's router picks up), so a refresh or
 * Back doesn't reopen it — and when the same button is rendered twice, only
 * the first to see the flag opens.
 */
export function useOpenFromUrl(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(CREATE_PARAM) !== "1") return;
    url.searchParams.delete(CREATE_PARAM);
    window.history.replaceState(window.history.state, "", url);
    // Syncing from an external system (the URL) and claiming the flag must
    // happen together, after commit — render can't touch history.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(true);
  }, [searchParams]);

  return [open, setOpen];
}
