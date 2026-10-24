"use client";
import { useRef, useState } from "react";
import Link, { useArtist } from "@/lib/artist";
import { draftPath } from "@/schema/drafts";
import { BAND_TIME_ZONE } from "@/lib/timezone";
import { ErrorBox, Select, useCommand } from "@/components/ui";
import { useDraft } from "@/lib/drafts";
import { useAutosave } from "@/lib/autosave";
import { SaveStatus } from "@/components/SaveStatus";
import { newMutationId } from "@/lib/commands";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useCollection } from "@/lib/firestore-hooks";
import { ConfigurationPicker, Flagged, FlagIcon, PitchDates, PitchDatesField, type PitchRow } from "@/components/booking/common";
import { DetailCard, type useSingleEdit } from "@/components/booking/DetailCards";
import { fmtPitchDate, isActive, sortedDates, todayStr } from "@/lib/booking";
import { calendarInvitees } from "@/lib/shows";
import type { Comment, Musician, User } from "@/schema";

type Stamp = { toMillis(): number };
const ms = (t?: unknown) => (t as Stamp | undefined)?.toMillis?.() ?? 0;
const when = (t?: unknown) => (ms(t) ? new Date(ms(t)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: BAND_TIME_ZONE }) : "");

/** The page's single-edit controller, as much of it as this card uses (a page with more keys passes its own). */
export type PitchEdit = { is(k: "pitch"): boolean; open(k: "pitch"): void; close(): void };

const PitchIcon = ({ active }: { active: boolean }) => (
  <span className="inline-flex" style={{ color: active ? "var(--pitched)" : "var(--muted)" }}><FlagIcon filled={active} /></span>
);
const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

/**
 * The Pitch card of a venue page (private to the artist). One open pitch at most: empty (add to the Pitch List), or its configuration, dates,
 * comments, Abandon and "Booked it!"; Edit changes configuration and dates (autosaved). Pitches that ended sit underneath as Past pitches.
 */
export function VenuePitch({ venueId, pitches, edit }: { venueId: string; pitches: PitchRow[]; edit: PitchEdit }) {
  const { artistId } = useArtist();
  const mine = pitches.filter((p) => p.artistId === artistId);
  const open = mine.find((p) => isActive(p.status));
  const past = mine.filter((p) => !isActive(p.status) && (p.status === "booked" || p.status === "declined" || p.status === "dropped"));
  if (open) return <OpenPitch key={open.id} p={open} past={past} edit={edit} />;
  return (
    <DetailCard private title="Pitch" icon={<PitchIcon active={false} />} testid="venue-pitch">
      <div className="grid gap-3" data-testid="venue-pitch-card">
        <Flagged kind="venue" id={venueId} pitches={mine} label="Add to the Pitch List">{(flag, form) => (<>
          <div className="flex flex-wrap items-center justify-between gap-3"><span className="d-muted" data-testid="not-on-pitch-list">Not on the pitch list.</span>{flag}</div>
          {form}
        </>)}</Flagged>
        <PastPitches past={past} />
      </div>
    </DetailCard>
  );
}

function PastPitches({ past }: { past: PitchRow[] }) {
  if (!past.length) return null;
  return (
    <>
      <div className="d-sep" />
      <div className="grid gap-1.5" data-testid="past-pitches">
        <span className="lbl" style={{ color: "var(--muted)" }}>Past pitches ({past.length})</span>
        <div className="overflow-x-auto">
          <table className="d-tbl">
            <thead><tr><th scope="col">Configuration</th><th scope="col">Dates</th><th scope="col">Outcome</th><th scope="col" style={{ textAlign: "right" }}>Comments</th></tr></thead>
            <tbody>{past.map((p) => <PastRow key={p.id} p={p} />)}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function PastRow({ p }: { p: PitchRow }) {
  const { doc: artist } = useArtist();
  const comments = useCollection<Comment>(`pitches/${p.id}/comments`).rows;
  const config = artist?.configurations.find((c) => c.id === p.pitchedAs)?.name ?? "Not sure yet";
  const show = p.status === "booked" || p.showIds.length > 0;
  return (
    <tr data-testid={`past-pitch-${p.id}`}>
      <td className="whitespace-nowrap"><Link href={`/booking/pitches/${p.id}`} className="font-semibold" data-testid={`pitch-link-${p.id}`}>{config}</Link></td>
      <td>{sortedDates(p.dates).length ? <PitchDates dates={p.dates} today={todayStr()} /> : "—"}</td>
      <td className="whitespace-nowrap"><span className={show ? "chip g" : "chip"}>{show ? "Became a show" : "Abandoned"}</span></td>
      <td style={{ textAlign: "right" }}>{comments?.length ?? ""}</td>
    </tr>
  );
}

function OpenPitch({ p, past, edit }: { p: PitchRow; past: PitchRow[]; edit: PitchEdit }) {
  const { doc: artist } = useArtist();
  const { call, error, busy } = useCommand();
  const users = useCollection<User>("users").rows ?? [];
  const comments = (useCollection<Comment>(`pitches/${p.id}/comments`).rows ?? []).slice().sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  const [booking, setBooking] = useState(false);
  const draft = useDraft(draftPath.newUnder("pitches", p.id, "comments"), { text: "" }, { title: (v) => `Comment on ${p.target.name}: ${v.text.slice(0, 40)}` });
  const commentId = useRef(newMutationId());
  const config = artist?.configurations.find((c) => c.id === p.pitchedAs)?.name;
  const icon = <PitchIcon active />;

  async function post() {
    await draft.settle();
    const r = await call("pitches.comment", { id: p.id, body: draft.value.text }, { clientMutationId: commentId.current, clearDraft: draft.draftId });
    if (r) { await draft.clear({ reset: true }); commentId.current = newMutationId(); }
  }
  async function abandon() {
    if (confirm("Abandon this pitch? It moves to Past pitches.")) await call("pitches.move", { id: p.id, status: "dropped" });
  }

  if (booking) {
    return (
      <DetailCard private title="Pitch" icon={icon} testid="venue-pitch">
        <div data-testid="venue-pitch-card"><BookedItForm p={p} commentCount={comments.length} onCancel={() => setBooking(false)} /></div>
      </DetailCard>
    );
  }
  return (
    <DetailCard private title="Pitch" icon={icon} testid="venue-pitch" editKey="pitch" edit={edit as ReturnType<typeof useSingleEdit<"pitch">>} editTestid="pitch-edit" doneTestid="pitch-edit-save"
      editChildren={<div data-testid="venue-pitch-card"><PitchEditFields p={p} /></div>}>
      <div className="grid gap-4" data-testid="venue-pitch-card">
        <div className="grid gap-4" data-testid="pitch-open">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <b className="text-[16px]" data-testid="pitch-config">{config ?? "Not sure yet"}</b>
            <PitchDates dates={p.dates} today={todayStr()} testid="pitch-dates-summary" empty="No dates yet" busy={busy}
              onRemove={(d) => void call("pitches.update", { id: p.id, patch: { dates: sortedDates(p.dates).filter((x) => x !== d) } })} />
          </div>

          <div className="grid gap-2.5" data-testid="pitch-comments">
            <span className="lbl" style={{ color: "var(--muted)" }}>Comments ({comments.length})</span>
            {comments.map((c) => {
              const who = users.find((u) => u.id === c.authorId)?.name ?? "Someone";
              return (
                <div key={c.id} className="flex items-start gap-3" data-testid="pitch-comment">
                  <span className="avatar" aria-hidden>{who.charAt(0).toUpperCase()}</span>
                  <div className="d-bubble">
                    <span className="d-muted text-[13px]"><b className="text-ink">{who}</b>{when(c.createdAt) && ` · ${when(c.createdAt)}`}</span>
                    <p className="m-0 whitespace-pre-wrap">{c.body}</p>
                  </div>
                </div>
              );
            })}
            {draft.ready && (
              <form className="grid gap-1" style={{ paddingLeft: 40 }} onSubmit={(e) => { e.preventDefault(); void post(); }}>
                <div className="flex gap-2">
                  <input className="input min-w-0 flex-1" placeholder="Add a comment…" aria-label="Add a comment" value={draft.value.text} onChange={(e) => draft.setValue({ text: e.target.value })} data-testid="pitch-comment-input" />
                  <button className="btn acc" disabled={busy || !draft.value.text.trim()} data-testid="pitch-comment-send">Post</button>
                </div>
                <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
              </form>
            )}
          </div>

          <ErrorBox error={error} />
          <div className="d-sep" />
          <div className="flex flex-wrap items-center gap-2.5">
            <button className="btn danger" onClick={abandon} disabled={busy} data-testid="pitch-abandon">Abandon pitch</button>
            <span className="flex-1" />
            <Link href={`/booking/pitches/${p.id}`} className="d-muted text-[13px] underline" data-testid="pitch-open-full">Open pitch</Link>
            <button className="btn acc" onClick={() => setBooking(true)} disabled={busy} data-testid="booked-it"><CheckIcon />Booked it!</button>
          </div>
        </div>
        <PastPitches past={past} />
      </div>
    </DetailCard>
  );
}

/** Edit mode of the active pitch: configuration and dates save as you change them. Mounted only while editing, so it starts from the live pitch. */
function PitchEditFields({ p }: { p: PitchRow }) {
  const { call, error, busy } = useCommand();
  const as = useAutosave({ command: "pitches.update", id: p.id, rev: p.rev, title: p.target.name });
  const [cfg, setCfg] = useState(p.pitchedAs ?? "");
  const [rows, setRows] = useState<string[]>(sortedDates(p.dates));
  async function remove() {
    if (confirm("Take this off the Pitch List?")) await call("pitches.remove", { id: p.id });
  }
  return (
    <div className="grid gap-4" data-testid="pitch-edit-form">
      <div style={{ maxWidth: 280 }}>
        <ConfigurationPicker value={cfg} onChange={(id) => { setCfg(id); as.patch({ pitchedAs: id || null }); }} testid="pitch-edit-config" />
      </div>
      <PitchDatesField dates={rows} onChange={(d) => { setRows(d); as.patch({ dates: d }); }} onBlur={() => void as.flush()} testid="pitch-edit-dates" />
      <SaveStatus {...as.statusProps} />
      <ErrorBox error={error} />
      <div><button type="button" className="btn danger sm" onClick={remove} disabled={busy} data-testid="pitch-remove">Remove from pitch list</button></div>
    </div>
  );
}

/**
 * "Booked it! Turn this pitch into a show": which of the pitch's dates (or another one), the final configuration (starts as the pitch's)
 * and whether to copy the comments. Nothing happens until Create show; the pitch then moves to Past pitches as "Became a show".
 */
function BookedItForm({ p, commentCount, onCancel }: { p: PitchRow; commentCount: number; onCancel(): void }) {
  const { doc: artist } = useArtist();
  const { call, error, busy } = useCommand();
  const dates = sortedDates(p.dates);
  const [date, setDate] = useState(dates[0] ?? "other");
  const [other, setOther] = useState("");
  const [cfg, setCfg] = useState(p.pitchedAs ?? "");
  const [copy, setCopy] = useState(true);
  const musicians = useCollection<Musician>("musicians").rows ?? [];
  const users = useCollection<User>("users").rows ?? [];
  const [invite, setInvite] = useState<boolean | null>(null); // null = not touched: follows whether anyone would be invited
  const recipients = artist ? calendarInvitees(artist.configurations.find((c) => c.id === cfg)?.musicianIds ?? [], musicians, users, artist.id) : [];
  const sendInvites = recipients.length > 0 && (invite ?? true);
  const mutationId = useRef(newMutationId());
  const invalid = date === "other" && !other;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) return;
    await call("shows.create", {
      pitchId: p.id, venueId: p.target.id, date: date === "other" ? other : date, billedAs: cfg || null, sendInvites, copyPitchComments: copy && commentCount > 0,
    }, { clientMutationId: mutationId.current });
  }

  return (
    <form className="grid gap-4" onSubmit={create} aria-labelledby={`book-h-${p.id}`} data-testid="book-form">
      <div className="grid gap-1">
        <h3 id={`book-h-${p.id}`} className="m-0 text-[18px] font-bold">Booked it! Turn this pitch into a show</h3>
        <p className="d-muted m-0 text-[14px]">The pitch moves to Past pitches as “Became a show”.</p>
      </div>
      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="lbl mb-2 p-0">Which date?</legend>
        <div className="flex flex-wrap items-center gap-2">
          {[...dates.map((d) => [d, fmtPitchDate(d)] as const), ["other", "Another date"] as const].map(([v, label]) => (
            <label key={v} className="pick" aria-pressed={date === v}>
              <input type="radio" name={`book-date-${p.id}`} className="m-0" checked={date === v} onChange={() => setDate(v)} data-testid={`book-date-${v}`} />{label}
            </label>
          ))}
          {date === "other" && <input className="input w-auto" type="date" aria-label="Other date" value={other} onChange={(e) => setOther(e.target.value)} data-testid="book-other-date" />}
        </div>
      </fieldset>
      <label className="grid max-w-xs gap-1">
        <span className="lbl">Final configuration</span>
        <Select<string> value={cfg} onChange={setCfg} placeholder="Not sure yet" label="Final configuration" testid="book-config"
          options={(artist?.configurations ?? []).map((c) => [c.id, c.name] as [string, string])} />
      </label>
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 self-start">
        <input type="checkbox" className="m-0 h-[18px] w-[18px]" checked={copy} onChange={(e) => setCopy(e.target.checked)} data-testid="book-copy" />
        Copy over comments <span className="s">({commentCount})</span>
      </label>
      <div className="grid gap-1" data-testid="book-invites">
        <label className={`inline-flex min-h-11 items-center gap-2.5 self-start ${recipients.length ? "cursor-pointer" : "opacity-60"}`}>
          <input type="checkbox" className="m-0 h-[18px] w-[18px]" checked={sendInvites} disabled={!recipients.length} onChange={(e) => setInvite(e.target.checked)} data-testid="book-invite" />
          Send calendar invitations
        </label>
        <p className="s m-0" data-testid="book-invite-list">
          {recipients.length
            ? <>Invites go to: {recipients.map((id) => musicians.find((m) => m.id === id)?.name ?? "Someone").join(", ")}</>
            : "Nobody would be invited: pick a configuration with band members who are on the team and have an email."}
        </p>
      </div>
      <ErrorBox error={error} />
      <div className="d-sep" />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn ghost" onClick={onCancel} data-testid="book-cancel">Cancel</button>
        <button type="submit" className="btn acc" disabled={busy || invalid} data-testid="book-submit">Create show</button>
      </div>
    </form>
  );
}
