"use client";

import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { detectEmbed } from "@/lib/tasks/embeds";
import { Icon } from "@/components/icon";

/**
 * The Embed block (PRD FEATURE_Task-Detail.md §11.3). Allowlisted providers
 * render as a sandboxed iframe; everything else falls back to a bookmark
 * card — the fallback itself is embedded here, so a failed/unsupported embed
 * can never break the editor layout.
 */

function EmbedView({ node }: NodeViewProps) {
  const url: string = node.attrs.url;
  const provider: string | null = node.attrs.provider;
  const embedUrl: string | null = node.attrs.embedUrl;

  let hostname = url;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // leave hostname as the raw string
  }

  return (
    <NodeViewWrapper data-embed>
      <div className="my-2 overflow-hidden rounded-lg border" contentEditable={false}>
        {embedUrl ? (
          <div className="bg-muted aspect-video w-full">
            <iframe
              src={embedUrl}
              title={`${provider ?? "Embedded"} content`}
              className="size-full"
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
              loading="lazy"
              allowFullScreen
            />
          </div>
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:bg-accent flex items-center gap-3 p-3 text-body"
          >
            <span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-md">
              <Icon name="link" size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{hostname}</span>
              <span className="text-muted-foreground block truncate text-caption">{url}</span>
            </span>
            <Icon name="external" size={14} className="text-muted-foreground shrink-0" />
          </a>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const TaskEmbed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: { default: null },
      provider: { default: null },
      embedUrl: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-embed]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-embed": "" }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },
});

/** Inserts an embed block for `url`, resolving the allowlisted embed URL (if any). */
export function insertEmbed(editor: Editor, url: string) {
  const match = detectEmbed(url);
  editor
    .chain()
    .focus()
    .insertContent({
      type: "embed",
      attrs: { url, provider: match?.provider ?? null, embedUrl: match?.embedUrl ?? null },
    })
    .run();
}
