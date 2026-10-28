"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { Menu } from "@/components/Menu";
import { BackLink, hrefFor, useBooking, useNotFound } from "@/components/booking/common";
import { RichTextEditor } from "@/components/email/RichTextEditor";
import { SignatureBlock, useSignature } from "@/components/email/SignatureBlock";
import { useProfile } from "@/lib/auth";
import { useDoc, type Row } from "@/lib/firestore-hooks";
import { BAND_TIME_ZONE } from "@/lib/timezone";
import { linkify } from "@/lib/linkify";
import { htmlToText } from "@/lib/email-html";
import { initialsOf, paragraphsOf, previewOf, replyRecipients, splitQuoted } from "@/lib/email-text";
import { pitchCellText } from "@/lib/booking";
import { hasNewReply, type EmailThread } from "@/schema";

type Message = { id: string; threadId: string; direction: "sent" | "received"; from: string; fromName: string; to: string[]; cc: string[]; subject: string; body: string; date: string };

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: BAND_TIME_ZONE });
const longDate = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: BAND_TIME_ZONE });
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
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [fresh, setFresh] = useState<boolean | null>(null); // "New" is decided before opening the thread marks it seen
  const loaded = useRef(false);

  const load = useCallback(async () => {
    const r = await call<{ messages: Message[] }>("email.thread", { id });
    if (r) setMessages([...r.messages].sort((x, y) => x.date.localeCompare(y.date)));
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
  const placeHref = hrefFor(t.target.kind, t.target.id);
  const backHref = t.pitchId ? `/booking/pitches/${t.pitchId}` : placeHref;
  const placeWord = t.target.kind === "festival" ? "Festival" : t.target.kind === "promoter" ? "Promoter" : "Venue";
  const cell = pitch ? pitchCellText(pitch, artist?.configurations ?? []) : null;
  const names = t.participants.map((a) => nameOf(a));

  return (
    <div className="show-page" data-testid="thread-page">
      <PageTitle back={<BackLink href={backHref} label={`${t.pitchId ? "Pitch" : placeWord} · ${t.target.name}`} />} title={t.subject || "(no subject)"}
        sub={<>
          {t.messageCount} message{t.messageCount === 1 ? "" : "s"}{names.length > 0 && <> · {names.join(", ")}</>}
          {pitch && cell && <Link href={`/booking/pitches/${pitch.id}`} className="s block font-semibold underline" data-testid="thread-pitch">Pitch: {cell.config}, {cell.dates}</Link>}
        </>}
        actions={<div className="flex items-center gap-2">
          <a className="btn" href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(t.threadId)}`} target="_blank" rel="noopener noreferrer" data-testid="open-in-gmail">Open in Gmail ↗</a>
          <Menu label="More actions" testid="thread" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>} items={[{ key: "unlink", label: `Unlink from ${t.target.name}`, danger: true,
            onSelect: async () => { if (confirm(`Take this thread off ${t.target.name}? The pitch's activity keeps its entries.`) && (await call("email.unlink", { id }))) router.replace(backHref); } }]} />
        </div>} />
      <p className="s" data-testid="thread-private">Only {artist?.name ?? "your band"} sees this · sent and received from {t.account}</p>
      <ErrorBox error={error} />
      {messages !== null && (
        <div className="grid gap-3" data-testid="thread-messages">
          {messages.map((m, n) => <MessageView key={m.id} m={m} n={n} last={n === messages.length - 1} isNew={n === messages.length - 1 && m.direction === "received" && fresh === true} account={t.account} nameOf={nameOf} />)}
        </div>
      )}
      {messages !== null && <ReplyCard t={t} messages={messages} nameOf={nameOf} busy={busy} onSent={load} />}
    </div>
  );
}

function MessageView({ m, n, last, isNew, account, nameOf }: { m: Message; n: number; last: boolean; isNew: boolean; account: string; nameOf(a: string, fromName?: string): string }) {
  const [open, setOpen] = useState(last);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const sent = m.direction === "sent";
  const who = nameOf(m.from, m.fromName);
  const { text, quoted } = splitQuoted(m.body);
  const toText = m.to.map((a) => (a.toLowerCase() === account.toLowerCase() ? "me" : nameOf(a))).join(", ");
  return (
    <article className={`msg${sent ? " me" : ""}`} data-testid={`msg-${n}`} data-direction={m.direction}>
      <button type="button" className="msg-head" aria-expanded={open} onClick={() => setOpen(!open)} data-testid={`msg-toggle-${n}`}>
        <span className={`avatar${sent ? "" : " grey"}`} aria-hidden>{initialsOf(who)}</span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex flex-wrap items-center gap-2"><b>{who}</b>{isNew && <span className="chip a" data-testid="msg-new">New</span>}</span>
          {open
            ? <span className="s truncate">{who} &lt;{m.from}&gt; · to {toText}{m.cc.length > 0 && <> · cc {m.cc.map((a) => nameOf(a)).join(", ")}</>}</span>
            : <span className="s truncate" data-testid={`msg-preview-${n}`}>{previewOf(m.body)}</span>}
        </span>
        <span className="s shrink-0">{open ? longDate(m.date) : shortDate(m.date)}</span>
      </button>
      {open && (
        <div className="msg-body" data-testid={`msg-body-${n}`}>
          {paragraphsOf(text).map((p, i) => (
            <p key={i}>{linkify(p).map((s, j) => (s.href ? <a key={j} href={s.href} target="_blank" rel="noopener noreferrer">{s.text}</a> : s.text))}</p>
          ))}
          {quoted && (
            <>
              <button type="button" className="quote-toggle" aria-label="Show quoted text" aria-expanded={quoteOpen} onClick={() => setQuoteOpen(!quoteOpen)} data-testid={`quote-toggle-${n}`}>···</button>
              {quoteOpen && <blockquote className="msg-quote mt-2" data-testid={`quote-${n}`}>{quoted}</blockquote>}
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
  const [editorKey, setEditorKey] = useState(0);
  const sig = useSignature();
  const { call, error, busy: working } = useCommand();
  const recipients = to ?? defaultTo;
  const subject = /^re:/i.test(t.subject) ? t.subject : `Re: ${t.subject}`;

  const outgoing = html + (sig.signatureHtml ? `<br>${sig.signatureHtml}` : "");
  const body = htmlToText(outgoing).trim();
  const canSend = !busy && !working && recipients.length > 0 && htmlToText(html).trim().length > 0;

  function add(list: string[], set: (v: string[]) => void, raw: string, clear: () => void) {
    const parts = raw.split(/[,\s;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return;
    const ok = parts.filter((p) => EMAIL_RE.test(p));
    if (ok.length) set([...new Set([...list, ...ok])]);
    if (ok.length === parts.length) clear();
  }
  const input = (list: string[], set: (v: string[]) => void, value: string, setValue: (v: string) => void, testid: string) => (
    <input className="to-input" placeholder="Add someone…" aria-label="Add someone" value={value} data-testid={testid}
      onChange={(e) => { const v = e.target.value; if (v.endsWith(",")) add(list, set, v, () => setValue("")); else setValue(v); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(list, set, value, () => setValue("")); } }}
      onBlur={() => add(list, set, value, () => setValue(""))} />
  );
  const chip = (a: string, remove: () => void, testid: string) => (
    <span key={a} className="chip w lg" data-testid={testid}>{nameOf(a)}<button type="button" aria-label={`Remove ${a}`} onClick={remove}>×</button></span>
  );

  const payload = () => ({
    target: { kind: t.target.kind, id: t.target.id }, threadId: t.threadId, ...(t.pitchId ? { pitchId: t.pitchId } : {}),
    to: recipients, ...(cc.length ? { cc } : {}), subject, body, html: outgoing,
  });
  function discard() { setHtml(""); setEditorKey((k) => k + 1); setTo(null); setCc([]); setShowCc(false); setNote(null); }
  async function send() {
    setNote(null);
    if (await call("email.send", payload())) { discard(); setNote("Sent"); await onSent(); }
  }
  async function draft() {
    setNote(null);
    if (await call("email.draft", payload())) setNote("Draft saved in Gmail");
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
        {input(recipients, setTo, typed, setTyped, "reply-to-input")}
        {!showCc && <button type="button" className="btn sm ghost" onClick={() => setShowCc(true)} data-testid="reply-cc-toggle">Cc</button>}
      </div>
      {showCc && (
        <div className="to-row" data-testid="reply-cc">
          <span className="lbl">Cc</span>
          {cc.map((a) => chip(a, () => setCc(cc.filter((x) => x !== a)), `reply-cc-${a}`))}
          {input(cc, setCc, typedCc, setTypedCc, "reply-cc-input")}
        </div>
      )}
      <RichTextEditor key={editorKey} value={html} onChange={setHtml} placeholder="Write a reply…" testid="reply-body" />
      <SignatureBlock signature={sig} />
      <ErrorBox error={error} />
      {note && <span className="chip g self-start" data-testid="reply-note">{note}</span>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" className="btn ghost" onClick={discard} disabled={working} data-testid="reply-discard">Discard</button>
        <button type="button" className="btn" onClick={draft} disabled={!canSend} data-testid="reply-draft">Save draft in Gmail</button>
        <button type="button" className="btn acc" onClick={send} disabled={!canSend} data-testid="reply-send">Send</button>
      </div>
    </section>
  );
}
