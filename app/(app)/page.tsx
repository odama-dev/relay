import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { homePath } from "@/components/app-shell/nav-config";

export default async function HomePage() {
  await requireUser();
  redirect(homePath());
}
