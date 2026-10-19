import { z } from "zod";

/**
 * Server-side validation for the task description (M2.5). Content is a
 * Tiptap/ProseMirror JSON document — never raw HTML — so rendering always goes
 * back through Tiptap in read-only mode. This schema restricts every node and
 * mark to what the editor produces, bounds size and depth, and only accepts
 * images uploaded through the app (/api/files/task-images/…).
 */

export const TASK_CONTENT_NODE_TYPES = [
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "horizontalRule",
  "hardBreak",
  "codeBlock",
  "embed",
  "image",
] as const;

export const TASK_CONTENT_MARK_TYPES = [
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "link",
] as const;

/** Empty Tiptap document — the default value for a brand-new task's content. */
export const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] } as const;

/** ~200KB of serialized JSON is generous for a task brief and cheap to store/validate. */
const MAX_SERIALIZED_SIZE = 200_000;
const MAX_DEPTH = 20;

const markSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.enum(TASK_CONTENT_MARK_TYPES),
    attrs: z.record(z.string(), z.unknown()).optional(),
  }),
);

function nodeSchemaAtDepth(depth: number): z.ZodType<unknown> {
  if (depth > MAX_DEPTH) {
    return z.never();
  }
  return z.lazy(() =>
    z.object({
      type: z.enum(TASK_CONTENT_NODE_TYPES),
      attrs: z.record(z.string(), z.unknown()).optional(),
      marks: z.array(markSchema).optional(),
      text: z.string().optional(),
      content: z.array(nodeSchemaAtDepth(depth + 1)).optional(),
    }),
  );
}

/** Images must point at our own storage route, so nothing external is ever embedded. */
export const TASK_IMAGE_PREFIX = "/api/files/task-images/";

function imagesAreOurs(node: unknown): boolean {
  if (!node || typeof node !== "object") return true;
  const n = node as { type?: string; attrs?: { src?: unknown }; content?: unknown[] };
  if (n.type === "image") {
    const src = n.attrs?.src;
    if (typeof src !== "string" || !src.startsWith(TASK_IMAGE_PREFIX) || src.includes("..")) return false;
  }
  return (n.content ?? []).every(imagesAreOurs);
}

const docSchema = z.object({
  type: z.literal("doc"),
  content: z.array(nodeSchemaAtDepth(1)).optional(),
});

export type TaskContentValidation =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Validates a task content payload before it's persisted. Never throws. */
export function validateTaskContent(raw: unknown): TaskContentValidation {
  let size: number;
  try {
    size = JSON.stringify(raw).length;
  } catch {
    return { ok: false, error: "Content isn't valid JSON." };
  }
  if (size > MAX_SERIALIZED_SIZE) {
    return { ok: false, error: "This task's content is too large to save." };
  }

  const parsed = docSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Content contains an unsupported block or mark." };
  }
  if (!imagesAreOurs(parsed.data)) {
    return { ok: false, error: "Images must be uploaded to the task." };
  }
  return { ok: true, value: parsed.data };
}
