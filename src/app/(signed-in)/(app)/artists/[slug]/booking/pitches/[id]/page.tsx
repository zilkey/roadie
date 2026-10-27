"use client";
import { draftPath } from "@/schema/drafts";
import { BAND_TIME_ZONE } from "@/lib/timezone";
import Link, { useArtist, useMaybeArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, PickChip, Select, useCommand } from "@/components/ui";
import { useAutosave } from "@/lib/autosave";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { Menu } from "@/components/Menu";
import { SaveStatus } from "@/components/SaveStatus";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useCollection, useDoc, type Row } from "@/lib/firestore-hooks";
import { BackLink, ConfigurationPicker, StatusPill, hrefFor, useNotFound, type PitchRow } from "@/components/booking/common";
import { STATUSES, STATUS_LABEL, sortedDates, type Status } from "@/lib/booking";
import { EmailCard } from "@/components/booking/EmailCard";
import { BookedItForm } from "@/components/booking/BookedItForm";
import { MemberDates, PitchDates } from "@/components/shows/PitchAvailability";
import { fmtLong, showName } from "@/lib/shows";
import { emailThreadId, roleIn, type Activity, type EmailThread, type Comment, type Musician, type Show, type User } from "@/schema";

/** Booking is admins' business. Members land here from a Who's free post in Signal: they get just the asks they're on, to answer. */
export default function Page() {
  const artist = useMaybeArtist();
  if (!artist) return null;
  return artist.role === "admin" ? <AdminOnly><PitchPage /></AdminOnly> : <MemberAsks />;
}

function MemberAsks() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="mx-auto grid w-full max-w-md gap-5" data-testid="member-asks">
      <PageTitle title="Can you play?" />
      <MemberDates pitchId={id}
        empty={<div className="card"><p className="s" data-testid="member-asks-none">Nothing to answer here. <Link href="/calendar">Back to the calendar</Link></p></div>} />
    </div>
  );
}

type Stamp = { toMillis(): number };
const ms = (t?: unknown) => (t as Stamp | undefined)?.toMillis?.() ?? 0;
const when = (t?: unknown) => (ms(t) ? new Date(ms(t)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: BAND_TIME_ZONE }) : "");

function PitchPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { doc: p, loading } = useDoc<PitchRow>("pitches", id);
  const users = useCollection<User>("users").rows ?? [];
  const musicians = useCollection<Musician>("musicians").rows ?? [];
  const current = useArtist();
  const artist = current.doc ?? undefined;
  const { call, error, busy } = useCommand();
  const [booking, setBooking] = useState(false);
  const [step, setStep] = useState<{ text: string; due: string } | null>(null);
  const nf = useNotFound(loading, p, "pitch");
  const as = useAutosave({ command: "pitches.update", id, rev: p?.rev, onUseTheirs: () => setStep(null) });
  // Follow the live pitch (someone else's edit, an Undo) once nothing of ours is waiting to be saved.
  const liveStep = JSON.stringify(p?.nextStep ?? null);
  useEffect(() => { if (!as.isBusy()) setStep(null); }, [liveStep]); // eslint-disable-line react-hooks/exhaustive-deps
  // Taps build on the local list, so a second tap before the first save lands doesn't drop it.
  const [crew, setCrew] = useState<string[] | null>(null);
  const livePeople = JSON.stringify(p?.personnel ?? []);
  useEffect(() => { if (!as.isBusy()) setCrew(null); }, [livePeople]); // eslint-disable-line react-hooks/exhaustive-deps
  // Dates being edited: taps build on the local list, so a second tap before the first save lands doesn't drop it.
  const [dateRows, setDateRows] = useState<string[] | null>(null);
  const liveDates = JSON.stringify(p?.dates ?? []);
  useEffect(() => { if (!as.isBusy()) setDateRows(null); }, [liveDates]); // eslint-disable-line react-hooks/exhaustive-deps
  const pitchName = p?.target.name ?? "pitch";
  const commentDraft = useDraft(draftPath.newUnder("pitches", id, "comments"), { text: "" }, { title: (v) => `Comment on ${pitchName}: ${v.text.slice(0, 40)}` });
  const callDraft = useDraft(draftPath.newUnder("pitches", id, "calls"), { text: "" }, { title: (v) => `Call log for ${pitchName}: ${v.text.slice(0, 40)}` });
  const commentId = useRef(newMutationId());
  const callId = useRef(newMutationId());
  const [mode, setMode] = useState<"comment" | "call">("comment");
  const shows = useCollection<Show>("shows").rows ?? [];
  const activity = useCollection<Activity>(`pitches/${id}/activity`).rows ?? [];
  const comments = useCollection<Comment>(`pitches/${id}/comments`).rows ?? [];
  // Timeline rows link to the thread page when Roadie has the thread ("read it").
  const linked = new Set((useCollection<EmailThread>("emailThreads", { where: [["artistId", "==", current.artistId]] }).rows ?? []).map((x) => x.id));
  if (nf || !p) return nf;

  const patch = (x: Record<string, unknown>) => as.patch(x, { now: true });
  const name = (uid?: string) => users.find((u) => u.id === uid)?.name ?? "Someone";
  const flow: Status[] = ["idea", "toPitch", "pitched", "talking", "booked"];
  const stepVal = step ?? { text: p.nextStep?.text ?? "", due: p.nextStep?.due ?? "" };
  const people = crew ?? p.personnel;
  const timeline = [
    ...activity.map((a) => ({ id: a.id, at: ms(a.createdAt), who: name(a.createdBy), kind: a.type as string, a })),
    ...comments.map((c) => ({ id: c.id, at: ms(c.createdAt), who: name(c.authorId), kind: "comment", a: c as unknown as Row<Activity> & { body?: string } })),
  ].sort((x, y) => y.at - x.at);
  const targetHref = p.target.kind === "edition" ? hrefFor("edition", p.target.id) : hrefFor(p.target.kind, p.target.id);
  const config = artist?.configurations.find((c) => c.id === p.pitchedAs);

  // Both parts or neither: a half-filled step is held back (and shown as "Not saved") until it is complete.
  function editStep(next: { text: string; due: string }) {
    setStep(next);
    if (next.text.trim() && next.due) as.patch({ nextStep: { text: next.text, due: next.due } });
    else if (!next.text.trim() && !next.due) as.patch({ nextStep: null });
    else as.hold("a next step needs words and a date");
  }
  function editDates(dates: string[]) {
    setDateRows(dates);
    as.patch({ dates });
  }
  async function post() {
    await commentDraft.settle();
    const r = await call("pitches.comment", { id, body: commentDraft.value.text }, { clientMutationId: commentId.current, clearDraft: commentDraft.draftId });
    if (r) { await commentDraft.clear({ reset: true }); commentId.current = newMutationId(); }
  }
  async function logCall() {
    await callDraft.settle();
    const r = await call("pitches.log", { id, type: "call", text: callDraft.value.text }, { clientMutationId: callId.current, clearDraft: callDraft.draftId });
    if (r) { await callDraft.clear({ reset: true }); callId.current = newMutationId(); }
  }

  async function abandon() {
    if (confirm("Abandon this pitch? It moves to Past pitches.")) await call("pitches.move", { id, status: "dropped" });
  }

  const live = mode === "comment" ? commentDraft : callDraft;
  const submit = mode === "comment" ? post : logCall;

  return (
    <div className="show-page" data-testid="pitch-page">
      <PageTitle back={<BackLink href="/booking/pitches" label="Pitch List" />} title={p.target.name}
        sub={<>{p.lastContactAt ? `Last contact ${when(p.lastContactAt)}` : "No contact yet"}
          <Link href={targetHref} className="s block font-semibold underline" data-testid="target-link">{p.target.kind === "venue" ? "Venue" : p.target.kind === "promoter" ? "Promoter" : "Festival"} page</Link></>}
        pill={<StatusPill status={p.status} />}
        actions={<div className="flex items-center gap-2">
          {p.status !== "declined" && p.status !== "dropped" && <button type="button" className="btn acc" onClick={() => setBooking(true)} disabled={busy} data-testid="booked-it">Booked it</button>}
          <Menu label="More actions" testid="pitch" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>} items={[{ key: "remove", label: "Remove from Pitch List", danger: true,
            onSelect: async () => { if (confirm("Take this off the Pitch List?") && (await call("pitches.remove", { id }))) router.replace("/booking"); } }]} />
        </div>} />
      <ErrorBox error={error} />
      {booking && <section className="card" data-testid="book-card"><BookedItForm p={p} commentCount={comments.length} onCancel={() => setBooking(false)} /></section>}

      <section className="card" data-testid="pitch-status-card">
        <div className="card-head"><h2>Status</h2><SaveStatus {...as.statusProps} /></div>
        <label className="grid gap-1.5">
          <span className="lbl">Where it&apos;s at</span>
          <Select<Status> testid="status" value={p.status} onChange={(s) => call("pitches.move", { id, status: s })}
            options={[...flow, ...STATUSES.filter((s) => !flow.includes(s))].map((s) => [s, STATUS_LABEL[s]] as [Status, string])} />
        </label>
        <div className="grid gap-1.5" data-testid="next-step">
          <span className="lbl">Next step</span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input className="input sm:flex-1" placeholder="e.g. Pitch by" aria-label="Next step" value={stepVal.text} onChange={(e) => editStep({ ...stepVal, text: e.target.value })} onBlur={() => void as.flush()} data-testid="next-text" />
            <input className="input sm:!w-auto" type="date" aria-label="Next step date" value={stepVal.due} onChange={(e) => editStep({ ...stepVal, due: e.target.value })} onBlur={() => void as.flush()} data-testid="next-due" />
            {p.nextStep && <button type="button" className="btn sm ghost self-start" onClick={() => { setStep({ text: "", due: "" }); patch({ nextStep: null }); }}>Clear</button>}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Lineup</h2></div>
        <ConfigurationPicker value={p.pitchedAs ?? ""} testid="pitched-as" onChange={(v) => patch({ pitchedAs: v || null })} />
        <span className="lbl">Who&apos;s on it</span>
        <div className="flex flex-wrap gap-1.5" data-testid="personnel">
          {musicians.filter((m) => m.active || people.includes(m.id)).sort((a, c) => a.name.localeCompare(c.name)).map((m) => {
            const on = people.includes(m.id);
            return (
              <PickChip key={m.id} on={on} testid={`person-${m.name}`}
                onToggle={() => { const next = on ? people.filter((x) => x !== m.id) : [...people, m.id]; setCrew(next); patch({ personnel: next }); }}>{m.name}</PickChip>
            );
          })}
        </div>
        {config && <span className="s">Filled in from {config.name}. Tap to change.</span>}
        <span className="lbl">Who&apos;s handling it</span>
        <select className="select" value={p.assigneeId ?? ""} data-testid="assignee" onChange={(e) => patch({ assigneeId: e.target.value || null })}>
          <option value="">No one</option>
          {users.filter((u) => roleIn(u, current.artistId) === "admin").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </section>

      <EmailCard target={p.target} pitchId={id} />

      <section className="card" data-testid="pitch-dates-card">
        <div className="card-head">
          <h2>Dates &amp; shows</h2>
        </div>
        {p.showIds.length > 0 && (
          <div className="grid gap-2" data-testid="pitch-shows">
            {p.showIds.map((sid) => shows.find((x) => x.id === sid)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => (
              <Link key={x.id} href={`/shows/${x.id}`} className="card" data-testid={`pitch-show-${x.id}`}><b>{fmtLong(x.date)} · {showName(x)}</b><span className="s">{x.status}</span></Link>
            ))}
          </div>
        )}
        <PitchDates pitchId={id} dates={dateRows ?? sortedDates(p.dates)} onDatesChange={editDates} onBlur={() => void as.flush()}
          personnel={people} place={p.target.name} musicians={musicians} />
      </section>

      <section className="card" data-testid="pitch-activity-card">
        <div className="card-head"><h2>Activity</h2></div>
        <div className="grid gap-3" data-testid="timeline">
          {timeline.length === 0 && <div className="empty"><span>Nothing yet.</span></div>}
          {timeline.map((t) => <TimelineRow key={t.kind + t.id} t={t} threadHref={t.a.gmail?.threadId && linked.has(emailThreadId(current.artistId, t.a.gmail.threadId)) ? `/booking/email/${emailThreadId(current.artistId, t.a.gmail.threadId)}` : undefined} />)}
        </div>
        {commentDraft.ready && callDraft.ready && (
          <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <div className="seg" role="radiogroup" aria-label="Post type">
              <label><input type="radio" name="pitch-composer" checked={mode === "comment"} onChange={() => setMode("comment")} data-testid="composer-comment" />Comment</label>
              <label><input type="radio" name="pitch-composer" checked={mode === "call"} onChange={() => setMode("call")} data-testid="composer-call" />Call</label>
            </div>
            <textarea className="input" rows={3} aria-label={mode === "comment" ? "Comment" : "Call notes"}
              placeholder={mode === "comment" ? "Write a comment…" : "Log a call (what was said)…"}
              value={live.value.text} onChange={(e) => live.setValue({ text: e.target.value })}
              data-testid={mode === "comment" ? "comment-input" : "call-input"} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <DraftNote restoredAt={live.restoredAt} status={live.status} onStartOver={() => void live.clear({ reset: true })} />
              <button className="btn acc ml-auto" disabled={busy || !live.value.text.trim()} data-testid={mode === "comment" ? "comment-send" : "call-send"}>{mode === "comment" ? "Post" : "Log call"}</button>
            </div>
          </form>
        )}
      </section>
      {p.status !== "dropped" && <div className="flex justify-start"><button type="button" className="btn danger" onClick={abandon} disabled={busy} data-testid="pitch-abandon">Abandon pitch</button></div>}
    </div>
  );
}

function TimelineRow({ t, threadHref }: { t: { at: number; who: string; kind: string; a: Row<Activity> & { body?: string } }; threadHref?: string }) {
  const a = t.a;
  const date = t.at ? new Date(t.at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: BAND_TIME_ZONE }) : "";
  let body: React.ReactNode;
  switch (t.kind) {
    case "status": body = a.fromStatus && a.toStatus ? <>Moved to <b>{STATUS_LABEL[a.toStatus]}</b>{a.text ? ` · ${a.text}` : ""}</> : <>{a.text ?? "Status set"}</>; break;
    case "emailSent": body = <><b>{t.who} sent</b> {a.gmail?.subject} <span className="s">to {a.gmail?.to}</span></>; break;
    case "emailReply": body = <><b>Reply</b> <span className="s">on {a.gmail?.subject}</span><span className="block whitespace-pre-wrap text-sm">{a.text}</span></>; break;
    case "call": body = <><b>{t.who}</b> logged a call: {a.text}</>; break;
    case "email": body = <><b>{t.who}</b> logged an email: {a.text}</>; break;
    case "visit": body = <><b>{t.who}</b> logged a visit: {a.text}</>; break;
    case "comment": body = <><b>{t.who}:</b> {a.body}</>; break;
    default: body = <><b>{t.who}:</b> {a.text}</>;
  }
  const read = threadHref && (t.kind === "emailSent" || t.kind === "emailReply");
  return <div className="grid gap-0.5 border-t pt-3 first:border-t-0 first:pt-0" style={{ borderColor: "var(--line)" }} data-testid={`tl-${t.kind}`}><span className="text-sm">{body}</span><span className="s">{date}{read && <> · <Link href={threadHref} className="font-semibold underline" data-testid={`tl-read-${t.kind}`}>read it</Link></>}</span></div>;
}
