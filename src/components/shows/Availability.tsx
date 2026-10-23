"use client";
import { useRef, useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { CopyButton } from "@/components/booking/common";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useDraft, useHasDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { ASK_LABEL, askState, fmtLong, type Answer, type AskState } from "@/lib/shows";
import type { Availability, Musician } from "@/schema";

interface AskResult { id: string; links: Record<string, string>; emailed: string[]; notEmailed: { musicianId: string; name: string; reason: string }[] }

const PILL: Record<AskState, string> = { yes: "g", no: "a", maybe: "m", waiting: "", notAsked: "" };
const ms = (t?: unknown) => (t as { toMillis?(): number } | undefined)?.toMillis?.() ?? 0;

/** After sending: who got email, and links to text to anyone without one (links are shown once; only a hash is stored). */
function Sent({ r }: { r: AskResult }) {
  return (
    <div className="card hi" data-testid="ask-result">
      <b>{r.emailed.length ? `Emailed ${r.emailed.join(", ")}.` : "No emails went out."}</b>
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
  // The ask is an action (it emails people): the button stays, its inputs are a draft per show/pitch.
  const ctxKey = showId ? `show:${showId}` : `pitch:${pitchId}`;
  const draft = useDraft("availabilityAsk", ctxKey, { date, picked: defaultIds, msg: null as string | null }, { title: () => `Ask who's free · ${place}` });
  const hasDraft = useHasDraft("availabilityAsk", ctxKey);
  const [explicit, setOpen] = useState<boolean | null>(null);
  const open = explicit ?? hasDraft;
  const mutationId = useRef(newMutationId());
  const { date: d, picked, msg } = draft.value;
  const setD = (v: string) => draft.setValue({ ...draft.value, date: v });
  const setPicked = (v: string[]) => draft.setValue({ ...draft.value, picked: v });
  const setMsg = (v: string | null) => draft.setValue({ ...draft.value, msg: v });
  const [result, setResult] = useState<AskResult | null>(null);
  const defaultMsg = `We have an option for a show at ${place} on ${fmtLong(d) || "that date"}. Tap here to say if you're available.`;
  async function send() {
    await draft.settle();
    const r = await call<AskResult>("availability.ask", { pitchId, showId, date: d, musicianIds: picked, message: msg ?? defaultMsg }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (r) { setResult(r); setOpen(false); mutationId.current = newMutationId(); await draft.clear({ reset: true }); }
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
              return <button key={m.id} type="button" aria-pressed={on} data-testid={`ask-person-${m.name}`} className={`btn sm ${on ? "acc" : "ghost"}`}
                onClick={() => setPicked(on ? picked.filter((x) => x !== m.id) : [...picked, m.id])}>{m.name}</button>;
            })}
          </div>
          <span className="lbl">Message</span>
          <textarea className="input" rows={4} value={msg ?? defaultMsg} onChange={(e) => setMsg(e.target.value)} data-testid="ask-message" />
          <span className="s">Each person gets an email with their own link. They can answer without logging in.</span>
          <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
          <ErrorBox error={error} />
          <button className="btn acc" disabled={busy || !picked.length || !d} onClick={send} data-testid="ask-send">Send</button>
        </div>
      )}
    </div>
  );
}

/** "Who's free": answers per musician for each ask on this pitch or show. Admins can mark, remind and close. */
export function WhosFree({ pitchId, showId, musicians, extraIds = [] }: { pitchId?: string; showId?: string; musicians: Row<Musician>[]; extraIds?: string[] }) {
  const asks = useCollection<Availability>("availability").rows ?? [];
  const mine = asks.filter((a) => (pitchId && a.pitchId === pitchId) || (showId && a.showId === showId)).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  if (!mine.length) return null;
  return <div className="grid gap-3" data-testid="whos-free">{mine.map((a) => <AskCard key={a.id} av={a} musicians={musicians} extraIds={extraIds} />)}</div>;
}

function AskCard({ av, musicians, extraIds }: { av: Row<Availability>; musicians: Row<Musician>[]; extraIds: string[] }) {
  const { call, error, busy } = useCommand();
  const [result, setResult] = useState<AskResult | null>(null);
  const [setFor, setSetFor] = useState<string | null>(null);
  const ids = [...av.askedMusicianIds, ...extraIds.filter((i) => !av.askedMusicianIds.includes(i))];
  const waiting = av.askedMusicianIds.filter((i) => !av.responses[i]);
  const closed = !!av.closedAt;
  const remind = async (musicianIds?: string[]) => { const r = await call<AskResult>("availability.remind", { id: av.id, musicianIds }); if (r) setResult(r); };
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
                  <button className="btn ghost sm" onClick={() => setSetFor(setFor === id ? null : id)} data-testid={`avail-set-${name}`}>Set</button>
                </span>
              </div>
              {setFor === id && (
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
      <ErrorBox error={error} />
      {result && <Sent r={result} />}
      <div className="flex flex-wrap gap-2">
        {!closed && waiting.length > 0 && <button className="btn ghost sm" disabled={busy} onClick={() => remind()} data-testid="remind-all">Remind {waiting.length} waiting</button>}
        {closed
          ? <button className="btn ghost sm" disabled={busy} onClick={() => call("availability.reopen", { id: av.id })} data-testid="ask-reopen">Reopen</button>
          : <button className="btn ghost sm" disabled={busy} onClick={() => call("availability.close", { id: av.id })} data-testid="ask-close">Close this ask</button>}
      </div>
    </div>
  );
}
