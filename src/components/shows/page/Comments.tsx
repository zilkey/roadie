"use client";
import { useState } from "react";
import { useCollection } from "@/lib/firestore-hooks";
import { useProfile } from "@/lib/auth";
import { useCommand, ErrorBox } from "@/components/ui";
import { fmtLong } from "@/lib/shows";
import { dateInBandZone } from "@/lib/timezone";
import type { Comment } from "@/schema/pitches";
import { useBand, type ShowRow } from "../common";
import { AutoGrowTextarea, ShowCard, initials } from "./kit";

type Stamp = { toDate(): Date; toMillis(): number };
const ms = (t: unknown) => (t as Stamp | undefined)?.toMillis?.() ?? 0;
const dayOf = (t: unknown) => { const d = (t as Stamp | undefined)?.toDate?.(); return d ? fmtLong(dateInBandZone(d)) : ""; };

/** Comments: always at the bottom of every tab. Admins read all; members read only the ones for the band. */
export function Comments({ show, admin }: { show: ShowRow; admin: boolean }) {
  const { uid } = useProfile();
  const { musicians } = useBand();
  const rows = useCollection<Comment>(`shows/${show.id}/comments`, { where: admin ? [] : [["audience", "==", "band"]] }).rows;
  const comments = (rows ?? []).slice().sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  const nameOf = (authorId: string) => musicians.find((m) => m.userId === authorId)?.name ?? "Someone";

  const post = useCommand();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    if (await post.call("shows.comment", { id: show.id, body })) setDraft("");
  }

  return (
    <ShowCard title="Comments" testid="comments" aside={<span className="s" data-testid="comments-count">{comments.length}</span>}>
      {comments.map((c) => c.id === editing
        ? <EditRow key={c.id} showId={show.id} c={c} name={nameOf(c.authorId)} onDone={() => setEditing(null)} />
        : (
          <div key={c.id} className="flex gap-3" data-testid="comment" data-id={c.id}>
            <span className="avatar" aria-hidden>{initials(nameOf(c.authorId))}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="s"><b>{nameOf(c.authorId)}</b> · {dayOf(c.createdAt)}{!c.audience && <> · <span data-testid="comment-from-pitch">From the pitch</span></>}</span>
              <span className="whitespace-pre-line break-words" data-testid="comment-body">{c.body}</span>
              {c.authorId === uid && <div><button type="button" className="card-edit" style={{ padding: 0 }} onClick={() => setEditing(c.id)} data-testid="comment-edit">Edit</button></div>}
            </div>
          </div>
        ))}
      <div className="flex flex-col gap-2">
        <label htmlFor={`comment-new-${show.id}`} className="sr-only">Add a comment</label>
        <AutoGrowTextarea id={`comment-new-${show.id}`} placeholder="Write a comment…" value={draft} onChange={setDraft} data-testid="comment-input" />
        <ErrorBox error={post.error} />
        <div className="flex justify-end">
          <button type="button" className="btn acc" disabled={!draft.trim() || post.busy} onClick={() => void send()} data-testid="comment-post">Post</button>
        </div>
      </div>
    </ShowCard>
  );
}

function EditRow({ showId, c, name, onDone }: { showId: string; c: { id: string; body: string; createdAt?: unknown }; name: string; onDone(): void }) {
  const cmd = useCommand();
  const [body, setBody] = useState(c.body);
  async function save() {
    if (!body.trim()) return;
    if (await cmd.call("shows.editComment", { id: showId, commentId: c.id, body: body.trim() })) onDone();
  }
  async function remove() {
    if (!window.confirm("Delete this comment?")) return;
    if (await cmd.call("shows.removeComment", { id: showId, commentId: c.id })) onDone();
  }
  return (
    <div className="flex gap-3 rounded-xl p-3" style={{ background: "var(--accent-soft)" }} data-testid="comment-editing">
      <span className="avatar" aria-hidden>{initials(name)}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="s"><b>{name}</b> · {dayOf(c.createdAt)} · editing</span>
        <label htmlFor={`comment-edit-${c.id}`} className="sr-only">Edit comment</label>
        <AutoGrowTextarea id={`comment-edit-${c.id}`} value={body} onChange={setBody} data-testid="comment-edit-input" />
        <ErrorBox error={cmd.error} />
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="link" style={{ color: "var(--danger)", minHeight: 44 }} disabled={cmd.busy} onClick={() => void remove()} data-testid="comment-delete">Delete</button>
          <div className="flex gap-2">
            <button type="button" className="btn outline" disabled={cmd.busy} onClick={onDone} data-testid="comment-cancel">Cancel</button>
            <button type="button" className="btn acc" disabled={cmd.busy || !body.trim()} onClick={() => void save()} data-testid="comment-save">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
