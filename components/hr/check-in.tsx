"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AttendanceStatus } from "@prisma/client";
import { PillSelect } from "@/components/pill-select";
import { checkIn } from "@/app/(app)/hr/actions";

const OPTIONS: { value: AttendanceStatus | "none"; label: string }[] = [
  { value: "none", label: "Not checked in" },
  { value: "present", label: "In office today" },
  { value: "remote", label: "Remote today" },
  { value: "off", label: "Off today" },
];

/**
 * Today's attendance (PRD Phase 2): "working today" comes from this
 * check-in, not from logged hours.
 */
export function CheckIn({ status }: { status: AttendanceStatus | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <PillSelect
      ariaLabel="Today's attendance"
      value={status ?? "none"}
      options={status ? OPTIONS.filter((o) => o.value !== "none") : OPTIONS}
      className={pending ? "opacity-60" : undefined}
      onChange={(v) => {
        if (v === "none") return;
        start(async () => {
          const res = await checkIn({ status: v });
          if (!res.ok) return void toast.error(res.error);
          router.refresh();
        });
      }}
    />
  );
}
