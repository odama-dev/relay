import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { asUser, getCurrentUser } from "@/lib/auth";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, putFile } from "@/lib/storage";
import { TASK_IMAGE_PREFIX } from "@/lib/tasks/content";

/**
 * Upload an image into a task description (M2.5). Only people who may edit
 * the task (RLS: app.can_edit_task) can upload; max 10 MB, images only.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params;

  const task = await asUser(user, async (tx) => {
    const t = await tx.task.findUnique({ where: { id }, select: { projectId: true } }).catch(() => null);
    if (!t) return null;
    const [row] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT app.can_edit_task(${id}::uuid) AS ok`;
    return row?.ok ? t : null;
  });
  if (!task) return NextResponse.json({ error: "You can't edit this task." }, { status: 403 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file." }, { status: 400 });
  const ext = IMAGE_TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Upload a PNG, JPEG, GIF or WebP image." }, { status: 415 });
  if (file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Images can be at most 10 MB." }, { status: 413 });

  const key = `${task.projectId}/${id}/${randomUUID()}.${ext}`;
  await putFile("task-images", key, Buffer.from(await file.arrayBuffer()), file.type);
  return NextResponse.json({ src: `${TASK_IMAGE_PREFIX}${key}` });
}
