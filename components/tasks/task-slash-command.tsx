"use client";

import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Icon, type IconName } from "@/components/icon";
import { cn } from "@/lib/utils";
import { isSafeUrl } from "@/lib/tasks/embeds";
import { insertEmbed } from "./task-embed-node";

/**
 * Notion-style `/` block menu for the task description (M2.5): headings,
 * lists, checklist, quote, code, link, image and embeds.
 */

type CommandItem = {
  title: string;
  icon: IconName;
  run: (editor: Editor, range: Range) => void;
};

const ITEMS: CommandItem[] = [
  {
    title: "Text",
    icon: "text",
    run: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    title: "Heading 1",
    icon: "heading",
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
  },
  {
    title: "Heading 2",
    icon: "heading",
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
  },
  {
    title: "Heading 3",
    icon: "heading",
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
  },
  {
    title: "Bulleted list",
    icon: "list",
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    icon: "numberedList",
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: "Checklist",
    icon: "checklist",
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: "Quote",
    icon: "quote",
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: "Code block",
    icon: "code",
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: "Image",
    icon: "image",
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      (editor.storage as { taskImage?: { pick?: () => void } }).taskImage?.pick?.();
    },
  },
  {
    title: "Divider",
    icon: "divider",
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: "Link",
    icon: "link",
    run: (editor, range) => {
      const url = window.prompt("Link URL");
      editor.chain().focus().deleteRange(range).run();
      if (url && isSafeUrl(url)) {
        editor.chain().focus().insertContent(url).setTextSelection({
          from: editor.state.selection.from - url.length,
          to: editor.state.selection.from,
        }).setLink({ href: url }).run();
      }
    },
  },
  {
    title: "Embed",
    icon: "embed",
    run: (editor, range) => {
      const url = window.prompt("Paste a Figma, YouTube, Loom or Google Docs URL");
      editor.chain().focus().deleteRange(range).run();
      if (url && isSafeUrl(url)) insertEmbed(editor, url);
    },
  },
];

type MenuHandle = { onKeyDown: (e: KeyboardEvent) => boolean };

const CommandMenu = forwardRef<
  MenuHandle,
  { items: CommandItem[]; command: (item: CommandItem) => void }
>(function CommandMenu({ items, command }, ref) {
  const [selected, setSelected] = useState(0);

  useEffect(() => setSelected(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (e: KeyboardEvent) => {
      if (items.length === 0) return false;
      if (e.key === "ArrowDown") {
        setSelected((i) => (i + 1) % items.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        setSelected((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (e.key === "Enter") {
        command(items[selected]);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="bg-popover text-muted-foreground w-56 rounded-lg border p-2 text-body shadow-md">
        No matching blocks
      </div>
    );
  }

  return (
    <div className="bg-popover w-56 rounded-lg border p-1 shadow-md">
      {items.map((item, i) => (
        <button
          key={item.title}
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body",
            i === selected ? "bg-accent" : "hover:bg-accent/60",
          )}
          onMouseEnter={() => setSelected(i)}
          onClick={() => command(item)}
        >
          <Icon name={item.icon} size={15} className="text-muted-foreground" />
          {item.title}
        </button>
      ))}
    </div>
  );
});

const suggestion: Omit<SuggestionOptions<CommandItem>, "editor"> = {
  char: "/",
  items: ({ query }) =>
    ITEMS.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())),
  command: ({ editor, range, props }) => {
    props.run(editor, range);
  },
  render: () => {
    let component: ReactRenderer<MenuHandle, { items: CommandItem[]; command: (item: CommandItem) => void }>;
    let element: HTMLElement;

    return {
      onStart: (props) => {
        component = new ReactRenderer(CommandMenu, {
          props: { items: props.items, command: (item: CommandItem) => props.command(item) },
          editor: props.editor,
        });
        element = component.element as HTMLElement;
        element.style.position = "absolute";
        element.style.zIndex = "50";
        document.body.appendChild(element);
        positionAt(element, props.clientRect?.());
      },
      onUpdate: (props) => {
        component.updateProps({ items: props.items, command: (item: CommandItem) => props.command(item) });
        positionAt(element, props.clientRect?.());
      },
      onKeyDown: (props) => {
        if (props.event.key === "Escape") {
          component.destroy();
          element.remove();
          return true;
        }
        return component.ref?.onKeyDown(props.event) ?? false;
      },
      onExit: () => {
        component.destroy();
        element.remove();
      },
    };
  },
};

function positionAt(element: HTMLElement, rect: DOMRect | null | undefined) {
  if (!rect) return;
  element.style.left = `${rect.left + window.scrollX}px`;
  element.style.top = `${rect.bottom + window.scrollY + 4}px`;
}

export const SlashCommand = Extension.create({
  name: "slashCommand",
  addOptions() {
    return { suggestion };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
