"use client";
import { BAND_TIME_ZONE } from "@/lib/timezone";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useProfile } from "@/lib/auth";
import { useAutosave } from "@/lib/autosave";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { SaveStatus } from "@/components/SaveStatus";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useCollection, useDoc, type Row } from "@/lib/firestore-hooks";
import { BackLink, Seg, StatusChip, hrefFor, useBooking, useNotFound, type PitchRow } from "@/components/booking/common";
import { STATUSES, STATUS_LABEL, buildTemplateContext, fillTemplate, fmtDate, unfilledFields, type Status } from "@/lib/booking";
import { AskWhoIsFree, WhosFree } from "@/components/shows/Availability";
import { fmtLong } from "@/lib/shows";
import { statsTemplateFields } from "@/lib/stats";
import type { Activity, Artist, Comment, Contact, EmailTemplate, Musician, Show, StatSnapshot, User } from "@/schema";

export default function Page() { return <AdminOnly><PitchPage /></AdminOnly>; }

type Stamp = { toMillis(): number };
const ms = (t?: unknown) => (t as Stamp | undefined)?.toMillis?.() ?? 0;
const when = (t?: unknown) => (ms(t) ? new Date(ms(t)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: BAND_TIME_ZONE }) : "");

function PitchPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { doc: p, loading } = useDoc<PitchRow>("pitches", id);
  const b = useBooking();
  const users = useCollection<User>("users").rows ?? [];
  const musicians = useCollection<Musician>("musicians").rows ?? [];
  const artist = (useCollection<Artist>("artists").rows ?? [])[0];
  const { call, error, busy } = useCommand();
  const [emailOpen, setEmailOpen] = useState(false);
  const [step, setStep] = useState<{ text: string; due: string } | null>(null);
  const [replies, setReplies] = useState<string | null>(null);
  const nf = useNotFound(loading, p, "pitch");
  const as = useAutosave({ command: "pitches.update", id, rev: p?.rev, onUseTheirs: () => setStep(null) });
  // Follow the live pitch (someone else's edit, an Undo) once nothing of ours is waiting to be saved.
  const liveStep = JSON.stringify(p?.nextStep ?? null);
  useEffect(() => { if (!as.isBusy()) setStep(null); }, [liveStep]); // eslint-disable-line react-hooks/exhaustive-deps
  // Taps build on the local list, so a second tap before the first save lands doesn't drop it.
  const [crew, setCrew] = useState<string[] | null>(null);
  const livePeople = JSON.stringify(p?.personnel ?? []);
  useEffect(() => { if (!as.isBusy()) setCrew(null); }, [livePeople]); // eslint-disable-line react-hooks/exhaustive-deps
  const pitchName = p?.target.name ?? "pitch";
  const commentDraft = useDraft("pitchComment", `pitch:${id}`, { text: "" }, { title: (v) => `Comment on ${pitchName}: ${v.text.slice(0, 40)}` });
  const callDraft = useDraft("pitchCall", `pitch:${id}`, { text: "" }, { title: (v) => `Call log for ${pitchName}: ${v.text.slice(0, 40)}` });
  const commentId = useRef(newMutationId());
  const callId = useRef(newMutationId());
  const shows = useCollection<Show>("shows").rows ?? [];
  const edition = p?.target.kind === "edition" ? b.editions.find((e) => e.id === p.target.id) : undefined;
  const activity = useCollection<Activity>(`pitches/${id}/activity`).rows ?? [];
  const comments = useCollection<Comment>(`pitches/${id}/comments`).rows ?? [];
  if (nf || !p) return nf;

  const patch = (x: Record<string, unknown>) => as.patch(x, { now: true });
  const name = (uid?: string) => users.find((u) => u.id === uid)?.name ?? "Someone";
  const flow: Status[] = ["idea", "toPitch", "pitched", "waiting", "talking", "booked"];
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

  async function checkReplies() {
    const r = await call<{ added: number }>("pitches.checkReplies", { id });
    if (r) setReplies(r.added ? `${r.added} new repl${r.added === 1 ? "y" : "ies"}` : "No new replies");
  }

  return (
    <div className="grid gap-3" data-testid="pitch-page">
      <BackLink href="/booking" label="Pitch List" />
      <PageTitle title={p.target.name} sub={p.lastContactAt ? `Last contact ${when(p.lastContactAt)}` : "No contact yet"} />
      <ErrorBox error={error} />
      <div className="flex items-center gap-2"><StatusChip status={p.status} /><Link href={targetHref} className="s font-semibold underline" data-testid="target-link">Open {p.target.kind === "edition" ? "festival year" : p.target.kind}</Link></div>

      <div className="grid gap-1.5">
        <span className="lbl">Where it&apos;s at</span>
        <Seg<Status> testid="status" value={p.status} onChange={(s) => call("pitches.move", { id, status: s })}
          options={flow.map((s) => [s, STATUS_LABEL[s]] as [Status, string])} />
        <Seg<Status> testid="status2" value={p.status} onChange={(s) => call("pitches.move", { id, status: s })}
          options={STATUSES.filter((s) => !flow.includes(s)).map((s) => [s, STATUS_LABEL[s]] as [Status, string])} />
      </div>

      <div className="card">
        <span className="lbl">Pitching as</span>
        <select className="select" value={p.pitchedAs ?? ""} data-testid="pitched-as"
          onChange={(e) => patch({ pitchedAs: e.target.value || null })}>
          <option value="">Not sure</option>
          {artist?.configurations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="lbl">Who&apos;s on it</span>
        <div className="flex flex-wrap gap-1.5" data-testid="personnel">
          {musicians.filter((m) => m.active || people.includes(m.id)).sort((a, c) => a.name.localeCompare(c.name)).map((m) => {
            const on = people.includes(m.id);
            return (
              <button key={m.id} type="button" aria-pressed={on} data-testid={`person-${m.name}`} className={`btn sm ${on ? "acc" : "ghost"}`}
                onClick={() => { const next = on ? people.filter((x) => x !== m.id) : [...people, m.id]; setCrew(next); patch({ personnel: next }); }}>{m.name}</button>
            );
          })}
        </div>
        {config && <span className="s">Filled in from {config.name}. Tap to change.</span>}
        <span className="lbl">Who&apos;s handling it</span>
        <select className="select" value={p.assigneeId ?? ""} data-testid="assignee" onChange={(e) => patch({ assigneeId: e.target.value || null })}>
          <option value="">No one</option>
          {users.filter((u) => u.role === "admin").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>

      <div className="card" data-testid="next-step">
        <span className="lbl">Next step</span>
        <input className="input" placeholder="e.g. Follow up" value={stepVal.text} onChange={(e) => editStep({ ...stepVal, text: e.target.value })} onBlur={() => void as.flush()} data-testid="next-text" />
        <input className="input" type="date" value={stepVal.due} onChange={(e) => editStep({ ...stepVal, due: e.target.value })} onBlur={() => void as.flush()} data-testid="next-due" />
        <div className="flex items-center gap-2">
          <SaveStatus {...as.statusProps} />
          {p.nextStep && <button type="button" className="btn sm ghost" onClick={() => { setStep({ text: "", due: "" }); patch({ nextStep: null }); }}>Clear</button>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn ghost" onClick={() => setEmailOpen(!emailOpen)} data-testid="email-toggle">Email</button>
        <button className="btn ghost" onClick={checkReplies} disabled={busy} data-testid="check-replies">Check for replies</button>
        {replies && <span className="s self-center" data-testid="replies-result">{replies}</span>}
      </div>
      {emailOpen && <EmailPanel pitch={p} artist={artist} contacts={b.contacts} onSent={() => setEmailOpen(false)} />}

      <div className="grid gap-2" data-testid="pitch-shows">
        <span className="lbl">Shows</span>
        {p.showIds.map((sid) => shows.find((x) => x.id === sid)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => (
          <Link key={x.id} href={`/shows/${x.id}`} className="card" data-testid={`pitch-show-${x.id}`}><b>{fmtLong(x.date)} · {x.venue.name}</b><span className="s">{x.status}</span></Link>
        ))}
        {p.status !== "declined" && p.status !== "dropped" && <Link href={`/shows/new?pitch=${id}`} className="btn acc justify-self-start" data-testid="booked-it">Booked it</Link>}
        <WhosFree pitchId={id} musicians={musicians} extraIds={p.personnel} />
        <AskWhoIsFree pitchId={id} date={edition?.startDate ?? ""} defaultIds={p.personnel} place={p.target.name} musicians={musicians} />
      </div>

      <span className="lbl">Timeline</span>
      <div className="grid gap-2" data-testid="timeline">
        {timeline.length === 0 && <span className="s">Nothing yet.</span>}
        {timeline.map((t) => <TimelineRow key={t.kind + t.id} t={t} />)}
      </div>
      {commentDraft.ready && (
        <form className="grid gap-1" onSubmit={(e) => { e.preventDefault(); void post(); }}>
          <div className="flex gap-2">
            <input className="input" placeholder="Write a comment…" value={commentDraft.value.text} onChange={(e) => commentDraft.setValue({ text: e.target.value })} data-testid="comment-input" />
            <button className="btn acc" disabled={busy || !commentDraft.value.text.trim()} data-testid="comment-send">Post</button>
          </div>
          <DraftNote restoredAt={commentDraft.restoredAt} status={commentDraft.status} onStartOver={() => void commentDraft.clear({ reset: true })} />
        </form>
      )}
      {callDraft.ready && (
        <form className="grid gap-1" onSubmit={(e) => { e.preventDefault(); void logCall(); }}>
          <div className="flex gap-2">
            <input className="input" placeholder="Log a call (what was said)…" value={callDraft.value.text} onChange={(e) => callDraft.setValue({ text: e.target.value })} data-testid="call-input" />
            <button className="btn ghost" disabled={busy || !callDraft.value.text.trim()} data-testid="call-send">Log call</button>
          </div>
          <DraftNote restoredAt={callDraft.restoredAt} status={callDraft.status} onStartOver={() => void callDraft.clear({ reset: true })} />
        </form>
      )}
      <button className="btn ghost sm justify-self-start" onClick={async () => { if (confirm("Take this off the Pitch List?") && (await call("pitches.remove", { id }))) router.replace("/booking"); }}>Remove from Pitch List</button>
    </div>
  );
}

function TimelineRow({ t }: { t: { at: number; who: string; kind: string; a: Row<Activity> & { body?: string } } }) {
  const a = t.a;
  const date = t.at ? new Date(t.at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: BAND_TIME_ZONE }) : "";
  let body: React.ReactNode;
  switch (t.kind) {
    case "status": body = a.fromStatus && a.toStatus ? <>Moved to <b>{STATUS_LABEL[a.toStatus]}</b>{a.text ? ` · ${a.text}` : ""}</> : <>{a.text ?? "Status set"}</>; break;
    case "emailSent": body = <><b>{t.who} sent</b> {a.gmail?.subject} <span className="s">to {a.gmail?.to}</span></>; break;
    case "emailReply": body = <><b>Reply</b> <span className="s">on {a.gmail?.subject}</span><span className="block whitespace-pre-wrap text-sm">{a.text}</span></>; break;
    case "call": body = <><b>{t.who}</b> logged a call: {a.text}</>; break;
    case "comment": body = <><b>{t.who}:</b> {a.body}</>; break;
    default: body = <><b>{t.who}:</b> {a.text}</>;
  }
  return <div className="card" data-testid={`tl-${t.kind}`}><span className="text-sm">{body}</span><span className="s">{date}</span></div>;
}

function EmailPanel({ pitch, artist, contacts, onSent }: { pitch: PitchRow; artist?: Row<Artist>; contacts: Row<Contact>[]; onSent(): void }) {
  const profile = useProfile();
  const b = useBooking();
  const templates = (useCollection<EmailTemplate>("emailTemplates").rows ?? []).filter((t) => !t.targetKinds.length || t.targetKinds.includes(pitch.target.kind));
  const { call, error, busy } = useCommand();

  const people = useMemo(() => {
    const t = pitch.target;
    let ids: string[] = [];
    if (t.kind === "venue") ids = b.venues.find((v) => v.id === t.id)?.contactIds ?? [];
    if (t.kind === "promoter") ids = b.promoters.find((x) => x.id === t.id)?.contactIds ?? [];
    if (t.kind === "edition") { const e = b.editions.find((x) => x.id === t.id); ids = b.festivals.find((f) => f.id === e?.festivalId)?.contactIds ?? []; }
    return ids.map((i) => contacts.find((c) => c.id === i)).filter((c): c is Row<Contact> => !!c && c.emails.length > 0);
  }, [pitch.target, b.venues, b.promoters, b.editions, b.festivals, contacts]);

  const snaps = useCollection<StatSnapshot>("statSnapshots").rows ?? [];
  const [tplId, setTplId] = useState("");
  const [picked, setPicked] = useState<string[] | null>(null);
  const [extra, setExtra] = useState("");
  const [text, setText] = useState<{ subject: string; body: string; dirty: boolean }>({ subject: "", body: "", dirty: false });
  const [markPitched, setMarkPitched] = useState(pitch.status === "idea" || pitch.status === "toPitch");
  const [sent, setSent] = useState(false);

  const defaultTo = people[0] ? [people[0].emails[0]] : [];
  const to = picked ?? defaultTo;
  const recipients = [...to, ...extra.split(/[,\s]+/).filter((x) => x.includes("@"))];

  function context(toList: string[]) {
    const contact = people.find((c) => c.emails.some((e) => toList.includes(e))) ?? people[0];
    const t = pitch.target;
    const venue = t.kind === "venue" ? b.venues.find((v) => v.id === t.id) : undefined;
    const ed = t.kind === "edition" ? b.editions.find((e) => e.id === t.id) : undefined;
    return buildTemplateContext({
      target: { kind: t.kind, name: t.name, city: venue?.address.city, festivalName: ed?.festivalName }, contact, artist,
      configurationName: artist?.configurations.find((c) => c.id === pitch.pitchedAs)?.name, user: profile, stats: statsTemplateFields(snaps),
    });
  }
  function apply(templateId: string, toList: string[], force: boolean) {
    const t = templates.find((x) => x.id === templateId);
    if (!t || (text.dirty && !force)) return;
    const ctx = context(toList);
    setText({ subject: fillTemplate(t.subject, ctx), body: fillTemplate(t.body, ctx), dirty: false });
  }
  const missing = unfilledFields(`${text.subject}\n${text.body}`);

  async function send() {
    const r = await call("pitches.sendEmail", { id: pitch.id, to: [...new Set(recipients)], subject: text.subject, body: text.body, markPitched });
    if (r) { setSent(true); setTimeout(onSent, 800); }
  }

  return (
    <div className="card" data-testid="email-panel">
      <span className="lbl">Template</span>
      <Seg testid="template" value={tplId} onChange={(v) => { setTplId(v); apply(v, to, true); }} options={templates.map((t) => [t.id, t.name] as [string, string])} />
      {templates.length === 0 && <span className="s">No templates yet. <Link href="/booking/templates" className="underline">Add one</Link>.</span>}
      <span className="lbl">To</span>
      <div className="grid gap-1">
        {people.flatMap((c) => c.emails.map((e) => (
          <label key={c.id + e} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={to.includes(e)} data-testid={`to-${e}`}
              onChange={(ev) => { const n = ev.target.checked ? [...to, e] : to.filter((x) => x !== e); setPicked(n); if (tplId) apply(tplId, n, false); }} />
            <b>{c.name}</b> <span className="s">{e}</span>
          </label>
        )))}
        <input className="input" placeholder="Other email addresses" value={extra} onChange={(e) => setExtra(e.target.value)} data-testid="email-extra" />
      </div>
      <span className="lbl">Subject</span>
      <input className="input" value={text.subject} onChange={(e) => setText({ ...text, subject: e.target.value, dirty: true })} data-testid="email-subject" />
      <span className="lbl">Message</span>
      <textarea className="input" rows={9} value={text.body} onChange={(e) => setText({ ...text, body: e.target.value, dirty: true })} data-testid="email-body" />
      {missing.length > 0 && <div className="note s" data-testid="email-missing">Still to fill in: {missing.map((m) => `{{${m}}}`).join(", ")}</div>}
      {(pitch.status === "idea" || pitch.status === "toPitch") && (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={markPitched} onChange={(e) => setMarkPitched(e.target.checked)} data-testid="mark-pitched" />Move to Pitched</label>
      )}
      <span className="s">Sends from {profile.email}</span>
      <ErrorBox error={error} />
      {sent && <span className="chip g self-start" data-testid="email-sent">Sent</span>}
      <button className="btn acc" disabled={busy || sent || !recipients.length || !text.subject.trim() || !text.body.trim() || missing.length > 0} onClick={send} data-testid="email-send">Send</button>
    </div>
  );
}
