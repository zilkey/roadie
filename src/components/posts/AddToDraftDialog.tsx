"use client";
import { useEffect, useState } from "react";
import { Dialog, ErrorBox, useCommand } from "@/components/ui";
import { runCommand } from "@/lib/commands";

import { postKind } from "@/lib/photos";

/** A draft as posts.list returns it (the fields the dialog needs). */
export interface DraftRow { id: string; title?: string; status: string; count: number; videos: number; driveFolderId?: string }

/**
 * Add to carousel draft: the picked photos and videos go into a new draft (by name) or the end of an existing one. Either way they move
 * in Drive, which the dialog says before anything happens. Only drafts with their own folder that are a draft or failed
 * can take photos. `onDone` gets the draft's id.
 */
export function AddToDraftDialog({ open, onClose, driveFileIds, onDone }: {
  open: boolean; onClose(): void; driveFileIds: string[]; onDone(id: string): void;
}) {
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  const [pick, setPick] = useState<string>("new");
  const [title, setTitle] = useState("");
  const { call, error, busy, setError } = useCommand();

  useEffect(() => {
    if (!open) return;
    setPick("new"); setTitle(""); setError(null);
    runCommand<{ drafts: DraftRow[] }>("posts.list", {}).then(
      (r) => setDrafts(r.drafts.filter((d) => d.driveFolderId && (d.status === "draft" || d.status === "failed"))),
      () => setDrafts([]),
    );
  }, [open, setError]);

  const existing = drafts?.find((d) => d.id === pick);
  const room = existing ? 10 - existing.count : 10;
  const tooMany = driveFileIds.length > room;
  const name = existing ? existing.title ?? "Untitled" : title.trim();
  const n = driveFileIds.length;

  async function go() {
    if (existing) {
      const r = await call<{ count: number }>("posts.addToDraft", { id: existing.id, driveFileIds });
      if (r) onDone(existing.id);
    } else {
      const r = await call<{ id: string; folderName: string }>("posts.createDraft", { title: name, driveFileIds });
      if (r) onDone(r.id);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add to carousel draft" testid="add-to-draft">
      <fieldset className="grid gap-2 border-0 p-0">
        <legend className="sr-only">Which draft</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="draft" checked={pick === "new"} onChange={() => setPick("new")} data-testid="add-to-draft-new" />
          New draft
        </label>
        {pick === "new" && (
          <input className="input" autoFocus placeholder="Name it, e.g. Hi-Dive announcement" maxLength={100} value={title}
            onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name && !busy) void go(); }}
            aria-label="Draft name" data-testid="add-to-draft-title" />
        )}
        {(drafts ?? []).map((d) => (
          <label key={d.id} className="flex items-center gap-2">
            <input type="radio" name="draft" checked={pick === d.id} onChange={() => setPick(d.id)} data-testid={`add-to-draft-${d.id}`} />
            <span className="min-w-0 flex-1 truncate">{d.title ?? "Untitled"}</span>
            <span className="s">{postKind(d.count, d.videos)}</span>
          </label>
        ))}
      </fieldset>
      <p className="s m-0" data-testid="add-to-draft-note">
        {n === 1 ? "It moves" : `The ${n} you picked move`} in Drive to <b>Posts/DRAFT - {name || "<name>"}</b>, out of the inbox.
        Taking one out of the draft puts it back.
      </p>
      {tooMany && <p className="err m-0" data-testid="add-to-draft-full">A post holds at most 10 photos and videos{existing ? `; this one has room for ${room}` : ""}.</p>}
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn ghost" onClick={onClose} data-testid="add-to-draft-cancel">Cancel</button>
        <button type="button" className="btn" disabled={busy || !name || tooMany} onClick={() => void go()} data-testid="add-to-draft-go">
          {busy ? "Moving…" : existing ? `Add to ${name}` : "Make the draft"}
        </button>
      </div>
    </Dialog>
  );
}
