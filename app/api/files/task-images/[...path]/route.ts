import { NextResponse, type NextRequest } from "next/server";
import { asUser, getCurrentUser } from "@/lib/auth";
import { getFile, IMAGE_TYPES, signedUrl } from "@/lib/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Serves a task image only to people who can read the task (RLS), via a
 * 60-second signed URL. The bucket itself is private (M2 DoD: non-members
 * can't read images, through the app or the storage URL).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { path } = await params;
  const [projectId, taskId, file] = path;
  if (path.length !== 3 || !UUID.test(projectId ?? "") || !UUID.test(taskId ?? "") || !/^[0-9a-f-]{36}\.[a-z]+$/.test(file ?? "")) {
    return new NextResponse("Not found", { status: 404 });
  }

  const visible = await asUser(user, (tx) => tx.task.count({ where: { id: taskId, projectId } }));
  if (!visible) return new NextResponse("Not found", { status: 404 });

  const key = path.join("/");
  const url = await signedUrl("task-images", key);
  if (url) return NextResponse.redirect(url, { headers: { "Cache-Control": "private, max-age=30" } });

  const body = await getFile("task-images", key);
  if (!body) return new NextResponse("Not found", { status: 404 });
  const ext = file!.split(".").pop()!;
  const type = Object.entries(IMAGE_TYPES).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
  return new NextResponse(new Uint8Array(body), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=300" } });
}
