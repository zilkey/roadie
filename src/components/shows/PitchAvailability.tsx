"use client";
import { draftPath } from "@/schema/drafts";
import { useEffect, useRef, useState } from "react";
import { ErrorBox, PickChip, useCommand } from "@/components/ui";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { useArtist } from "@/lib/artist";
import { useProfile } from "@/lib/auth";
import { BAND_TIME_ZONE } from "@/lib/timezone";
import { fmtPitchDate, sortedDates, todayStr } from "@/lib/booking";
import { fmtLong, type Answer } from "@/lib/shows";
import { ANSWER_FOOT, ANSWER_WORD, DateAnswerCard } from "@/components/shows/DateAnswers";
import { ChannelPicker, PILL, Sent, finishSignal, startSignal, useAnswerPage, useLastChannel, type AskResult, type Channel, type SentResult } from "@/components/shows/Availability";
import type { Availability, Musician } from "@/schema";
import { shareSheetHere } from "@/lib/signal";

const ms = (t?: unknown) => (t as { toMillis?(): number } | undefined)?.toMillis?.() ?? 0;
const newestFirst = (a: Row<Availability>, b: Row<Availability>) => ms(b.sentAt ?? b.createdAt) - ms(a.sentAt ?? a.createdAt);
const place = (label: string) => label.split(" · ")[0];

const ICON: Record<Answer, React.ReactNode> = {
  yes: <path d="M2.5 7.5l3 3 6-7" />,
  no: <path d="M3 3l8 8M11 3l-8 8" />,
  maybe: <path d="M3 7h8" />,
};
const AnswerIcon = ({ a }: { a: Answer }) => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{ICON[a]}</svg>
);

/** A pitch's asks, every date in them, and each person's answer for a date (the newest ask on that date that has one). */
function usePitchAsks(pitchId: string) {
  const asks = (useCollection<Availability>("availability", { where: [["pitchId", "==", pitchId]] }).rows ?? []).slice().sort(newestFirst);
  const on = (date: string) => asks.filter((a) => a.date === date);
  return {
    asks,
    answer: (date: string, mid: string) => on(date).map((a) => a.responses[mid]).find((r) => !!r),
    asked: (date: string, mid: string) => on(date).some((a) => a.askedMusicianIds.includes(mid)),
  };
}

/**
 * The pitch's "Dates & shows" body, admins only: Who's free (people down, possible dates across, where dates are added and
 * removed) and the always-open Ask who's free form for any of those dates.
 */
export function PitchDates({ pitchId, dates, onDatesChange, onBlur, personnel, place: placeName, musicians }: {
  pitchId: string; dates: string[]; onDatesChange(dates: string[]): void; onBlur(): void; personnel: string[]; place: string; musicians: Row<Musician>[];
}) {
  const { asks, answer, asked } = usePitchAsks(pitchId);
  // Dates that were asked about stay as columns after they leave the pitch's list, so their answers don't vanish.
  const cols = sortedDates([...new Set([...dates, ...asks.map((a) => a.date)])]);
  const ids = [...new Set([...personnel, ...asks.flatMap((a) => a.askedMusicianIds)])];
  const people = ids.map((id) => ({ id, name: musicians.find((m) => m.id === id)?.name ?? "Someone" })).sort((a, b) => a.name.localeCompare(b.name));
  const free = cols.map((d) => people.filter((p) => answer(d, p.id)?.answer === "yes").length);
  const best = Math.max(0, ...free);
  const everyDate = people.filter((p) => cols.length > 0 && cols.every((d) => answer(d, p.id))).length;
  const last = asks[0];
  const lastAt = last ? new Date(ms(last.sentAt ?? last.createdAt)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: BAND_TIME_ZONE }) : "";

  const [draft, setDraft] = useState("");
  function add() {
    if (draft && !dates.includes(draft)) onDatesChange(sortedDates([...dates, draft]));
    setDraft("");
  }

  return (
    <>
      <div className="grid gap-3" data-testid="whos-free">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-[17px] font-semibold">Who&apos;s free</h3>
          <span className="s" data-testid="whos-free-status">
            {last ? `Asked ${lastAt}${last.channel ? ` via ${last.channel === "signal" ? "Signal" : "email"}` : ""} · ${everyDate} of ${people.length} answered every date` : "Not asked yet"}
          </span>
        </div>
        <div className="free-wrap">
          <table className="free-grid" data-testid="pitch-dates" onBlur={onBlur}>
            <thead>
              <tr>
                <th scope="col" className="lbl">Person</th>
                {cols.map((d, i) => (
                  <th scope="col" key={d}>
                    <span className="flex items-center justify-between gap-1">
                      <span data-testid={`pitch-dates-col-${i}`}>{fmtPitchDate(d)}</span>
                      {dates.includes(d) && (
                        <button type="button" className="col-x" aria-label={`Remove ${fmtPitchDate(d)}`} onClick={() => onDatesChange(dates.filter((x) => x !== d))} data-testid={`pitch-dates-remove-${i}`}>
                          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M3 3l8 8M11 3l-8 8" /></svg>
                        </button>
                      )}
                    </span>
                  </th>
                ))}
                <th scope="col" className="add">
                  <span className="flex items-center gap-1.5">
                    <input className="input !w-auto" type="date" aria-label="New date" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={add}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} data-testid="pitch-dates-date" />
                    <button type="button" className="round-btn" aria-label="Add date" disabled={!draft} onClick={add} data-testid="pitch-dates-add">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M8 3v10M3 8h10" /></svg>
                    </button>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} data-testid={`free-row-${p.name}`}>
                  <th scope="row">{p.name}</th>
                  {cols.map((d) => {
                    const r = answer(d, p.id);
                    return (
                      <td key={d} data-testid={`free-${p.name}-${d}`}>
                        {r
                          ? <span className={`chip ${PILL[r.answer]} free-cell`}><AnswerIcon a={r.answer} />{ANSWER_WORD[r.answer]}</span>
                          : <span className="free-cell none">{asked(d, p.id) ? "No reply" : "Not asked"}</span>}
                        {r?.note && <div className="s mt-1">{r.note}</div>}
                      </td>
                    );
                  })}
                  <td />
                </tr>
              ))}
            </tbody>
            {people.length > 0 && cols.length > 0 && (
              <tfoot>
                <tr>
                  <th scope="row" className="lbl">Free</th>
                  {cols.map((d, i) => <td key={d} className={free[i] > 0 && free[i] === best ? "text-[var(--success-text)]" : ""} data-testid={`free-total-${d}`}>{free[i]} of {people.length}</td>)}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      <MyDates pitchId={pitchId} dates={dates} />
      <div className="d-sep" />
      <AskAboutDates pitchId={pitchId} cols={cols} defaultIds={personnel} place={placeName} musicians={musicians} />
    </>
  );
}

/** The signed-in admin's own answer for each of the pitch's dates, asked or not. */
function MyDates({ pitchId, dates }: { pitchId: string; dates: string[] }) {
  const { musicianId } = useProfile();
  const { asks } = usePitchAsks(pitchId);
  const { call, busy, error } = useCommand();
  if (!musicianId || !dates.length) return null;
  return (
    <div className="grid gap-3" data-testid="my-dates">
      <h3 className="text-[17px] font-semibold">Can you play?</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {sortedDates(dates).map((d) => {
          const on = asks.filter((a) => a.date === d && !a.deletedAt);
          const r = on.map((a) => a.responses[musicianId]).find((x) => !!x);
          return (
            <DateAnswerCard key={d} busy={busy} onAnswer={(answer, note) => call("availability.answerPitchDate", { pitchId, date: d, answer, ...(note ? { note } : {}) })}
              ask={{ id: d, date: d, title: fmtLong(d), closed: on.length > 0 && on.every((a) => !!a.closedAt), answer: r?.answer, note: r?.note }} />
          );
        })}
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

/** Ask who's free about any of the pitch's dates: one message, one link per person for every date picked. */
function AskAboutDates({ pitchId, cols, defaultIds, place: placeName, musicians }: { pitchId: string; cols: string[]; defaultIds: string[]; place: string; musicians: Row<Musician>[] }) {
  const { call, error, busy } = useCommand();
  const groupUrl = useArtist().doc?.signalGroupUrl;
  const lastChannel = useLastChannel();
  const answerPage = useAnswerPage();
  const [share, setShare] = useState(false);
  useEffect(() => setShare(shareSheetHere()), []);
  // The ask is an action (it emails people): its inputs are a draft per pitch until Send.
  const askPath = draftPath.newUnder("pitches", pitchId, "availability");
  const draft = useDraft(askPath, { dates: null as string[] | null, picked: defaultIds, msg: null as string | null, channel: null as Channel | null }, { title: () => `Ask who's free · ${placeName}` });
  const mutationId = useRef(newMutationId());
  const { picked, msg } = draft.value;
  // Every date still ahead is in the ask until it's tapped off.
  const on = (draft.value.dates ?? cols.filter((d) => d >= todayStr())).filter((d) => cols.includes(d));
  // No Signal group set: no choice at all, email as always.
  const channel: Channel = groupUrl ? (draft.value.channel ?? lastChannel ?? "email") : "email";
  const set = (v: Partial<typeof draft.value>) => draft.setValue({ ...draft.value, ...v });
  const [result, setResult] = useState<SentResult | null>(null);
  const defaultMsg = `We have an option for a show at ${placeName} on ${on.map(fmtLong).join(" or ") || "[date]"}. Can you play? Tap your answer for each date:`;
  const link = answerPage({ pitchId });
  const why = !on.length ? "Pick a date to send." : !picked.length ? "Pick at least one person." : "";

  async function send() {
    const message = msg ?? defaultMsg;
    const text = `${message}\n${link}`;
    // Before any await: Signal Desktop has to open inside the click.
    const started = channel === "signal" && groupUrl ? startSignal(text, groupUrl) : null;
    await draft.settle();
    const r = await call<AskResult>("availability.ask", { pitchId, dates: on, musicianIds: picked, message, channel }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (!r) return;
    let out: SentResult = r;
    if (channel === "signal" && groupUrl) out = { ...r, signal: { text, groupUrl, handoff: await finishSignal(started, text) } };
    setResult(out); mutationId.current = newMutationId(); await draft.clear({ reset: true });
  }

  return (
    <div className="grid gap-4" data-testid="ask-form">
      <div className="grid gap-1">
        <h3 className="text-[17px] font-semibold">Ask who&apos;s free</h3>
        <p className="s text-sm">One link to this pitch. Everyone answers each date there.</p>
      </div>
      {result && <Sent r={result} />}
      {draft.ready && (
        <div className="grid items-start gap-x-5 gap-y-4 sm:grid-cols-[96px_minmax(0,1fr)]">
          <span className="lbl sm:pt-2">Dates</span>
          <div className="flex flex-wrap gap-2">
            {!cols.length && <span className="s sm:pt-2" data-testid="ask-no-dates">Add a date in the table above first.</span>}
            {cols.map((d) => {
              const isOn = on.includes(d);
              return <PickChip key={d} on={isOn} testid={`ask-date-${d}`} onToggle={() => set({ dates: isOn ? on.filter((x) => x !== d) : sortedDates([...on, d]) })}>{fmtPitchDate(d)}</PickChip>;
            })}
          </div>

          <span className="lbl sm:pt-2">People</span>
          <div className="flex flex-wrap gap-2">
            {musicians.filter((m) => m.active || picked.includes(m.id)).sort((a, b) => a.name.localeCompare(b.name)).map((m) => {
              const isOn = picked.includes(m.id);
              return <PickChip key={m.id} on={isOn} testid={`ask-person-${m.name}`} onToggle={() => set({ picked: isOn ? picked.filter((x) => x !== m.id) : [...picked, m.id] })}>{m.name}</PickChip>;
            })}
          </div>

          {groupUrl && <>
            <span className="lbl sm:pt-2">Send via</span>
            <ChannelPicker value={channel} onChange={(v) => set({ channel: v })} name={`ask-channel-${askPath}`} testid="ask-channel" />
          </>}

          <label className="lbl sm:pt-3" htmlFor="ask-message">Message</label>
          <div className="overflow-hidden rounded-[10px] border" style={{ borderColor: "var(--input-border)" }}>
            <textarea id="ask-message" className="block w-full resize-y border-0 bg-transparent px-3.5 py-3 text-[15px] leading-normal outline-none" rows={3}
              value={msg ?? defaultMsg} onChange={(e) => set({ msg: e.target.value })} data-testid="ask-message" />
            <div className="flex items-center justify-between gap-2 border-t px-3.5 py-2" style={{ borderColor: "var(--line)" }}>
              <span className="flex min-w-0 items-center gap-2 text-sm" style={{ color: "var(--accent-text)" }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden className="flex-none">
                  <path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 014 4l-1 1M9 11.5l-1 1a2.8 2.8 0 01-4-4l1-1" />
                </svg>
                <span className="truncate" data-testid="ask-link">{channel === "signal" ? link : "Each person's own answer link"}</span>
              </span>
              <span className="s whitespace-nowrap">Added to every message</span>
            </div>
          </div>
        </div>
      )}
      <ErrorBox error={error} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {why && <span className="s" data-testid="ask-send-why">{why}</span>}
          <button className="btn acc" disabled={busy || !!why || !draft.ready} onClick={send} data-testid="ask-send">
            {channel === "signal" ? (share ? "Share to Signal" : "Copy & open Signal") : `Send ${picked.length} email${picked.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A member opening the pitch from the band's Signal post: each date they're asked about, to answer signed in. */
export function MemberDates({ pitchId, empty }: { pitchId: string; empty: React.ReactNode }) {
  const { musicianId } = useProfile();
  const { call, busy, error } = useCommand();
  // Rules only let a member read asks they are on, so the query must say so.
  const { rows, loading } = useCollection<Availability>("availability", { where: [["askedMusicianIds", "array-contains", musicianId ?? "none"]] });
  const mine = (rows ?? []).filter((a) => a.pitchId === pitchId).sort(newestFirst);
  // One card per date: the newest ask on it.
  const byDate = sortedDates([...new Set(mine.map((a) => a.date))]).map((d) => mine.find((a) => a.date === d)!);
  if (!byDate.length) return loading ? null : <>{empty}</>;
  return (
    <div className="grid gap-4" data-testid="member-dates">
      <p className="s text-[15px]">{place(byDate[0].label)}. Tap an answer for each date.</p>
      <div className="grid gap-3">
        {byDate.map((a) => {
          const r = musicianId ? a.responses[musicianId] : undefined;
          return (
            <DateAnswerCard key={a.id} busy={busy} onAnswer={(answer, note) => call("availability.answer", { id: a.id, answer, ...(note ? { note } : {}) })}
              ask={{ id: a.id, date: a.date, title: fmtLong(a.date), closed: !!a.closedAt, answer: r?.answer, note: r?.note }} />
          );
        })}
      </div>
      <ErrorBox error={error} />
      <p className="s text-center">{ANSWER_FOOT}</p>
    </div>
  );
}
