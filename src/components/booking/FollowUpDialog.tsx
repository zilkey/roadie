"use client";
import { useMemo, useRef, useState } from "react";
import Link from "@/lib/artist";
import { Dialog, ErrorBox, useCommand } from "@/components/ui";
import { DialogClose } from "@/components/booking/AddContactDialog";
import { useBooking, type PitchRow } from "@/components/booking/common";
import { SignatureBlock, useSignature } from "@/components/email/SignatureBlock";
import { useDoc } from "@/lib/firestore-hooks";
import { textToHtml } from "@/lib/email-html";
import { newMutationId } from "@/lib/commands";
import { email as emailSchema, type EmailThread } from "@/schema";

/**
 * "Write follow-up" on a campaign page (#82, Jeff 2026-11-12): a small composer in a modal, so the table stays put. It replies in
 * the pitch's first thread when Roadie has one (To: whoever wrote last, Subject: Re: …), else starts a new email to the place's
 * first contact. Plain text plus the Gmail signature; "Open the full editor" goes to the compose page (templates, formatting, Cc).
 * testids: follow-up-dialog, follow-up-to, follow-up-subject, follow-up-body, follow-up-send, follow-up-full.
 */
export function FollowUpDialog({ pitch, threadId, onClose }: { pitch: PitchRow | null; threadId?: string; onClose(): void }) {
  return (
    <Dialog open={!!pitch} onClose={onClose} title={pitch ? `Follow up with ${pitch.target.name}` : "Follow up"} testid="follow-up-dialog">
      {pitch && <Form key={`${pitch.id}:${threadId ?? ""}`} pitch={pitch} threadId={threadId} onClose={onClose} />}
    </Dialog>
  );
}

function Form({ pitch, threadId, onClose }: { pitch: PitchRow; threadId?: string; onClose(): void }) {
  const b = useBooking();
  const { doc: thread, loading } = useDoc<EmailThread>("emailThreads", threadId ?? "", { skip: !threadId });
  const signature = useSignature();
  const { call, error, busy } = useCommand();
  const sendId = useRef(newMutationId());
  // The place's contacts with an email, booking contacts first for a venue (an edition's are its festival's).
  const contactEmails = useMemo(() => {
    const t = pitch.target;
    const ids = t.kind === "venue" ? (() => { const v = b.venues.find((x) => x.id === t.id); return v ? [...v.bookingContactIds, ...v.contactIds] : []; })()
      : t.kind === "promoter" ? b.promoters.find((x) => x.id === t.id)?.contactIds ?? []
      : b.festivals.find((f) => f.id === b.editions.find((e) => e.id === t.id)?.festivalId)?.contactIds ?? [];
    return [...new Set(ids.flatMap((id) => b.contacts.find((c) => c.id === id)?.emails.slice(0, 1) ?? []))];
  }, [pitch.target, b.venues, b.promoters, b.festivals, b.editions, b.contacts]);
  const defaultTo = thread ? (thread.lastDirection === "received" ? [thread.lastFrom] : thread.participants.slice(0, 1)) : contactEmails.slice(0, 1);
  const [to, setTo] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const toList = (to ?? defaultTo.join(", ")).split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const subj = subject ?? (thread ? (/^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`) : "");
  const bad = toList.find((a) => !emailSchema.safeParse(a).success);
  const ready = !loading && toList.length > 0 && !bad && !!subj.trim() && !!body.trim();
  const full = `/booking/email/new?${threadId ? `thread=${encodeURIComponent(threadId)}&` : ""}pitch=${pitch.id}`;

  async function send() {
    const sig = signature.signatureHtml;
    const r = await call("email.send", {
      target: { kind: pitch.target.kind, id: pitch.target.id }, pitchId: pitch.id, ...(thread ? { threadId: thread.threadId } : {}),
      to: toList, subject: subj.trim(), body: body.trim(), html: textToHtml(body.trim()) + (sig ? `<br>${sig}` : ""),
    }, { clientMutationId: sendId.current });
    if (r) onClose();
  }

  return (
    <>
      <DialogClose onClose={onClose} testid="follow-up-close" />
      <span className="s -mt-2">{thread ? <>A reply in <b>{thread.subject || "(no subject)"}</b>.</> : "No email in Roadie for this pitch yet: this starts a new one."}</span>
      <label className="grid gap-1"><span className="lbl">To</span>
        <input className="input" value={to ?? defaultTo.join(", ")} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" data-testid="follow-up-to" /></label>
      {bad && <span className="s" role="alert">&quot;{bad}&quot; doesn&apos;t look like an email address.</span>}
      <label className="grid gap-1"><span className="lbl">Subject</span>
        <input className="input" value={subj} onChange={(e) => setSubject(e.target.value)} data-testid="follow-up-subject" /></label>
      <label className="grid gap-1"><span className="lbl">Message</span>
        <textarea className="input min-h-[160px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Just following up on my note about dates…" data-testid="follow-up-body" /></label>
      <SignatureBlock signature={signature} />
      <ErrorBox error={error} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={full} className="link text-sm font-semibold" data-testid="follow-up-full">Open the full editor</Link>
        <span className="flex gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn acc" disabled={!ready || busy} onClick={() => void send()} data-testid="follow-up-send">Send</button>
        </span>
      </div>
    </>
  );
}
