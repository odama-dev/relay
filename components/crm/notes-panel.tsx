"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { NoteTarget, NoteView } from "@/lib/crm/queries";
import { formatDateTime, formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MemberAvatar } from "@/components/member-avatar";
import { RowActions } from "@/components/row-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/states";
import { addNote, deleteNote, editNote } from "@/app/(app)/sales/crm-actions";

/**
 * A notes timeline (Sales CRM): write at the top, newest first below.
 * Authors edit and delete their own; everyone with the Sales module adds.
 */
export function NotesPanel({
  target,
  notes,
  canWrite,
  timeZone,
  onChanged,
}: {
  target: NoteTarget;
  notes: NoteView[];
  canWrite: boolean;
  timeZone: string;
  /** Called after a change, for views that don't re-render on `router.refresh()` (the client panel). */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [removing, setRemoving] = useState<NoteView | null>(null);

  const save = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    const res = await addNote({ ...target, body: draft });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    setDraft("");
    router.refresh();
    onChanged?.();
  };

  const saveEdit = async () => {
    if (!editing) return;
    const res = await editNote(editing.id, { body: editing.body });
    if (!res.ok) return void toast.error(res.error);
    setEditing(null);
    router.refresh();
    onChanged?.();
  };

  return (
    <div className="flex flex-col gap-4">
      {canWrite && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Textarea
            aria-label="New note"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
            }}
            placeholder="Call notes, next steps, what the client asked for…"
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
              {busy ? "Saving…" : "Add note"}
            </Button>
          </div>
        </form>
      )}
      {notes.length === 0 ? (
        <EmptyState
          icon="chat"
          title="No notes yet"
          description={canWrite ? "Keep what you learn from calls and emails here, for the whole team." : "Notes from Sales appear here."}
        />
      ) : (
        <ul className="flex flex-col">
          {notes.map((n) => (
            <li key={n.id} className="flex gap-3 border-b py-3 last:border-b-0">
              <MemberAvatar seed={n.author?.id ?? n.id} name={n.author?.name ?? "Former member"} size={28} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2 text-caption">
                  <span className="font-medium">{n.author?.name ?? "Former member"}</span>
                  <span className="text-muted-foreground" title={formatDateTime(n.createdAt, timeZone)}>
                    {formatRelative(n.createdAt)}
                    {n.edited && " · edited"}
                    {n.context && ` · on ${n.context}`}
                  </span>
                  {n.mine && editing?.id !== n.id && (
                    <span className="ml-auto">
                      <RowActions
                        label="Note actions"
                        actions={[
                          {
                            label: "Edit",
                            icon: "edit",
                            onSelect: () => setEditing({ id: n.id, body: n.body }),
                          },
                          {
                            label: "Delete",
                            icon: "delete",
                            destructive: true,
                            onSelect: () => setRemoving(n),
                          },
                        ]}
                      />
                    </span>
                  )}
                </div>
                {editing?.id === n.id ? (
                  <div className="flex flex-col gap-2">
                    <Textarea
                      aria-label="Edit note"
                      rows={3}
                      value={editing.body}
                      onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <Button type="button" size="sm" variant="tertiary" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                      <Button type="button" size="sm" disabled={!editing.body.trim()} onClick={() => void saveEdit()}>
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-body whitespace-pre-wrap break-words">{n.body}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Delete this note?"
        description="It's removed for everyone."
        confirmLabel="Delete note"
        cancelLabel="Keep it"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          const res = await deleteNote(removing.id);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          setRemoving(null);
          router.refresh();
          onChanged?.();
        }}
      />
    </div>
  );
}
