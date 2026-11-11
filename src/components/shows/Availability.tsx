"use client";
import { draftPath } from "@/schema/drafts";
import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { ErrorBox, PickChip, useCommand } from "@/components/ui";
import { CopyButton } from "@/components/booking/common";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useDraft, useHasDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { clientDb } from "@/lib/firebase-client";
import { useArtist, useHref } from "@/lib/artist";
import { useProfile } from "@/lib/auth";
import { ASK_LABEL, askState, fmtLong, type Answer, type AskState } from "@/lib/shows";
import { signalAppUrl, type Availability, type Musician } from "@/schema";
import { shareSheetHere } from "@/lib/signal";

export interface AskResult { id: string; links: Record<string, string>; emailed: string[]; notEmailed: { musicianId: string; name: string; reason: string }[]; viaSignal?: string[] }
export type Channel = "email" | "signal";
/** What happened when the text was handed to Signal: the share sheet took it, it was copied (and the group opened), or neither. */
type Handoff = "shared" | "copied" | "none";
interface SignalPost { text: string; groupUrl: string; handoff: Handoff }
export type SentResult = AskResult & { signal?: SignalPost };

export const PILL: Record<AskState, string> = { yes: "g", no: "a", maybe: "m", waiting: "", notAsked: "" };
const ms = (t?: unknown) => (t as { toMillis?(): number } | undefined)?.toMillis?.() ?? 0;
const names = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** How the signed-in person last asked who's free in this artist (userPrefs/{uid}.askChannel, set by availability.ask). Null until they have. */
export function useLastChannel(): Channel | null {
  const { uid } = useProfile();
  const { artistId } = useArtist();
  const [ch, setCh] = useState<Channel | null>(null);
  useEffect(() => onSnapshot(doc(clientDb(), "userPrefs", uid), (d) => {
    const v = d.data()?.askChannel?.[artistId];
    setCh(v === "signal" || v === "email" ? v : null);
  }, () => setCh(null)), [uid, artistId]);
  return ch;
}

/** The full address of the pitch or show page an ask is about: where people answer when asked by Signal. */
export function useAnswerPage() {
  const href = useHref();
  return (a: { pitchId?: string; showId?: string }) => {
    const path = href(a.showId ? `/shows/${a.showId}` : `/booking/pitches/${a.pitchId}`);
    return typeof window === "undefined" ? path : `${window.location.origin}${path}`;
  };
}
const pageNoun = (a: { showId?: string }) => (a.showId ? "show" : "pitch");

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
/**
 * Get the text into Signal. No link can carry a message to Signal, and nothing but a person can post to a group, so: the share
 * sheet on touch screens (they pick Signal, then the group), else copy it and open the group in Signal Desktop (sgnl://).
 * Call this first thing in the click, before any await: a window opened after the server round trip is blocked. On computers it
 * copies and opens Signal right away; on touch screens it returns null and finishSignal shows the share sheet once the ask is saved.
 * Browsers may still refuse; the result card has buttons for a second try.
 */
export function startSignal(text: string, groupUrl: string): Promise<Handoff> | null {
  if (shareSheetHere()) return null;
  const copied = copy(text);
  window.open(signalAppUrl(groupUrl), "_blank", "noopener");
  return copied.then((ok) => (ok ? "copied" : "none"));
}
export async function finishSignal(started: Promise<Handoff> | null, text: string): Promise<Handoff> {
  if (started) return started;
  try { await navigator.share({ text }); return "shared"; } catch { return "none"; }
}

const HANDOFF: Record<Handoff, string> = {
  shared: "Posted to Signal.",
  copied: "Copied. Paste it into the group.",
  none: "Not posted yet. Copy the message and paste it into the group.",
};
const handoffText = (h: Handoff) => (h === "none" && shareSheetHere() ? "Not posted yet. Tap Share… and pick the band's group." : HANDOFF[h]);

/** The Signal half of a result: what happened, and buttons to try again (the share sheet was cancelled, the browser blocked the copy). */
function SignalButtons({ post }: { post: SignalPost }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      {shareSheetHere() && <button type="button" className="btn ghost sm" onClick={() => void navigator.share({ text: post.text }).catch(() => {})} data-testid="signal-share">Share…</button>}
      <button type="button" className="btn ghost sm" data-testid="signal-copy"
        onClick={async () => { if (await copy(post.text)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}>{copied ? "Copied" : "Copy message"}</button>
      <a className="btn ghost sm" href={post.groupUrl} target="_blank" rel="noopener noreferrer" data-testid="signal-open">Open Signal group</a>
    </div>
  );
}

/** After sending: who got email (or the Signal post), and links to text to anyone without one (links are shown once; only a hash is stored). */
export function Sent({ r }: { r: SentResult }) {
  return (
    <div className="card hi" data-testid="ask-result">
      {r.signal
        ? <><b data-testid="signal-handoff">{handoffText(r.signal.handoff)}</b><SignalButtons post={r.signal} /></>
        : <b>{r.emailed.length ? `Emailed ${r.emailed.join(", ")}.` : "No emails went out."}</b>}
      {r.notEmailed.map((n) => (
        <div key={n.musicianId} className="grid gap-1">
          <span className="s">{n.name}: {n.reason}</span>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-soft px-2 py-1 text-xs" data-testid={`ask-link-${n.name}`}>{r.links[n.musicianId]}</code>
            <CopyButton text={r.links[n.musicianId]} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AskWhoIsFree({ pitchId, showId, date, defaultIds, place, musicians }: {
  pitchId?: string; showId?: string; date: string; defaultIds: string[]; place: string; musicians: Row<Musician>[];
}) {
  const { call, error, busy } = useCommand();
  const groupUrl = useArtist().doc?.signalGroupUrl;
  const lastChannel = useLastChannel();
  const answerPage = useAnswerPage();
  // The ask is an action (it emails people): the button stays, its inputs are a draft per show/pitch.
  const askPath = showId ? draftPath.newUnder("shows", showId, "availability") : draftPath.newUnder("pitches", pitchId!, "availability");
  const draft = useDraft(askPath, { date, picked: defaultIds, msg: null as string | null, channel: null as Channel | null }, { title: () => `Ask who's free · ${place}` });
  const hasDraft = useHasDraft(askPath);
  const [explicit, setOpen] = useState<boolean | null>(null);
  const open = explicit ?? hasDraft;
  const mutationId = useRef(newMutationId());
  const { date: d, picked, msg } = draft.value;
  // No Signal group set: no choice at all, email as always.
  const channel: Channel = groupUrl ? (draft.value.channel ?? lastChannel ?? "email") : "email";
  const setChannel = (v: Channel) => draft.setValue({ ...draft.value, channel: v });
  const setD = (v: string) => draft.setValue({ ...draft.value, date: v });
  const setPicked = (v: string[]) => draft.setValue({ ...draft.value, picked: v });
  const setMsg = (v: string | null) => draft.setValue({ ...draft.value, msg: v });
  const [result, setResult] = useState<SentResult | null>(null);
  const option = `We have an option for a show at ${place} on ${fmtLong(d) || "that date"}.`;
  const defaultMsg = channel === "signal" ? `${option} Can you play? Answer on the ${pageNoun({ showId })} page:` : `${option} Tap here to say if you're available.`;
  async function send() {
    const message = msg ?? defaultMsg;
    const text = `${message}\n${answerPage({ pitchId, showId })}`;
    const started = channel === "signal" && groupUrl ? startSignal(text, groupUrl) : null;
    await draft.settle();
    const r = await call<AskResult>("availability.ask", { pitchId, showId, date: d, musicianIds: picked, message, channel }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (!r) return;
    let out: SentResult = r;
    if (channel === "signal" && groupUrl) out = { ...r, signal: { text, groupUrl, handoff: await finishSignal(started, text) } };
    setResult(out); setOpen(false); mutationId.current = newMutationId(); await draft.clear({ reset: true });
  }
  return (
    <div className="grid gap-2">
      <button className="btn ghost justify-self-start" onClick={() => setOpen(!open)} data-testid="ask-toggle">Ask who&apos;s free</button>
      {result && <Sent r={result} />}
      {open && draft.ready && (
        <div className="card" data-testid="ask-form">
          <span className="lbl">Date</span>
          <input className="input" type="date" value={d} onChange={(e) => setD(e.target.value)} data-testid="ask-date" />
          <span className="lbl">Ask</span>
          <div className="flex flex-wrap gap-1.5">
            {musicians.filter((m) => m.active || picked.includes(m.id)).sort((a, b) => a.name.localeCompare(b.name)).map((m) => {
              const on = picked.includes(m.id);
              return <PickChip key={m.id} on={on} testid={`ask-person-${m.name}`}
                onToggle={() => setPicked(on ? picked.filter((x) => x !== m.id) : [...picked, m.id])}>{m.name}</PickChip>;
            })}
          </div>
          <span className="lbl">Message</span>
          <textarea className="input" rows={4} value={msg ?? defaultMsg} onChange={(e) => setMsg(e.target.value)} data-testid="ask-message" />
          <span className="s" data-testid="ask-how">{channel === "signal"
            ? `You post this to the band's Signal group, with a link to this ${pageNoun({ showId })} page. People answer there, signed in.`
            : "Each person gets an email with their own link. They can answer without logging in."}</span>
          <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
          <ErrorBox error={error} />
          <div className="flex flex-wrap items-center gap-2">
            {groupUrl && <ChannelPicker value={channel} onChange={setChannel} name={`ask-channel-${askPath}`} testid="ask-channel" />}
            <button className="btn acc" disabled={busy || !picked.length || !d} onClick={send} data-testid="ask-send">Send</button>
            {(!d || !picked.length) && <span className="s" data-testid="ask-send-why">{!d ? "Pick a date to send." : "Pick at least one person."}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Email or Signal: shown only when the artist has a Signal group. */
export function ChannelPicker({ value, onChange, name, testid }: { value: Channel; onChange: (v: Channel) => void; name: string; testid: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Notify band members by" data-testid={testid}>
      {(["email", "signal"] as const).map((c) => (
        <label key={c}><input type="radio" name={name} checked={value === c} onChange={() => onChange(c)} data-testid={`${testid}-${c}`} />{c === "email" ? "Email" : "Signal"}</label>
      ))}
    </div>
  );
}

/** "Can you play?" for the signed-in musician on an open ask they're on: how people asked by Signal answer. */
function YourAnswer({ av }: { av: Row<Availability> }) {
  const { musicianId } = useProfile();
  const { call, error, busy } = useCommand();
  const mine = musicianId ? av.responses[musicianId] : undefined;
  const [note, setNote] = useState(mine?.note ?? "");
  if (!musicianId || !av.askedMusicianIds.includes(musicianId) || av.closedAt) return null;
  return (
    <div className="grid gap-1.5" data-testid="your-answer">
      <span className="lbl">Can you play?</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {(["yes", "no", "maybe"] as const).map((a) => (
          <button key={a} className={`btn sm ${mine?.answer === a ? "acc" : "ghost"}`} disabled={busy} aria-pressed={mine?.answer === a} data-testid={`your-answer-${a}`}
            onClick={() => call("availability.answer", { id: av.id, answer: a, ...(note.trim() ? { note: note.trim() } : {}) })}>{ASK_LABEL[a]}</button>
        ))}
        <input className="input !w-auto min-w-0 flex-1" value={note} maxLength={500} placeholder="Add a note (optional)" aria-label="Note"
          onChange={(e) => setNote(e.target.value)} data-testid="your-answer-note" />
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

/**
 * "Who's free": answers per musician for each ask on this pitch or show. Admins can mark, remind and close; everyone asked
 * answers for themselves here. `empty` shows when there is no ask (members only see the asks they're on).
 */
export function WhosFree({ pitchId, showId, musicians, extraIds = [], empty = null }: { pitchId?: string; showId?: string; musicians: Row<Musician>[]; extraIds?: string[]; empty?: React.ReactNode }) {
  const p = useProfile();
  // Rules only let a member read asks they are on, so a member's query must say so.
  const { rows, loading } = useCollection<Availability>("availability", {
    where: p.role === "member" ? [["askedMusicianIds", "array-contains", p.musicianId ?? "none"]] : [],
  });
  const mine = (rows ?? []).filter((a) => (pitchId && a.pitchId === pitchId) || (showId && a.showId === showId)).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  if (!mine.length) return loading ? null : <>{empty}</>;
  return <div className="grid gap-3" data-testid="whos-free">{mine.map((a) => <AskCard key={a.id} av={a} musicians={musicians} extraIds={extraIds} admin={p.role === "admin"} />)}</div>;
}

function AskCard({ av, musicians, extraIds, admin }: { av: Row<Availability>; musicians: Row<Musician>[]; extraIds: string[]; admin: boolean }) {
  const { call, error, busy } = useCommand();
  const groupUrl = useArtist().doc?.signalGroupUrl;
  const lastChannel = useLastChannel();
  const answerPage = useAnswerPage();
  const [picked, setChannel] = useState<Channel | null>(null);
  const channel: Channel = groupUrl ? (picked ?? lastChannel ?? "email") : "email";
  const [result, setResult] = useState<SentResult | null>(null);
  const [setFor, setSetFor] = useState<string | null>(null);
  const ids = [...av.askedMusicianIds, ...extraIds.filter((i) => !av.askedMusicianIds.includes(i))];
  const waiting = av.askedMusicianIds.filter((i) => !av.responses[i]);
  const closed = !!av.closedAt;
  const remind = async (musicianIds?: string[]) => {
    // The post names who it's for (the server's viaSignal), worked out here so Signal can open inside the click.
    const who = (musicianIds ?? waiting).map((id) => musicians.find((m) => m.id === id)?.name ?? "Someone");
    const text = `Still waiting on ${names(who)} for ${av.label}. Answer on the ${pageNoun(av)} page:\n${answerPage(av)}`;
    const started = channel === "signal" && groupUrl && who.length ? startSignal(text, groupUrl) : null;
    const r = await call<AskResult>("availability.remind", { id: av.id, musicianIds, channel });
    if (!r) return;
    if (channel !== "signal" || !groupUrl || !r.viaSignal?.length) return setResult(r);
    setResult({ ...r, signal: { text, groupUrl, handoff: await finishSignal(started, text) } });
  };
  const mark = (musicianId: string, answer: Answer | null) => call("availability.mark", { id: av.id, musicianId, answer });
  return (
    <div className="card" data-testid={`avail-${av.id}`}>
      <div className="flex items-center justify-between gap-2">
        <b>{av.label}</b>
        <span className="flex items-center gap-1.5">{closed && <span className="chip" data-testid="ask-closed">Closed</span>}</span>
      </div>
      <div className="grid gap-1">
        {ids.map((id) => {
          const m = musicians.find((x) => x.id === id);
          const name = m?.name ?? "Someone";
          const st = askState(av, id);
          const r = av.responses[id];
          return (
            <div key={id} className="grid gap-1" data-testid={`avail-row-${name}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <b>{name}</b>
                  {r?.by === "admin" && <span className="s"> · set by admin</span>}
                  {r?.note && <span className="s"> · &ldquo;{r.note}&rdquo;</span>}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className={`chip ${PILL[st]}`} data-testid={`avail-state-${name}`}>{ASK_LABEL[st]}</span>
                  {admin && <button className="btn ghost sm" onClick={() => setSetFor(setFor === id ? null : id)} data-testid={`avail-set-${name}`}>Set</button>}
                </span>
              </div>
              {admin && setFor === id && (
                <div className="flex flex-wrap items-center gap-1.5" data-testid={`avail-setter-${name}`}>
                  {(["yes", "no", "maybe"] as const).map((a) => (
                    <button key={a} className={`btn sm ${r?.answer === a ? "acc" : "ghost"}`} disabled={busy} data-testid={`mark-${name}-${a}`}
                      onClick={async () => { await mark(id, a); setSetFor(null); }}>{ASK_LABEL[a]}</button>
                  ))}
                  {r && <button className="btn ghost sm" disabled={busy} onClick={async () => { await mark(id, null); setSetFor(null); }}>Clear</button>}
                  {!closed && st !== "yes" && st !== "no" && st !== "maybe" && <button className="btn ghost sm" disabled={busy} data-testid={`remind-${name}`} onClick={() => remind([id])}>{st === "notAsked" ? "Ask" : "Remind"} {name}</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <YourAnswer av={av} />
      <ErrorBox error={error} />
      {result && <Sent r={result} />}
      {admin && (
        <div className="flex flex-wrap items-center gap-2">
          {!closed && waiting.length > 0 && groupUrl && <ChannelPicker value={channel} onChange={setChannel} name={`remind-channel-${av.id}`} testid="remind-channel" />}
          {!closed && waiting.length > 0 && <button className="btn ghost sm" disabled={busy} onClick={() => remind()} data-testid="remind-all">Remind {waiting.length} waiting</button>}
          {closed
            ? <button className="btn ghost sm" disabled={busy} onClick={() => call("availability.reopen", { id: av.id })} data-testid="ask-reopen">Reopen</button>
            : <button className="btn ghost sm" disabled={busy} onClick={() => call("availability.close", { id: av.id })} data-testid="ask-close">Close this ask</button>}
        </div>
      )}
    </div>
  );
}
