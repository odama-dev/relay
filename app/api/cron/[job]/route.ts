import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { JOBS, runJob, type JobName } from "@/lib/jobs";

/**
 * Scheduled job endpoint, called by Vercel Cron (vercel.json, UTC) or the VPS cron with
 * `Authorization: Bearer $CRON_SECRET` (docs/VPS_DEPLOY.md).
 */
async function handle(request: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  const expected = env.cronSecret ? Buffer.from(`Bearer ${env.cronSecret}`) : null;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  if (!expected || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { job } = await params;
  if (!(job in JOBS)) return NextResponse.json({ error: `Unknown job. Jobs: ${Object.keys(JOBS).join(", ")}` }, { status: 404 });
  const res = await runJob(job as JobName);
  return NextResponse.json(res, { status: res.ok ? 200 : 500 });
}

export const GET = handle;
export const POST = handle;
