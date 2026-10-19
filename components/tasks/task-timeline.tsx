"use client";

import { useState, type ReactNode } from "react";
import type { ActivityView, CommentView } from "@/lib/tasks/queries";
import { mentionPattern } from "@/lib/tasks/mentions";
import {
  formatDate,
  formatDateTime,
  formatRelative,
  sentenceEnum,
} from "@/lib/format";
import { MemberAvatar } from "@/components/member-avatar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Icon, type IconName, icons } from "@/components/icon";

type Item =
  | { kind: "comment"; at: number; comment: CommentView }
  | { kind: "event"; at: number; event: ActivityView };

/** Comments are listed oldest first (M2.6), interleaved with the task history (M2.7). */
export function TaskTimeline({
  comments,
  activity,
  people,
  canComment,
  onAdd,
  onEdit,
  onDelete,
}: {
  comments: CommentView[];
  activity: ActivityView[];
  /** Project members — @mentions resolve to these names. */
  people: { id: string; name: string }[];
  canComment: boolean;
  onAdd: (text: string) => Promise<boolean>;
  onEdit: (id: string, text: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CommentView | null>(null);
  const names = new Map(people.map((p) => [p.id, p.name]));
  const pattern = mentionPattern(people.map((p) => p.name));

  // Comment edits/deletes show on the comment itself, not as separate events.
  const events = activity.filter(
    (a) => a.type !== "comment_edited" && a.type !== "comment_deleted",
  );
  const items: Item[] = [
    ...comments.map((c) => ({
      kind: "comment" as const,
      at: new Date(c.createdAt).getTime(),
      comment: c,
    })),
    ...events.map((e) => ({
      kind: "event" as const,
      at: new Date(e.createdAt).getTime(),
      event: e,
    })),
  ].sort((a, b) => a.at - b.at);

  return (
    <div className="flex flex-col gap-4">
      {items.length > 0 && (
        <ul className="flex flex-col gap-4">
          {items.map((item) =>
            item.kind === "event" ? (
              <li key={item.event.id}>
                <Event event={item.event} names={names} />
              </li>
            ) : (
              <li key={item.comment.id}>
                <Comment
                  comment={item.comment}
                  pattern={pattern}
                  editing={editingId === item.comment.id}
                  onStartEdit={() => setEditingId(item.comment.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSaveEdit={async (text) => {
                    const ok = await onEdit(item.comment.id, text);
                    if (ok) setEditingId(null);
                    return ok;
                  }}
                  onDelete={() => setDeleting(item.comment)}
                />
              </li>
            ),
          )}
        </ul>
      )}
      {canComment && (
        <Composer
          placeholder="Comment… use @ to mention a member"
          submitLabel="Comment"
          onSubmit={onAdd}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete comment?"
        description="Everyone on the task will see that you deleted a comment here."
        confirmLabel="Delete comment"
        destructive
        onConfirm={async () => (deleting ? onDelete(deleting.id) : true)}
      />
    </div>
  );
}

function highlight(text: string, pattern: RegExp | null): ReactNode[] {
  if (!pattern) return [text];
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <span
        key={start}
        className="text-mention bg-mention/10 rounded px-0.5 font-medium"
      >
        {m[0]}
      </span>,
    );
    last = start + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Bold (**x**), italic (_x_) and links, applied on top of the plain text. */
function inlineFormat(nodes: ReactNode[]): ReactNode[] {
  return nodes.flatMap((node, i) => {
    if (typeof node !== "string") return [node];
    const parts: ReactNode[] = [];
    const re = /(\*\*[^*]+\*\*|_[^_]+_|https?:\/\/[^\s)]+)/g;
    let last = 0;
    for (const m of node.matchAll(re)) {
      const s = m.index ?? 0;
      if (s > last) parts.push(node.slice(last, s));
      const t = m[0];
      if (t.startsWith("**"))
        parts.push(<strong key={`${i}-${s}`}>{t.slice(2, -2)}</strong>);
      else if (t.startsWith("_"))
        parts.push(<em key={`${i}-${s}`}>{t.slice(1, -1)}</em>);
      else
        parts.push(
          <a
            key={`${i}-${s}`}
            href={t}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2"
          >
            {t}
          </a>,
        );
      last = s + t.length;
    }
    if (last < node.length) parts.push(node.slice(last));
    return parts;
  });
}

function Comment({
  comment,
  pattern,
  editing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  comment: CommentView;
  pattern: RegExp | null;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (text: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  if (comment.deletedAt) {
    return (
      <div className="flex items-center gap-2.5">
        <span className="bg-accent text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full">
          <Icon name="delete" size={12} />
        </span>
        <p className="text-muted-foreground text-body italic">
          Comment deleted by {comment.deletedBy ?? comment.author.name} ·{" "}
          <Timestamp date={comment.deletedAt} />
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5">
      <MemberAvatar
        seed={comment.author.id}
        src={comment.author.avatarUrl}
        size={28}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-body font-medium">{comment.author.name}</span>
          <span className="text-muted-foreground text-caption">
            <Timestamp date={comment.createdAt} />
            {comment.editedAt && (
              <>
                {" · "}
                <Tooltip
                  content={<>Edited {formatDateTime(comment.editedAt)}</>}
                >
                  <span className="cursor-default">edited</span>
                </Tooltip>
              </>
            )}
          </span>
        </div>
        {editing ? (
          <div className="mt-1">
            <Composer
              initial={comment.text}
              placeholder="Edit comment…"
              submitLabel="Save"
              autoFocus
              onCancel={onCancelEdit}
              onSubmit={onSaveEdit}
            />
          </div>
        ) : (
          <>
            <p className="text-body break-words whitespace-pre-line">
              {inlineFormat(highlight(comment.text, pattern))}
            </p>
            {comment.mine && (
              <div className="mt-1 flex items-center gap-3">
                <CommentAction icon="edit" label="Edit" onClick={onStartEdit} />
                <CommentAction
                  icon="delete"
                  label="Delete"
                  onClick={onDelete}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function describe(e: ActivityView, names: Map<string, string>): ReactNode {
  const p = e.payload ?? {};
  const who = (id: unknown) =>
    typeof id === "string" ? (names.get(id) ?? "a former member") : "nobody";
  const b = (t: ReactNode) => <span className="text-foreground">{t}</span>;
  switch (e.type) {
    case "created":
      return "created the task";
    case "status_changed":
      return (
        <>
          moved it from {b(sentenceEnum(String(p.from)))} to{" "}
          {b(sentenceEnum(String(p.to)))}
        </>
      );
    case "owner_changed":
      return p.to ? <>made {b(who(p.to))} the owner</> : "removed the owner";
    case "due_date_changed":
      return p.to ? (
        <>set the due date to {b(formatDate(String(p.to)))}</>
      ) : (
        "removed the due date"
      );
    case "priority_changed":
      return <>set priority to {b(sentenceEnum(String(p.to)))}</>;
    case "renamed":
      return <>renamed it to {b(String(p.to))}</>;
    case "collaborators_changed":
      return "changed the collaborators";
    default:
      return sentenceEnum(e.type);
  }
}

function Event({
  event,
  names,
}: {
  event: ActivityView;
  names: Map<string, string>;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex w-7 shrink-0 justify-center">
        <span
          className="bg-muted-foreground/50 size-1.5 rounded-full"
          aria-hidden
        />
      </span>
      <p className="text-muted-foreground min-w-0 text-caption">
        <span className="text-foreground font-medium">{event.actor}</span>{" "}
        {describe(event, names)} · <Timestamp date={event.createdAt} />
      </p>
    </div>
  );
}

function Timestamp({ date }: { date: Date }) {
  return (
    <Tooltip content={<>{formatDateTime(date)}</>}>
      <time dateTime={new Date(date).toISOString()} className="cursor-default">
        {formatRelative(date)}
      </time>
    </Tooltip>
  );
}

function CommentAction({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded text-caption transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <Icon name={icon} size={12} />
      {label}
    </button>
  );
}

function Composer({
  initial = "",
  placeholder,
  submitLabel,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (text: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    setSubmitting(true);
    const ok = await onSubmit(text);
    setSubmitting(false);
    if (ok) setDraft("");
  };
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder.replace(/….*$/, "")}
        rows={2}
        autoFocus={autoFocus}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-caption">
          **bold**, _italic_, links · ⌘↵ to send
        </span>
        <div className="flex gap-2">
          {onCancel && (
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={submitting || draft.trim().length === 0}
            onClick={submit}
           leadingIcon={icons.send}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
