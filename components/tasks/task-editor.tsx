"use client";

import { useEffect, useId, useRef } from "react";
import { Extension } from "@tiptap/core";
import { EditorContent, useEditor, BubbleMenu, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { toast } from "sonner";
import { Icon, type IconName } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { detectEmbed, isSafeUrl } from "@/lib/tasks/embeds";
import { EMPTY_DOC } from "@/lib/tasks/content";
import { TaskEmbed, insertEmbed } from "./task-embed-node";
import { SlashCommand } from "./task-slash-command";

export type SaveState = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_DEBOUNCE_MS = 800;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Carries the "pick an image" callback so the slash menu can open the file dialog. */
const TaskImage = Extension.create<{ pick: (() => void) | null }, { pick: (() => void) | null }>({
  name: "taskImage",
  addOptions: () => ({ pick: null }),
  addStorage() {
    return { pick: this.options.pick };
  },
});

async function uploadImage(taskId: string, file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  if (file.size > MAX_IMAGE_BYTES) {
    toast.error("Images can be at most 10 MB.");
    return null;
  }
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`/api/tasks/${taskId}/images`, { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { src?: string; error?: string };
  if (!res.ok || !json.src) {
    toast.error(json.error ?? "Couldn't upload the image.");
    return null;
  }
  return json.src;
}

/**
 * Task description (M2.5): bold, italic, underline, strikethrough, headings,
 * lists, checklist, link, quote, code and images. Stored as Tiptap JSON,
 * autosaved after a short pause.
 */
export function TaskEditor({
  taskId,
  content,
  editable,
  onSave,
  onSaveStateChange,
}: {
  taskId: string;
  content: unknown;
  editable: boolean;
  onSave: (content: unknown) => Promise<boolean>;
  onSaveStateChange?: (state: SaveState) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContent = useRef<unknown>(null);
  const editorRef = useRef<Editor | null>(null);
  const fileInputId = useId();

  const insertFiles = async (files: File[], pos?: number) => {
    for (const file of files) {
      const src = await uploadImage(taskId, file);
      const editor = editorRef.current;
      if (!src || !editor) continue;
      const chain = editor.chain().focus();
      (pos !== undefined ? chain.insertContentAt(pos, { type: "image", attrs: { src } }) : chain.setImage({ src })).run();
    }
  };

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, autolink: true, protocols: ["http", "https"], validate: (href) => isSafeUrl(href) }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ HTMLAttributes: { class: "rounded-lg max-w-full" } }),
      Placeholder.configure({ placeholder: "Write the brief: goal, requirements, references… Type / for blocks." }),
      TaskEmbed,
      TaskImage.configure({ pick: () => document.getElementById(fileInputId)?.click() }),
      ...(editable ? [SlashCommand] : []),
    ],
    content: content ?? EMPTY_DOC,
    editorProps: {
      attributes: { class: "prose-sm max-w-none focus:outline-none min-h-32" },
      handlePaste: (_view, event) => {
        const images = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (images.length) {
          event.preventDefault();
          void insertFiles(images);
          return true;
        }
        const text = event.clipboardData?.getData("text/plain")?.trim();
        if (!text || !isSafeUrl(text) || !detectEmbed(text)) return false;
        event.preventDefault();
        insertEmbed(editorRef.current!, text);
        return true;
      },
      handleDrop: (view, event) => {
        const images = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!images.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void insertFiles(images, pos);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      pendingContent.current = editor.getJSON();
      onSaveStateChange?.("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), AUTOSAVE_DEBOUNCE_MS);
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  async function flush() {
    if (pendingContent.current == null) return;
    const ok = await onSave(pendingContent.current);
    onSaveStateChange?.(ok ? "saved" : "error");
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);

  if (!editor) return null;

  return (
    <div className="flex flex-col">
      {editable && (
        <>
          <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }}>
            <Toolbar editor={editor} />
          </BubbleMenu>
          <input
            id={fileInputId}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            hidden
            onChange={(e) => {
              void insertFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const items: { icon: IconName; label: string; onClick: () => void; active: boolean }[] = [
    { icon: "bold", label: "Bold", onClick: () => editor.chain().focus().toggleBold().run(), active: editor.isActive("bold") },
    { icon: "italic", label: "Italic", onClick: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive("italic") },
    { icon: "underline", label: "Underline", onClick: () => editor.chain().focus().toggleUnderline().run(), active: editor.isActive("underline") },
    { icon: "strikethrough", label: "Strikethrough", onClick: () => editor.chain().focus().toggleStrike().run(), active: editor.isActive("strike") },
    { icon: "code", label: "Inline code", onClick: () => editor.chain().focus().toggleCode().run(), active: editor.isActive("code") },
  ];

  const setLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "");
    if (url === null) return;
    if (url === "") editor.chain().focus().unsetLink().run();
    else if (isSafeUrl(url)) editor.chain().focus().setLink({ href: url }).run();
  };

  return (
    <div className="bg-popover flex items-center gap-0.5 rounded-lg border p-1 shadow-md">
      {items.map((item) => (
        <Button
          key={item.label}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={item.label}
          aria-pressed={item.active}
          className={cn(item.active && "bg-accent")}
          onClick={item.onClick}
        >
          <Icon name={item.icon} size={15} />
        </Button>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Link"
        aria-pressed={editor.isActive("link")}
        className={cn(editor.isActive("link") && "bg-accent")}
        onClick={setLink}
      >
        <Icon name="link" size={15} />
      </Button>
    </div>
  );
}
