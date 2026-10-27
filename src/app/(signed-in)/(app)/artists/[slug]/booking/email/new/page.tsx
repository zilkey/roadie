"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, PickChip, Select, useCommand } from "@/components/ui";
import { BackLink, hrefFor, useBooking } from "@/components/booking/common";
import { RichTextEditor } from "@/components/email/RichTextEditor";
import { SignatureBlock, useSignature } from "@/components/email/SignatureBlock";
import { useProfile } from "@/lib/auth";
import { useCollection, useDoc, type Row } from "@/lib/firestore-hooks";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { draftPath } from "@/schema/drafts";
import { buildTemplateContext, fillTemplate, unfilledFields } from "@/lib/booking";
import { htmlToText, textToHtml } from "@/lib/email-html";
import { fieldsInWords, nameFromAddress, parseTarget } from "@/lib/email-compose";
import { ROLE_LABEL, rolesOf, roleFirst, type ContactRole } from "@/lib/venues";
import { statsTemplateFields } from "@/lib/stats";
import { email as emailSchema, type Contact, type EmailTemplate, type EmailThread, type StatSnapshot } from "@/schema";

export default function Page() {
  return <AdminOnly><Suspense fallback={<div className="s">Loading…</div>}><Compose /></Suspense></AdminOnly>;
}

/** With `thread=` the thread's doc is read first, so the form starts from it. */
function Compose() {
  const params = useSearchParams();
  const thread = params.get("thread");
  return thread ? <WithThread id={thread} /> : <ComposeForm thread={null} />;
}
function WithThread({ id }: { id: string }) {
  const { doc, loading } = useDoc<EmailThread>("emailThreads", id);
  if (loading) return <div className="s">Loading…</div>;
  if (!doc) return <div className="empty" data-testid="compose-missing">That thread isn&apos;t on Roadie any more.</div>;
  return <ComposeForm thread={doc} />;
}

type Kind = "venue" | "promoter" | "festival" | "edition";
type Form = { to: string[] | null; cc: string[]; ccOpen: boolean; subject: string | null; html: string; tpl: string };
const BLANK: Form = { to: null, cc: [], ccOpen: false, subject: null, html: "", tpl: "" };
const PLURAL = { venue: "venues", promoter: "promoters", festival: "festivals" } as const;

function ComposeForm({ thread }: { thread: Row<EmailThread> | null }) {
  const params = useSearchParams();
  const router = useRouter();
  const { doc: artist } = useArtist();
  const profile = useProfile();
  const b = useBooking();
  const { call, error, busy } = useCommand();
  const signature = useSignature();
  const snaps = useCollection<StatSnapshot>("statSnapshots").rows ?? [];
  const allTemplates = useCollection<EmailTemplate>("emailTemplates").rows ?? [];

  // Where this email goes: ?target=venue:<id>, else the pitch's target, else the thread's place.
  const pitchId = params.get("pitch") ?? thread?.pitchId ?? "";
  const pitch = b.pitches.find((p) => p.id === pitchId);
  const target = parseTarget(params.get("target")) ?? (thread ? { kind: thread.target.kind, id: thread.target.id } : pitch ? { kind: pitch.target.kind as Kind, id: pitch.target.id } : null);
  const place = useMemo(() => {
    if (!target) return null;
    if (target.kind === "venue") {
      const v = b.venues.find((x) => x.id === target.id);
      return v ? { kind: "venue" as const, id: v.id, name: v.name, contactIds: v.contactIds, booking: v.bookingContactIds, v } : null;
    }
    if (target.kind === "promoter") {
      const p = b.promoters.find((x) => x.id === target.id);
      return p ? { kind: "promoter" as const, id: p.id, name: p.name, contactIds: p.contactIds, booking: [] as string[], v: null } : null;
    }
    const festivalId = target.kind === "edition" ? b.editions.find((e) => e.id === target.id)?.festivalId : target.id;
    const f = b.festivals.find((x) => x.id === festivalId);
    return f ? { kind: "festival" as const, id: f.id, name: f.name, contactIds: f.contactIds, booking: [] as string[], v: null } : null;
  }, [target?.kind, target?.id, b.venues, b.promoters, b.festivals, b.editions]); // eslint-disable-line react-hooks/exhaustive-deps

  const draft = useDraft(pitchId ? draftPath.newUnder("pitches", pitchId, "emails") : draftPath.newIn("emails"), BLANK,
    { title: (v) => `Email to ${place?.name ?? "a place"}${v.subject ? ` · ${v.subject}` : ""}` });
  const f = draft.value;
  const set = (p: Partial<Form>) => draft.setValue({ ...draft.value, ...p });

  const people = useMemo(() => {
    if (!place) return [] as Row<Contact>[];
    const mine = place.contactIds.map((id) => b.contacts.find((c) => c.id === id)).filter((c): c is Row<Contact> => !!c && c.emails.length > 0);
    return place.kind === "venue" ? roleFirst(mine, place.booking) : mine;
  }, [place, b.contacts]);

  // The To row. Until the person changes it, it is the ?to= contact, else (new email) the first booking contact, else (a reply) whoever wrote last.
  const wanted = params.get("to");
  const defaultTo = useMemo(() => {
    const pick = people.find((c) => c.id === wanted) ?? (thread ? undefined : people[0]);
    if (pick) return [pick.emails[0]];
    if (thread) return thread.lastDirection === "received" ? [thread.lastFrom] : thread.participants.slice(0, 1);
    return [];
  }, [people, wanted, thread]);
  const to = f.to ?? defaultTo;
  const cc = f.cc;
  const subject = f.subject ?? (thread ? (/^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`) : "");

  const contactOf = (addr: string) => b.contacts.find((c) => c.emails.includes(addr));
  const labelOf = (addr: string) => contactOf(addr)?.name ?? addr;

  // Templates
  const kind: Kind = target?.kind ?? "venue";
  const templates = allTemplates.filter((t) => !t.targetKinds.length || (t.targetKinds as string[]).includes(kind) || (kind === "festival" && t.targetKinds.includes("edition")));
  const chosen = templates.find((t) => t.id === f.tpl);
  const applied = useRef<{ subject: string; html: string } | null>(null);
  const dirty = (subject.trim() !== "" || htmlToText(f.html).trim() !== "") && (!applied.current || applied.current.subject !== subject || applied.current.html !== f.html);

  function context() {
    const contact = people.find((c) => c.emails.some((e) => to.includes(e))) ?? contactOf(to[0] ?? "") ?? people[0];
    const edition = target?.kind === "edition" ? b.editions.find((e) => e.id === target.id) : undefined;
    return buildTemplateContext({
      target: { kind: target?.kind ?? "venue", name: place?.name ?? "", city: place?.v?.address.city, festivalName: edition?.festivalName },
      contact, artist: artist ?? undefined, configurationName: artist?.configurations.find((c) => c.id === pitch?.pitchedAs)?.name,
      user: profile, stats: statsTemplateFields(snaps),
    });
  }
  function pick(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) { set({ tpl: "" }); return; }
    if (dirty && !confirm("Replace what you've written with this template?")) return;
    const ctx = context();
    const next = { subject: fillTemplate(t.subject, ctx), html: textToHtml(fillTemplate(t.body, ctx)) };
    applied.current = next;
    set({ tpl: id, ...next });
  }

  // Recipients
  const [typed, setTyped] = useState({ to: "", cc: "" });
  const [typedError, setTypedError] = useState("");
  function addTyped(field: "to" | "cc") {
    const raw = typed[field].trim().replace(/,$/, "").trim().toLowerCase();
    if (!raw) return;
    if (!emailSchema.safeParse(raw).success) { setTypedError(`"${raw}" doesn't look like an email address.`); return; }
    setTypedError("");
    setTyped((t) => ({ ...t, [field]: "" }));
    const have = field === "to" ? to : cc;
    if (!have.includes(raw)) set(field === "to" ? { to: [...to, raw] } : { cc: [...cc, raw] });
  }
  const removeAddr = (field: "to" | "cc", addr: string) => set(field === "to" ? { to: to.filter((x) => x !== addr) } : { cc: cc.filter((x) => x !== addr) });
  const addressInput = (field: "to" | "cc") => (
    <input className="input min-w-[12rem] flex-1 !border-0 !shadow-none" placeholder={field === "to" ? "Type a name or address…" : "Add a Cc…"} aria-label={field === "to" ? "Add a recipient" : "Add a Cc"}
      value={typed[field]} data-testid={`${field}-input`}
      onChange={(e) => { setTyped({ ...typed, [field]: e.target.value }); setTypedError(""); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTyped(field); } }}
      onBlur={() => addTyped(field)} />
  );
  const chips = (field: "to" | "cc") => (field === "to" ? to : cc).map((a) => (
    <span key={a} className="chip w lg" data-testid={`${field}-chip-${a}`}>
      {labelOf(a)}
      <button type="button" aria-label={`Remove ${labelOf(a)}`} onClick={() => removeAddr(field, a)} data-testid={`${field}-remove-${a}`}>×</button>
    </span>
  ));

  const togglePerson = (c: Row<Contact>) => {
    const on = c.emails.some((e) => to.includes(e));
    set({ to: on ? to.filter((e) => !c.emails.includes(e)) : [...to, c.emails[0]] });
  };

  // Unknown address prompt
  const [skipped, setSkipped] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<"booking" | "dayOf" | "both">("booking");
  const unknown = place ? [...to, ...cc].find((a) => !contactOf(a) && !skipped.includes(a)) : undefined;
  useEffect(() => { setAdding(false); setNewName(unknown ? nameFromAddress(unknown) : ""); }, [unknown]);
  async function addContact() {
    if (!unknown || !place || !newName.trim()) return;
    const r = await call<{ id: string }>("contacts.create", { name: newName.trim(), emails: [unknown], attachTo: { kind: PLURAL[place.kind], id: place.id } });
    if (!r) return;
    if (place.kind === "venue") {
      const roles: ContactRole[] = newRole === "both" ? ["booking", "dayOf"] : [newRole];
      if (!(await call("contacts.setRoles", { contactId: r.id, venueId: place.id, roles }))) return;
    }
    setAdding(false);
  }

  // Message
  const sigHtml = signature.signatureHtml;
  const html = f.html + (sigHtml ? `<br>${sigHtml}` : "");
  const text = htmlToText(f.html).trim();
  const missing = unfilledFields(`${subject}\n${htmlToText(f.html)}`);
  const canMark = pitch?.status === "idea" || pitch?.status === "toPitch";
  const [markPitched, setMarkPitched] = useState(true);
  const [drafted, setDrafted] = useState(false);
  const sendId = useRef(newMutationId());

  const back = thread ? `/booking/email/${thread.id}` : pitchId ? `/booking/pitches/${pitchId}` : place ? hrefFor(place.kind, place.id) : "/booking";
  const backLabel = thread ? "Thread" : pitchId ? "Pitch" : place ? place.name : "Booking";
  const query = `target=${target ? `${target.kind}:${target.id}` : ""}${pitchId ? `&pitch=${pitchId}` : ""}`;

  const payload = () => ({
    target: target!, ...(pitchId ? { pitchId } : {}), ...(thread ? { threadId: thread.threadId } : {}),
    to, ...(cc.length ? { cc } : {}), subject: subject.trim(), body: htmlToText(html).trim(), html,
  });
  const ready = draft.ready && !!target && !!place;
  const canSend = ready && !busy && to.length > 0 && !!subject.trim() && !!text && missing.length === 0;

  async function send() {
    await draft.settle();
    const r = await call<{ id: string }>("email.send", { ...payload(), ...(canMark ? { markPitched } : {}) }, { clientMutationId: sendId.current, clearDraft: draft.draftId });
    if (r?.id) { await draft.clear(); router.push(`/booking/email/${r.id}`); }
  }
  async function saveDraft() {
    setDrafted(false);
    if (await call("email.draft", payload())) setDrafted(true);
  }
  async function cancel() {
    await draft.clear();
    router.push(back);
  }

  if (!target || (b.venues.length + b.promoters.length + b.festivals.length > 0 && !place)) {
    return <div className="empty" data-testid="compose-missing">Pick a venue, promoter or festival to write to. <Link href="/booking" className="underline">Back to Booking</Link></div>;
  }
  const word = place?.kind === "festival" ? "festival" : place?.kind === "promoter" ? "promoter" : "venue";
  const words = chosen ? fieldsInWords(chosen.subject, chosen.body) : "";

  return (
    <div className="show-page" data-testid="compose-page">
      <PageTitle back={<BackLink href={back} label={backLabel} />} title={thread ? "Reply" : "New email"}
        sub={thread ? <>Reply on {thread.subject} · from {profile.email}</> : <>Starts a thread on {place?.name ?? "…"} · from {profile.email}</>}
        actions={<Link href={`/booking/email/search?${query}`} className="btn ghost" data-testid="reply-instead">Reply to one they sent instead</Link>} />
      <ErrorBox error={error} />

      <section className="card">
        {people.length > 0 && (
          <div className="grid gap-1.5" data-testid="compose-contacts">
            <span className="lbl">Contacts here</span>
            <div className="flex flex-wrap gap-1.5">
              {people.map((c) => (
                <PickChip key={c.id} on={c.emails.some((e) => to.includes(e))} onToggle={() => togglePerson(c)} testid={`contact-pick-${c.name}`}>
                  {c.name}
                  {place?.v && rolesOf(place.v, c.id).map((r) => <span key={r} className="chip a" data-testid={`contact-pick-role-${r}`}>{ROLE_LABEL[r]}</span>)}
                </PickChip>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-1.5">
          <span className="lbl">To</span>
          <div className="input flex flex-wrap items-center gap-1.5" data-testid="to-row">
            {chips("to")}
            {addressInput("to")}
            {!f.ccOpen && <button type="button" className="btn sm ghost" onClick={() => set({ ccOpen: true })} data-testid="cc-toggle">Cc</button>}
          </div>
          {typedError && <span className="s" role="alert" data-testid="to-error">{typedError}</span>}
        </div>
        {f.ccOpen && (
          <div className="grid gap-1.5">
            <span className="lbl">Cc</span>
            <div className="input flex flex-wrap items-center gap-1.5" data-testid="cc-row">{chips("cc")}{addressInput("cc")}</div>
          </div>
        )}

        {unknown && (
          <div className="d-warn" role="group" aria-label="Add this person as a contact" data-testid="add-contact-prompt">
            <div className="grid min-w-0 flex-1 gap-2">
              <span><b>{unknown}</b> isn&apos;t a contact yet. Add this person as a contact on {place?.name}?</span>
              {adding ? (
                <div className="grid gap-2" data-testid="add-contact-form">
                  <label className="grid gap-1"><span className="lbl">Name</span>
                    <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} data-testid="add-contact-name" /></label>
                  {place?.kind === "venue" && (
                    <label className="grid gap-1"><span className="lbl">Role</span>
                      <Select<"booking" | "dayOf" | "both"> testid="add-contact-role" label="Role" value={newRole} onChange={setNewRole}
                        options={[["booking", "Booking"], ["dayOf", "Day-of"], ["both", "Booking and day-of"]]} /></label>
                  )}
                  <label className="grid gap-1"><span className="lbl">Email</span>
                    <input className="input" value={unknown} readOnly data-testid="add-contact-email" /></label>
                  <div className="flex gap-2">
                    <button type="button" className="btn acc" disabled={busy || !newName.trim()} onClick={() => void addContact()} data-testid="add-contact-save">Add</button>
                    <button type="button" className="btn ghost" onClick={() => setAdding(false)} data-testid="add-contact-cancel">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button type="button" className="btn acc sm" onClick={() => setAdding(true)} data-testid="add-contact-open">Add as contact</button>
                  <button type="button" className="btn ghost sm" onClick={() => setSkipped([...skipped, unknown])} data-testid="add-contact-skip">Not now</button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-1.5">
          <span className="lbl">From</span>
          <span className="text-sm" data-testid="email-from">{profile.name} <span className="s">&lt;{profile.email}&gt;</span></span>
        </div>

        <label className="grid gap-1.5">
          <span className="lbl">Subject</span>
          <input className="input" value={subject} onChange={(e) => set({ subject: e.target.value })} data-testid="email-subject" disabled={!draft.ready} />
        </label>

        {!thread && (
          <div className="grid gap-1.5">
            <span className="lbl">Start from a template</span>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Select testid="template" label="Start from a template" value={f.tpl} placeholder="No template" onChange={pick} options={templates.map((t) => [t.id, t.name] as [string, string])} />
              {words && <span className="s" data-testid="template-fills">Fills in {words}</span>}
            </div>
            {templates.length === 0 && <span className="s">No templates yet. <Link href="/booking/templates" className="underline">Add one</Link>.</span>}
          </div>
        )}

        <div className="grid gap-1.5">
          <span className="lbl">Message</span>
          {draft.ready
            ? <RichTextEditor value={f.html} onChange={(h) => set({ html: h })} placeholder="Write your message…" testid="email-body" />
            : <div className="input" aria-busy>Loading…</div>}
          <SignatureBlock signature={signature} />
        </div>
        {missing.length > 0 && <div className="note s" data-testid="email-missing">Still to fill in: {missing.map((m) => `{{${m}}}`).join(", ")}</div>}

        <div className="note s" data-testid="email-note">
          Sends from your Gmail, so it shows in Sent there too. {thread ? "The reply stays on the thread." : `The thread lands on this ${word}${pitchId ? " and on the pitch" : ""}`}, and replies come back here.
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid gap-1">
            {canMark && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={markPitched} onChange={(e) => setMarkPitched(e.target.checked)} data-testid="mark-pitched" />Move pitch to Pitched</label>
            )}
            <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {drafted && <span className="chip g" data-testid="email-drafted">Draft saved in Gmail</span>}
            <button type="button" className="btn ghost" onClick={() => void cancel()} data-testid="email-cancel">Cancel</button>
            <button type="button" className="btn ghost" disabled={!canSend} onClick={() => void saveDraft()} data-testid="email-draft">Save draft in Gmail</button>
            <button type="button" className="btn acc" disabled={!canSend} onClick={() => void send()} data-testid="email-send">Send</button>
          </div>
        </div>
      </section>
    </div>
  );
}
