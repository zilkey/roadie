"use client";
import { BAND_TIME_ZONE } from "@/lib/timezone";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useProfile } from "@/lib/auth";
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
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [step, setStep] = useState<{ text: string; due: string } | null>(null);
  const [replies, setReplies] = useState<string | null>(null);
  const nf = useNotFound(loading, p, "pitch");
  const shows = useCollection<Show>("shows").rows ?? [];
  const edition = p?.target.kind === "edition" ? b.editions.find((e) => e.id === p.target.id) : undefined;
  const activity = useCollection<Activity>(`pitches/${id}/activity`).rows ?? [];
  const comments = useCollection<Comment>(`pitches/${id}/comments`).rows ?? [];
  if (nf || !p) return nf;

  const patch = (x: Record<string, unknown>) => call("pitches.update", { id, patch: x });
  const name = (uid?: string) => users.find((u) => u.id === uid)?.name ?? "Someone";
  const flow: Status[] = ["idea", "toPitch", "pitched", "waiting", "talking", "booked"];
  const stepVal = step ?? { text: p.nextStep?.text ?? "", due: p.nextStep?.due ?? "" };
  const timeline = [
    ...activity.map((a) => ({ id: a.id, at: ms(a.createdAt), who: name(a.createdBy), kind: a.type as string, a })),
    ...comments.map((c) => ({ id: c.id, at: ms(c.createdAt), who: name(c.authorId), kind: "comment", a: c as unknown as Row<Activity> & { body?: string } })),
  ].sort((x, y) => y.at - x.at);
  const targetHref = p.target.kind === "edition" ? hrefFor("edition", p.target.id) : hrefFor(p.target.kind, p.target.id);
  const config = artist?.configurations.find((c) => c.id === p.pitchedAs);

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
        <select className="select" value={p.pitchedAs ?? ""} data-testid="pitched-as" disabled={busy}
          onChange={(e) => patch({ pitchedAs: e.target.value || null })}>
          <option value="">Not sure</option>
          {artist?.configurations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="lbl">Who&apos;s on it</span>
        <div className="flex flex-wrap gap-1.5" data-testid="personnel">
          {musicians.filter((m) => m.active || p.personnel.includes(m.id)).sort((a, c) => a.name.localeCompare(c.name)).map((m) => {
            const on = p.personnel.includes(m.id);
            return (
              <button key={m.id} type="button" aria-pressed={on} disabled={busy} data-testid={`person-${m.name}`} className={`btn sm ${on ? "acc" : "ghost"}`}
                onClick={() => patch({ personnel: on ? p.personnel.filter((x) => x !== m.id) : [...p.personnel, m.id] })}>{m.name}</button>
            );
          })}
        </div>
        {config && <span className="s">Filled in from {config.name}. Tap to change.</span>}
        <span className="lbl">Who&apos;s handling it</span>
        <select className="select" value={p.assigneeId ?? ""} data-testid="assignee" disabled={busy} onChange={(e) => patch({ assigneeId: e.target.value || null })}>
          <option value="">No one</option>
          {users.filter((u) => u.role === "admin").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>

      <form className="card" data-testid="next-step" onSubmit={(e) => { e.preventDefault(); patch({ nextStep: stepVal.text && stepVal.due ? stepVal : null }).then(() => setStep(null)); }}>
        <span className="lbl">Next step</span>
        <input className="input" placeholder="e.g. Follow up" value={stepVal.text} onChange={(e) => setStep({ ...stepVal, text: e.target.value })} data-testid="next-text" />
        <input className="input" type="date" value={stepVal.due} onChange={(e) => setStep({ ...stepVal, due: e.target.value })} data-testid="next-due" />
        <div className="flex gap-2">
          <button className="btn sm acc" disabled={busy} data-testid="next-save">Save</button>
          {p.nextStep && <button type="button" className="btn sm ghost" onClick={() => patch({ nextStep: null }).then(() => setStep(null))}>Clear</button>}
        </div>
      </form>

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
      <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (await call("pitches.comment", { id, body: comment })) setComment(""); }}>
        <input className="input" placeholder="Write a comment…" value={comment} onChange={(e) => setComment(e.target.value)} data-testid="comment-input" />
        <button className="btn acc" disabled={busy || !comment.trim()} data-testid="comment-send">Post</button>
      </form>
      <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (await call("pitches.log", { id, type: "call", text: note })) setNote(""); }}>
        <input className="input" placeholder="Log a call (what was said)…" value={note} onChange={(e) => setNote(e.target.value)} data-testid="call-input" />
        <button className="btn ghost" disabled={busy || !note.trim()} data-testid="call-send">Log call</button>
      </form>
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
