"use client";
import { Crumbs, campaignCrumb, placeTrail, sectionCrumb, type Crumb } from "@/components/booking/BookingNav";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import Link, { useArtist, useArtistRouter as useRouter, useHref, useZone } from "@/lib/artist";
import { previousPath, subscribeNav } from "@/lib/navHistory";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { Menu } from "@/components/Menu";
import { hrefFor, useBooking, useNotFound } from "@/components/booking/common";
import { BackLink } from "@/components/BackLink";
import { RichTextEditor } from "@/components/email/RichTextEditor";
import { SignatureBlock, useSignature } from "@/components/email/SignatureBlock";
import { useProfile } from "@/lib/auth";
import { useDoc, type Row } from "@/lib/firestore-hooks";
import { linkify } from "@/lib/linkify";
import { htmlToText, sanitizeHtml } from "@/lib/email-html";
import { initialsOf, paragraphsOf, previewOf, replyRecipients, splitQuoted } from "@/lib/email-text";
import { pitchCellText } from "@/lib/booking";
import { hasNewReply, threadPitchIds, type EmailThread } from "@/schema";
import { StatusChip } from "@/components/booking/common";
import { isActive, STATUS_LABEL } from "@/lib/booking";
import { coverSuggestions } from "@/lib/coverSuggestions";
import { PickDialog } from "@/components/booking/PickDialog";
import { PlusButton } from "@/components/InlineValue";

type Message = { id: string; threadId: string; direction: "sent" | "received"; from: string; fromName: string; to: string[]; cc: string[]; subject: string; body: string; date: string;
  /** The message as formatted (sanitized on the server, quote split off); missing when the page shows the plain text. */ html?: string; quotedHtml?: string };

const shortDate = (iso: string, zone: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: zone });
const longDate = (iso: string, zone: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: zone });
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export default function Page() {
  return <AdminOnly><ThreadPage /></AdminOnly>;
}

function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { doc: t, loading } = useDoc<EmailThread>("emailThreads", id);
  const nf = useNotFound(loading, t, "thread");
  const b = useBooking();
  const artist = useArtist().doc;
  const profile = useProfile();
  const { call, error, busy } = useCommand();
  const full = useHref();
  const prev = useSyncExternalStore(subscribeNav, previousPath, () => undefined);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [sentBy, setSentBy] = useState<Record<string, string>>({}); // Gmail message id → the admin who wrote it from Roadie
  const [fresh, setFresh] = useState<boolean | null>(null); // "New" is decided before opening the thread marks it seen
  const loaded = useRef(false);

  const load = useCallback(async () => {
    const r = await call<{ messages: Message[]; sentBy?: Record<string, string> }>("email.thread", { id });
    if (r) { setMessages([...r.messages].sort((x, y) => x.date.localeCompare(y.date))); setSentBy(r.sentBy ?? {}); }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (loaded.current || !t) return;
    loaded.current = true;
    setFresh(hasNewReply(t));
    void load();
  }, [t, load]);

  const nameOf = useCallback((addr: string, fromName = "") => {
    const a = addr.toLowerCase();
    if (a === profile.email.toLowerCase()) return profile.name;
    return b.contacts.find((c) => c.emails.includes(a))?.name ?? (fromName || addr);
  }, [b.contacts, profile.email, profile.name]);

  if (nf || !t) return nf;

  const pitch = t.pitchId ? b.pitches.find((p) => p.id === t.pitchId) : undefined;
  const trail = threadTrail(t, b, prev, full);
  const parent = trail[trail.length - 1];
  const cell = pitch ? pitchCellText(pitch, artist?.configurations ?? []) : null;
  const subject = t.subject || "(no subject)";

  return (
    <div className="show-page" data-testid="thread-page">
      <PageTitle back={<Crumbs fixed items={[...trail, { label: "Email" }]} back={<BackLink href={parent.href!} label={parent.label} />} />} title="Email Thread"
        sub={<>
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="min-w-0 truncate" title={subject} data-testid="thread-subject">{subject}</span>
            <span aria-hidden>·</span>
            <a className="shrink-0 whitespace-nowrap font-semibold underline" href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(t.threadId)}`} target="_blank" rel="noopener noreferrer" data-testid="open-in-gmail">Open in Gmail ↗</a>
          </span>
          {pitch && cell && <Link href={`/booking/pitches/${pitch.id}`} className="s block font-semibold underline" data-testid="thread-pitch">Pitch: {cell.config}, {cell.dates}</Link>}
        </>}
        actions={<Menu label="More actions" testid="thread" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>} items={[{ key: "unlink", label: `Unlink from ${t.target.name}`, danger: true,
          onSelect: async () => { if (confirm(`Take this thread off ${t.target.name}? The pitch's activity keeps its entries.`) && (await call("email.unlink", { id }))) router.replace(parent.href!); } }]} />} />
      <p className="s" data-testid="thread-private">Only {artist?.name ?? "your band"} sees this · sent and received from {t.account}</p>
      <ErrorBox error={error} />
      <CoversCard t={t} />
      {messages !== null && (
        <div className="grid gap-3" data-testid="thread-messages">
          {messages.map((m, n) => <MessageView key={m.id} m={m} n={n} last={n === messages.length - 1} isNew={n === messages.length - 1 && m.direction === "received" && fresh === true} account={t.account} sentBy={sentBy[m.id]} nameOf={nameOf} />)}
        </div>
      )}
      {messages !== null && <ReplyCard t={t} messages={messages} nameOf={nameOf} busy={busy} onSent={load} />}
    </div>
  );
}

/**
 * The trail down to this thread, by where it was opened from: a pitch page → Campaigns › that pitch's campaign (or Ongoing)
 * › the pitch, as on the pitch page; its place's page (or a covered pitch's edition page) → that section › the place. Opened
 * from anywhere else, or on a fresh load: its first pitch's trail, else its place's.
 */
function threadTrail(t: Row<EmailThread>, b: ReturnType<typeof useBooking>, prev: string | undefined, full: (href: string) => string): Crumb[] {
  const covered = threadPitchIds(t).map((id) => b.pitches.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
  const placeHref = hrefFor(t.target.kind, t.target.id);
  const place = placeTrail(t.target.kind, t.target.id, t.target.name);
  const pitchTrail = (p: (typeof b.pitches)[number]) =>
    placeTrail(p.target.kind, p.target.id, p.target.name, p.id, campaignCrumb(b.campaigns.find((c) => c.id === p.campaignId), isActive(p.status)));
  if (prev === full(placeHref)) return place;
  // Any pitch page counts, not only one the thread covers: its Email card lists every thread of the place.
  const fromPitch = b.pitches.find((p) => prev === full(`/booking/pitches/${p.id}`));
  if (fromPitch) return pitchTrail(fromPitch);
  const fromEdition = b.pitches.find((p) => p.target.kind === "edition" && prev === full(hrefFor("edition", p.target.id)));
  if (fromEdition) return [sectionCrumb("festival"), { label: t.target.name, href: placeHref }, { label: fromEdition.target.name, href: hrefFor("edition", fromEdition.target.id) }];
  return covered[0] ? pitchTrail(covered[0]) : place;
}

function MessageView({ m, n, last, isNew, account, sentBy, nameOf }: { m: Message; n: number; last: boolean; isNew: boolean; account: string; sentBy?: string; nameOf(a: string, fromName?: string): string }) {
  const [open, setOpen] = useState(last);
  const zone = useZone();
  const [quoteOpen, setQuoteOpen] = useState(false);
  const sent = m.direction === "sent";
  const who = nameOf(m.from, m.fromName);
  const { text, quoted } = splitQuoted(m.body);
  // Sanitized again here, so the page never trusts HTML it didn't clean itself.
  const html = useMemo(() => (m.html ? sanitizeHtml(m.html, { newTab: true }) : null), [m.html]);
  const quotedHtml = useMemo(() => (m.html && m.quotedHtml ? sanitizeHtml(m.quotedHtml, { newTab: true }) : ""), [m.html, m.quotedHtml]);
  const toText = m.to.map((a) => (a.toLowerCase() === account.toLowerCase() ? "me" : nameOf(a))).join(", ");
  return (
    <article className={`msg${sent ? " me" : ""}`} data-testid={`msg-${n}`} data-direction={m.direction}>
      <button type="button" className="msg-head" aria-expanded={open} onClick={() => setOpen(!open)} data-testid={`msg-toggle-${n}`}>
        <span className={`avatar${sent ? "" : " grey"}`} aria-hidden>{initialsOf(who)}</span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex flex-wrap items-center gap-2"><b>{who}</b>{isNew && <span className="chip a" data-testid="msg-new">New</span>}</span>
          {open && sentBy && <span className="s truncate" data-testid={`msg-sent-by-${n}`}>Sent by {sentBy} from {m.from}</span>}
          {open
            ? <span className="s truncate">{who} &lt;{m.from}&gt; · to {toText}{m.cc.length > 0 && <> · cc {m.cc.map((a) => nameOf(a)).join(", ")}</>}</span>
            : <span className="s truncate" data-testid={`msg-preview-${n}`}>{previewOf(m.body)}</span>}
        </span>
        <span className="s shrink-0">{open ? longDate(m.date, zone) : shortDate(m.date, zone)}</span>
      </button>
      {open && (
        <div className="msg-body" data-testid={`msg-body-${n}`}>
          {html !== null
            ? <div className="msg-html" data-testid={`msg-html-${n}`} dangerouslySetInnerHTML={{ __html: html }} />
            : paragraphsOf(text).map((p, i) => (
              <p key={i}>{linkify(p).map((s, j) => (s.href ? <a key={j} href={s.href} target="_blank" rel="noopener noreferrer">{s.text}</a> : s.text))}</p>
            ))}
          {(quotedHtml || quoted) && (
            <>
              <button type="button" className="quote-toggle" aria-label="Show quoted text" aria-expanded={quoteOpen} onClick={() => setQuoteOpen(!quoteOpen)} data-testid={`quote-toggle-${n}`}>···</button>
              {quoteOpen && (quotedHtml
                ? <blockquote className="msg-quote msg-html mt-2" data-testid={`quote-${n}`} dangerouslySetInnerHTML={{ __html: quotedHtml }} />
                : <blockquote className="msg-quote mt-2" data-testid={`quote-${n}`}>{quoted}</blockquote>)}
            </>
          )}
        </div>
      )}
    </article>
  );
}

function ReplyCard({ t, messages, nameOf, busy, onSent }: { t: Row<EmailThread>; messages: Message[]; nameOf(a: string, fromName?: string): string; busy: boolean; onSent(): Promise<void> }) {
  const last = messages[messages.length - 1];
  const [mode, setMode] = useState<"reply" | "all">("reply");
  const defaultTo = useMemo(() => replyRecipients(mode, last, t.participants, t.account), [mode, last, t.participants, t.account]);
  const [to, setTo] = useState<string[] | null>(null); // null = follow the segment
  const [cc, setCc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [html, setHtml] = useState("");
  const [typed, setTyped] = useState("");
  const [typedCc, setTypedCc] = useState("");
  const [note, setNote] = useState<string | null>(null);
  /** The last draft saved in Gmail: its link there, for Schedule send. */
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [dup, setDup] = useState<{ field: "to" | "cc"; msg: string } | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const sig = useSignature();
  const { call, error, busy: working } = useCommand();
  const recipients = to ?? defaultTo;
  const subject = /^re:/i.test(t.subject) ? t.subject : `Re: ${t.subject}`;

  const outgoing = html + (sig.signatureHtml ? `<br>${sig.signatureHtml}` : "");
  const body = htmlToText(outgoing).trim();
  const canSend = !busy && !working && recipients.length > 0 && htmlToText(html).trim().length > 0;

  // An address that's already on the reply stays in the box with a note (instead of vanishing); the note clears once it's edited or the other copy is removed.
  function add(field: "to" | "cc", list: string[], set: (v: string[]) => void, raw: string, setValue: (v: string) => void) {
    const parts = raw.split(/[,\s;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return;
    const valid = parts.filter((p) => EMAIL_RE.test(p));
    const dups = valid.filter((p) => recipients.includes(p) || cc.includes(p));
    const ok = valid.filter((p) => !dups.includes(p));
    if (ok.length) set([...new Set([...list, ...ok])]);
    if (dups.length) { setDup({ field, msg: `${dups.join(", ")} ${dups.length > 1 ? "are" : "is"} already added.` }); setValue(dups.join(", ")); }
    else if (ok.length === parts.length) setValue("");
  }
  const input = (field: "to" | "cc", list: string[], set: (v: string[]) => void, value: string, setValue: (v: string) => void, testid: string) => (
    <input className="to-input" placeholder="Add someone…" aria-label="Add someone" value={value} data-testid={testid}
      onChange={(e) => { const v = e.target.value; setDup(null); if (v.endsWith(",")) add(field, list, set, v, setValue); else setValue(v); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(field, list, set, value, setValue); } }}
      onBlur={() => add(field, list, set, value, setValue)} />
  );
  const chip = (a: string, remove: () => void, testid: string) => (
    <span key={a} className="chip w lg" data-testid={testid}>
      {nameOf(a) !== a ? <>{nameOf(a)}<span className="ml-1 font-normal text-[var(--muted)]">&lt;{a}&gt;</span></> : a}
      <button type="button" aria-label={`Remove ${a}`} onClick={() => { setDup(null); remove(); }}>×</button>
    </span>
  );

  const payload = () => ({
    target: { kind: t.target.kind, id: t.target.id }, threadId: t.threadId, ...(t.pitchId ? { pitchId: t.pitchId } : {}),
    to: recipients, ...(cc.length ? { cc } : {}), subject, body, html: outgoing,
  });
  function discard() { setHtml(""); setEditorKey((k) => k + 1); setTo(null); setCc([]); setShowCc(false); setNote(null); setDup(null); }
  async function send() {
    setNote(null);
    if (await call("email.send", payload())) { discard(); setNote("Sent"); await onSent(); }
  }
  async function draft() {
    setNote(null); setDraftUrl(null);
    const r = await call<{ gmailUrl?: string }>("email.draft", payload());
    if (r) { discard(); setNote("Draft saved in Gmail: open it there to send or Schedule send"); setDraftUrl(r.gmailUrl ?? null); }
  }

  return (
    <section className="reply-card" data-testid="reply-card" aria-label="Reply">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold">Reply</h2>
        <div className="seg" role="radiogroup" aria-label="Who to reply to">
          <label><input type="radio" name="reply-mode" checked={mode === "reply"} onChange={() => { setMode("reply"); setTo(null); }} data-testid="reply-mode-one" />Reply</label>
          <label><input type="radio" name="reply-mode" checked={mode === "all"} onChange={() => { setMode("all"); setTo(null); }} data-testid="reply-mode-all" />Reply all</label>
        </div>
      </div>
      <div className="to-row" data-testid="reply-to">
        <span className="lbl">To</span>
        {recipients.map((a) => chip(a, () => setTo(recipients.filter((x) => x !== a)), `reply-to-${a}`))}
        {input("to", recipients, setTo, typed, setTyped, "reply-to-input")}
        {!showCc && <button type="button" className="btn sm ghost" onClick={() => setShowCc(true)} data-testid="reply-cc-toggle">Cc</button>}
      </div>
      {dup?.field === "to" && <span className="s" role="alert" data-testid="reply-to-error">{dup.msg}</span>}
      {showCc && (
        <div className="to-row" data-testid="reply-cc">
          <span className="lbl">Cc</span>
          {cc.map((a) => chip(a, () => setCc(cc.filter((x) => x !== a)), `reply-cc-${a}`))}
          {input("cc", cc, setCc, typedCc, setTypedCc, "reply-cc-input")}
        </div>
      )}
      {dup?.field === "cc" && <span className="s" role="alert" data-testid="reply-cc-error">{dup.msg}</span>}
      <RichTextEditor key={editorKey} value={html} onChange={setHtml} placeholder="Write a reply…" testid="reply-body" />
      <SignatureBlock signature={sig} />
      <ErrorBox error={error} />
      {note && <span className="flex flex-wrap items-center gap-2"><span className="chip g self-start" data-testid="reply-note">{note}</span>
        {draftUrl && <a href={draftUrl} target="_blank" rel="noreferrer" className="btn sm acc" data-testid="reply-draft-open">Open in Gmail</a>}</span>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" className="btn ghost" onClick={discard} disabled={working} data-testid="reply-discard">Discard</button>
        <button type="button" className="btn" onClick={draft} disabled={!canSend} data-testid="reply-draft">Save draft in Gmail</button>
        <button type="button" className="btn acc" onClick={send} disabled={!canSend} data-testid="reply-send">Send</button>
      </div>
    </section>
  );
}

/**
 * "This email covers" (#82 S8b): every pitch the thread is logged on (pitchIds ?? [pitchId]), each linking to its pitch with
 * its status. The + puts one more of the band's active pitches on it (email.link with pitchIds): its replies then reach that
 * pitch too. The picker puts the likely ones first (coverSuggestions: someone on the email, same promoter, same campaign) and
 * finds any other by name.
 */
function CoversCard({ t }: { t: Row<EmailThread> }) {
  const b = useBooking();
  const { call, error, busy } = useCommand();
  const [picking, setPicking] = useState(false);
  const ids = threadPitchIds(t);
  const on = ids.map((id) => b.pitches.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
  const items = useMemo(() => coverSuggestions(t, on, b.pitches.filter((p) => isActive(p.status) && !ids.includes(p.id)), b,
    (s) => STATUS_LABEL[s as keyof typeof STATUS_LABEL] ?? s), [t, b]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = { kind: t.target.kind === "act" ? "act" : t.target.kind, id: t.target.id } as { kind: "venue" | "promoter" | "festival" | "act"; id: string };
  async function remove(pitchId: string, name: string) {
    if (confirm(`Take this email off ${name}? Its entries come off that pitch's timeline (a bounced send, say). It stays on ${t.target.name}.`)) await call("email.unlink", { id: t.id, pitchId });
  }
  return (
    <section className="card" data-testid="thread-covers">
      <div className="card-head"><h2>This email covers</h2><PlusButton label="Add a pitch this email covers" testid="thread-covers-add" onClick={() => setPicking(true)} /></div>
      {on.length === 0 ? <span className="s">No pitch yet.</span> : (
        <ul className="grid gap-1.5" data-testid="thread-covers-list">
          {on.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2" data-testid={`covers-${p.id}`}>
              <Link href={`/booking/pitches/${p.id}`} className="font-semibold">{p.target.name}</Link><StatusChip status={p.status} />
              <button type="button" className="btn sm ghost" disabled={busy} aria-label={`Take this email off ${p.target.name}`} title={`Take this email off ${p.target.name}`} data-testid={`covers-remove-${p.id}`}
                onClick={() => void remove(p.id, p.target.name)}>×</button>
            </li>
          ))}
        </ul>
      )}
      {!picking && <ErrorBox error={error} />}
      <PickDialog open={picking} onClose={() => setPicking(false)} testid="covers-pick" title="Add a pitch"
        subtitle="Its replies reach that pitch too. Likely ones come first: someone on this email, the same promoter, the same campaign."
        findLabel="Find a pitch" placeholder="Name" busy={busy} error={error} addLabel="Add pitch" items={items}
        onPick={async (pitchId) => !!(await call("email.link", { threadId: t.threadId, target, pitchIds: [pitchId] }))} />
    </section>
  );
}
