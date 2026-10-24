"use client";
import { useRef, useState } from "react";
import Link, { useArtist } from "@/lib/artist";
import { draftPath } from "@/schema/drafts";
import { BAND_TIME_ZONE } from "@/lib/timezone";
import { ErrorBox, useCommand } from "@/components/ui";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useCollection } from "@/lib/firestore-hooks";
import { ConfigurationPicker, Flagged, PitchDates, PitchDatesEditor, StatusChip, completeDates, datesProblem, type DateRow, type PitchRow } from "@/components/booking/common";
import { fmtPitchDate, isActive, sortedDates, todayStr } from "@/lib/booking";
import type { Comment, User } from "@/schema";

type Stamp = { toMillis(): number };
const ms = (t?: unknown) => (t as Stamp | undefined)?.toMillis?.() ?? 0;
const when = (t?: unknown) => (ms(t) ? new Date(ms(t)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: BAND_TIME_ZONE }) : "");

/**
 * The Pitch part of a venue page. One open pitch at most: empty (add to the Pitch List), or a card with its configuration, dates, comments,
 * Edit pitch, Abandon and "Booked it!". Pitches that ended (booked, declined, dropped) sit underneath as Past pitches.
 */
export function VenuePitch({ venueId, pitches }: { venueId: string; pitches: PitchRow[] }) {
  const open = pitches.find((p) => isActive(p.status));
  const past = pitches.filter((p) => !isActive(p.status) && (p.status === "booked" || p.status === "declined" || p.status === "dropped"));
  return (
    <div className="grid gap-3" data-testid="venue-pitch">
      <span className="lbl">Pitch</span>
      <div className={open ? "card hi" : "card"} data-testid="venue-pitch-card">
        {open ? <OpenPitch key={open.id} p={open} /> : (
          <Flagged kind="venue" id={venueId} pitches={pitches} big>{(flag, form) => (<>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="s" data-testid="not-on-pitch-list">Not on the pitch list.</span>{flag}</div>
            {form}
          </>)}</Flagged>
        )}
        {past.length > 0 && (
          <div className={open ? "grid gap-2 border-t border-line pt-3" : "grid gap-2"} data-testid="past-pitches">
            <span className="lbl">Past pitches ({past.length})</span>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="s text-left"><th className="py-1 pr-3">Configuration</th><th className="py-1 pr-3">Dates</th><th className="py-1 pr-3">Outcome</th><th className="py-1 text-right">Comments</th></tr></thead>
                <tbody>{past.map((p) => <PastRow key={p.id} p={p} />)}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PastRow({ p }: { p: PitchRow }) {
  const { doc: artist } = useArtist();
  const comments = useCollection<Comment>(`pitches/${p.id}/comments`).rows;
  const config = artist?.configurations.find((c) => c.id === p.pitchedAs)?.name ?? "Not sure yet";
  const show = p.status === "booked" || p.showIds.length > 0;
  return (
    <tr className="border-t border-line" data-testid={`past-pitch-${p.id}`}>
      <td className="py-2 pr-3 whitespace-nowrap"><Link href={`/booking/pitches/${p.id}`} className="font-semibold" data-testid={`pitch-link-${p.id}`}>{config}</Link></td>
      <td className="py-2 pr-3">{sortedDates(p.dates).map(fmtPitchDate).join(", ") || "—"}</td>
      <td className="py-2 pr-3 whitespace-nowrap"><span className={show ? "chip g" : "chip"}>{show ? "Became a show" : "Abandoned"}</span></td>
      <td className="py-2 text-right">{comments?.length ?? ""}</td>
    </tr>
  );
}

function OpenPitch({ p }: { p: PitchRow }) {
  const { doc: artist } = useArtist();
  const { call, error, busy, setError } = useCommand();
  const users = useCollection<User>("users").rows ?? [];
  const comments = (useCollection<Comment>(`pitches/${p.id}/comments`).rows ?? []).slice().sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  const [edit, setEdit] = useState(false);
  const [cfg, setCfg] = useState("");
  const [rows, setRows] = useState<DateRow[]>([]);
  const draft = useDraft(draftPath.newUnder("pitches", p.id, "comments"), { text: "" }, { title: (v) => `Comment on ${p.target.name}: ${v.text.slice(0, 40)}` });
  const commentId = useRef(newMutationId());
  const config = artist?.configurations.find((c) => c.id === p.pitchedAs)?.name;
  const problem = datesProblem(rows);

  function openEdit() { setCfg(p.pitchedAs ?? ""); setRows(sortedDates(p.dates).map((d) => ({ ...d }))); setError(null); setEdit(true); }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (problem) return;
    if (await call("pitches.update", { id: p.id, patch: { pitchedAs: cfg || null, dates: completeDates(rows) } })) setEdit(false);
  }
  async function post() {
    await draft.settle();
    const r = await call("pitches.comment", { id: p.id, body: draft.value.text }, { clientMutationId: commentId.current, clearDraft: draft.draftId });
    if (r) { await draft.clear({ reset: true }); commentId.current = newMutationId(); }
  }
  async function abandon() {
    if (confirm("Abandon this pitch? It moves to Past pitches.")) await call("pitches.move", { id: p.id, status: "dropped" });
  }
  async function remove() {
    if (confirm("Take this off the Pitch List?")) await call("pitches.remove", { id: p.id });
  }

  if (edit) {
    return (
      <form className="grid gap-3" onSubmit={save} data-testid="pitch-edit-form">
        <div className="md:max-w-xs"><ConfigurationPicker value={cfg} onChange={setCfg} testid="pitch-edit-config" /></div>
        <PitchDatesEditor rows={rows} onChange={setRows} testid="pitch-edit-dates" />
        {problem && <span className="note s" data-testid="pitch-edit-problem">{problem}</span>}
        <ErrorBox error={error} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn danger sm" onClick={remove} disabled={busy} data-testid="pitch-remove">Remove from pitch list</button>
          <span className="flex-1" />
          <button type="button" className="btn ghost" onClick={() => setEdit(false)} data-testid="pitch-edit-cancel">Cancel</button>
          <button type="submit" className="btn acc" disabled={busy || !!problem} data-testid="pitch-edit-save">Save pitch</button>
        </div>
      </form>
    );
  }
  return (
    <div className="grid gap-3" data-testid="pitch-open">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)] md:gap-x-8">
          <div className="grid gap-1"><span className="lbl">Configuration</span><b data-testid="pitch-config">{config ?? "Not sure yet"}</b></div>
          <div className="grid gap-1"><span className="lbl">Dates</span>
            {(p.dates ?? []).length ? <PitchDates dates={p.dates} today={todayStr()} testid="pitch-dates-summary" /> : <span className="s">None yet</span>}
          </div>
        </div>
        <div className="flex items-center gap-2"><StatusChip status={p.status} /><button className="btn ghost sm" onClick={openEdit} data-testid="pitch-edit">Edit pitch</button></div>
      </div>

      <div className="grid gap-2 border-t border-line pt-3" data-testid="pitch-comments">
        <span className="lbl">Comments ({comments.length})</span>
        {comments.map((c) => {
          const who = users.find((u) => u.id === c.authorId)?.name ?? "Someone";
          return (
            <div key={c.id} className="flex items-start gap-2" data-testid="pitch-comment">
              <span className="avatar" aria-hidden>{who.charAt(0).toUpperCase()}</span>
              <div className="grid min-w-0 flex-1 gap-0.5 rounded-xl border border-line bg-panel px-3 py-2">
                <span className="s"><b className="text-ink">{who}</b>{when(c.createdAt) && ` · ${when(c.createdAt)}`}</span>
                <p className="m-0 whitespace-pre-wrap">{c.body}</p>
              </div>
            </div>
          );
        })}
        {draft.ready && (
          <form className="grid gap-1" onSubmit={(e) => { e.preventDefault(); void post(); }}>
            <div className="flex gap-2">
              <input className="input" placeholder="Add a comment…" aria-label="Add a comment" value={draft.value.text} onChange={(e) => draft.setValue({ text: e.target.value })} data-testid="pitch-comment-input" />
              <button className="btn acc" disabled={busy || !draft.value.text.trim()} data-testid="pitch-comment-send">Post</button>
            </div>
            <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
          </form>
        )}
      </div>

      <ErrorBox error={error} />
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button className="btn danger" onClick={abandon} disabled={busy} data-testid="pitch-abandon">Abandon pitch</button>
        <span className="flex-1" />
        <Link href={`/booking/pitches/${p.id}`} className="s font-semibold underline" data-testid="pitch-open-full">Open pitch</Link>
        <Link href={`/shows/new?pitch=${p.id}`} className="btn acc" data-testid="booked-it">Booked it!</Link>
      </div>
    </div>
  );
}
