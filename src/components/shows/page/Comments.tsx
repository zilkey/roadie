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
  const [audience, setAudience] = useState<Audience>("admins");
  const [editing, setEditing] = useState<string | null>(null);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    if (await post.call("shows.comment", { id: show.id, body, ...(admin ? { audience } : {}) })) { setDraft(""); setAudience("admins"); }
  }

  return (
    <ShowCard title="Comments" testid="comments" aside={<span className="s" data-testid="comments-count">{comments.length}</span>}>
      {comments.map((c) => c.id === editing
        ? <EditRow key={c.id} showId={show.id} c={c} name={nameOf(c.authorId)} admin={admin} onDone={() => setEditing(null)} />
        : (
          <div key={c.id} className="flex gap-3" data-testid="comment" data-id={c.id}>
            <span className="avatar" aria-hidden>{initials(nameOf(c.authorId))}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="s"><b>{nameOf(c.authorId)}</b> · {dayOf(c.createdAt)}{!c.audience && <> · <span data-testid="comment-from-pitch">From the pitch</span></>}{admin && c.audience !== "band" && <> · <span data-testid="comment-private">Private</span></>}{c.edited && <> · <span data-testid="comment-edited">edited</span></>}</span>
              <span className="whitespace-pre-line break-words" data-testid="comment-body">{c.body}</span>
              {(c.authorId === uid || admin) && <div><button type="button" className="card-edit" style={{ padding: 0 }} onClick={() => setEditing(c.id)} data-testid="comment-edit">Edit</button></div>}
            </div>
          </div>
        ))}
      <div className="flex flex-col gap-2">
        <label htmlFor={`comment-new-${show.id}`} className="sr-only">Add a comment</label>
        <AutoGrowTextarea id={`comment-new-${show.id}`} placeholder="Write a comment…" value={draft} onChange={setDraft} data-testid="comment-input" />
        <ErrorBox error={post.error} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {admin ? <AudienceSeg name={`comment-new-audience-${show.id}`} value={audience} onChange={setAudience} testid="comment-audience" /> : <span />}
          <button type="button" className="btn acc" disabled={!draft.trim() || post.busy} onClick={() => void send()} data-testid="comment-post">Post</button>
        </div>
      </div>
    </ShowCard>
  );
}

type Audience = "admins" | "band";

/** Who reads an admin's comment: Private (admins only, the default) or the whole band. */
function AudienceSeg({ name, value, onChange, testid }: { name: string; value: Audience; onChange(a: Audience): void; testid: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Who can see it" data-testid={testid}>
      <label><input type="radio" name={name} checked={value === "admins"} onChange={() => onChange("admins")} data-testid={`${testid}-private`} />Private</label>
      <label><input type="radio" name={name} checked={value === "band"} onChange={() => onChange("band")} data-testid={`${testid}-band`} />All band members</label>
    </div>
  );
}

function EditRow({ showId, c, name, admin, onDone }: { showId: string; c: Comment & { id: string }; name: string; admin: boolean; onDone(): void }) {
  const cmd = useCommand();
  const [body, setBody] = useState(c.body);
  // Carried over from the pitch (no audience) reads as Private.
  const [audience, setAudience] = useState<Audience>(c.audience === "band" ? "band" : "admins");
  async function save() {
    if (!body.trim()) return;
    const audienceChanged = admin && audience !== (c.audience === "band" ? "band" : "admins");
    if (await cmd.call("shows.editComment", { id: showId, commentId: c.id, body: body.trim(), ...(audienceChanged ? { audience } : {}) })) onDone();
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
        {admin && <AudienceSeg name={`comment-edit-audience-${c.id}`} value={audience} onChange={setAudience} testid="comment-edit-audience" />}
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
