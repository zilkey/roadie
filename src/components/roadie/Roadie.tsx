"use client";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRoadie, type ChatMsg, type Pending } from "./useRoadie";
import { useVamp } from "./vamp";
import type { AssistantAction } from "@/schema/assistant";
import { linkify } from "@/lib/linkify";

const useDesktop = () =>
  useSyncExternalStore(
    (cb) => { const m = window.matchMedia("(min-width: 900px)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia("(min-width: 900px)").matches,
    () => true,
  );

/** The visible part of the page above the on-screen keyboard (iOS keeps the layout viewport full height), so the sheet sits on the keyboard instead of under it. */
function useKeyboardInset() {
  const [v, setV] = useState({ height: 0, bottom: 0 });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => setV({ height: vv.height, bottom: Math.max(0, window.innerHeight - vv.height - vv.offsetTop) });
    sync();
    vv.addEventListener("resize", sync); vv.addEventListener("scroll", sync);
    return () => { vv.removeEventListener("resize", sync); vv.removeEventListener("scroll", sync); };
  }, []);
  return v;
}

/** True while a text field anywhere on the page has focus (the keyboard is up on a phone). */
function useFieldFocused() {
  const [f, setF] = useState(false);
  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.matches("textarea, select") || (t instanceof HTMLInputElement && !/^(checkbox|radio|button|submit|range|file)$/.test(t.type)));
    const on = (e: FocusEvent) => setF(isField(e.target));
    const off = () => setF(false);
    document.addEventListener("focusin", on); document.addEventListener("focusout", off);
    return () => { document.removeEventListener("focusin", on); document.removeEventListener("focusout", off); };
  }, []);
  return f;
}

const actionText = (a: AssistantAction) => (a.kind === "navigate" ? `→ Opened ${a.label}` : a.label);

interface Handlers { answer(pendingId: string, d: "yes" | "cancel", picks?: Record<string, string>): void; undo(runId: string): void; open(a: AssistantAction): void; reply(text: string): void }

const CONFIRM_DONE = { done: "Done", canceled: "Canceled", expired: "Expired. Ask me again.", failed: "Didn't work" } as const;

function Actions({ actions, on }: { actions: AssistantAction[]; on: Handlers }) {
  return (
    <>
      {actions.map((a, i) => {
        if (a.kind === "reply") return null; // drawn under the question (Replies)
        if (a.kind === "readback") {
          return (
            <div key={i} className="s flex flex-wrap items-center gap-2" data-testid="roadie-readback">
              <span>✓ {a.label}</span>
              {a.undone ? <span data-testid="roadie-undone">Undone</span> : a.runId && <button className="btn ghost sm" data-testid="roadie-undo" onClick={() => on.undo(a.runId!)}>Undo</button>}
            </div>
          );
        }
        if (a.kind === "link") {
          return <button key={i} className="btn acc sm justify-self-start" data-testid="roadie-link-button" onClick={() => on.open(a)}>{a.label}</button>;
        }
        if (a.kind === "confirm") return <Confirm key={a.pendingId ?? i} a={a} on={on} />;
        return <div key={i} className="s" data-testid="roadie-action">{actionText(a)}</div>;
      })}
    </>
  );
}

/** A Yes / Cancel card: the headline, then one row per field it will write. A field whose value wasn't on its list is a dropdown, and Yes waits for it. */
function Confirm({ a, on }: { a: AssistantAction; on: Handlers }) {
  const open = (a.status ?? "pending") === "pending";
  const [picks, setPicks] = useState<Record<string, string>>({});
  const fields = a.fields ?? [];
  const missing = fields.some((f) => f.options && f.path && !picks[f.path]);
  return (
    <div className="grid min-w-0 gap-2 rounded-xl border border-[var(--roadie-control-border)] bg-[var(--surface)] p-2 text-sm shadow-[var(--shadow)]" data-testid="roadie-confirm" data-status={a.status ?? "pending"}>
      <span className="font-semibold [overflow-wrap:anywhere]">{a.label}{fields.length ? "" : "?"}</span>
      {fields.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1" data-testid="roadie-confirm-fields">
          {fields.map((f, j) => (
            <Fragment key={j}>
              <dt className="s whitespace-nowrap">{f.label}</dt>
              {f.options && f.path ? (
                <dd className="grid gap-0.5">
                  <select className="select py-1.5" data-testid="roadie-confirm-pick" aria-label={f.label} disabled={!open} value={picks[f.path] ?? ""}
                    onChange={(e) => setPicks((p) => ({ ...p, [f.path!]: e.target.value }))}>
                    <option value="" disabled>Pick one…</option>
                    {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {f.value && <span className="s">&ldquo;{f.value}&rdquo; isn&rsquo;t on the list</span>}
                </dd>
              ) : <dd className="[overflow-wrap:anywhere]" data-testid="roadie-confirm-value">{linkify(f.value).map((x, k) => x.href ? <a key={k} href={x.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{x.text}</a> : <span key={k}>{x.text}</span>)}</dd>}
            </Fragment>
          ))}
        </dl>
      )}
      {open ? (
        <span className="flex gap-1">
          <button className="btn acc sm" data-testid="roadie-confirm-yes" disabled={missing} onClick={() => a.pendingId && on.answer(a.pendingId, "yes", Object.keys(picks).length ? picks : undefined)}>Yes</button>
          {/* Edit: not built today; not added here. */}
          <button className="btn ghost sm" data-testid="roadie-confirm-cancel" onClick={() => a.pendingId && on.answer(a.pendingId, "cancel")}>Cancel</button>
        </span>
      ) : <span className="s" data-testid="roadie-confirm-result">{CONFIRM_DONE[a.status as keyof typeof CONFIRM_DONE]}</span>}
    </div>
  );
}

/** Answers to Roadie's question (ui.ask). Only the latest reply's can be tapped; tapping sends the answer as your message. */
function Replies({ actions, live, on }: { actions: AssistantAction[]; live: boolean; on: Handlers }) {
  const replies = actions.filter((a) => a.kind === "reply");
  if (!replies.length || !live) return null;
  return (
    <div className="flex flex-wrap gap-1" data-testid="roadie-replies">
      {replies.map((a, i) => <button key={i} className="btn ghost sm" data-testid="roadie-reply" onClick={() => on.reply(a.label)}>{a.label}</button>)}
    </div>
  );
}

function Bubble({ role, text, actions = [], on, live = false }: { role: "user" | "assistant"; text: string; actions?: AssistantAction[]; on: Handlers; live?: boolean }) {
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)] gap-1 ${role === "user" ? "justify-items-end" : ""}`}>
      {role === "assistant" && <Actions actions={actions} on={on} />}
      {text && (
        <div data-testid={`roadie-msg-${role}`} className={`max-w-[92%] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-2xl px-3 py-2 text-sm ${role === "user" ? "bg-[var(--accent)] text-[var(--on-accent)]" : "bg-[var(--roadie-bubble)] text-[var(--ink)]"}`}>
          {linkify(text).map((s, i) => s.href
            ? <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" title={s.href} className="break-all underline underline-offset-2" data-testid="roadie-link">{s.text}</a>
            : <span key={i}>{s.text}</span>)}
        </div>
      )}
      {role === "assistant" && <Replies actions={actions} live={live} on={on} />}
    </div>
  );
}

function Chat({ messages, pending, busy, send, on, notice, autoFocus = false }: { messages: ChatMsg[]; pending: Pending | null; busy: boolean; send(t: string): void; on: Handlers; notice: string | null; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  // Once the saved copy of the exchange arrives, `pending` stands in for it for one more render: hide the pair so it isn't doubled.
  const at = pending?.doneId ? messages.findIndex((m) => m.id === pending.doneId) : -1;
  const shown = at >= 0 ? messages.slice(0, Math.max(0, at - 1)) : messages;
  const end = useRef<HTMLDivElement>(null);
  const vamp = useVamp(busy && !pending?.reply && !pending?.actions.length);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages, pending]);
  // Grow with the text up to about five lines, then scroll.
  useEffect(() => { const el = field.current; if (!el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 120)}px`; }, [text]);
  const submit = () => { if (!text.trim() || busy) return; send(text); setText(""); };
  return (
    <>
      <div className="min-w-0 flex-1 overflow-y-auto" data-testid="roadie-messages">
        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-3 p-3">
          {!messages.length && !pending && <div className="s">Hey. I'm Roadie. Ask me about shows, tours or money.</div>}
          {shown.map((m, i) => <Bubble key={m.id} {...m} on={on} live={!pending && !busy && i === shown.length - 1} />)}
          {pending && (
            <>
              <Bubble role="user" text={pending.text} on={on} />
              <Bubble role="assistant" text={pending.reply} actions={pending.actions} on={on} live={!busy} />
              {busy && !pending.reply && !pending.actions.length && <div className="s italic" data-testid="roadie-vamp">{vamp}</div>}
              {pending.error && <div className="text-sm text-warn" data-testid="roadie-error">{pending.error}</div>}
            </>
          )}
          {notice && <div className="text-sm text-warn" data-testid="roadie-notice">{notice}</div>}
          <div ref={end} />
        </div>
      </div>
      <div className="p-3 pt-0">
        <div className="flex items-end gap-2 rounded-2xl border border-[var(--roadie-control-border)] bg-[var(--roadie-bubble)] py-1.5 pl-3 pr-1.5">
          <textarea ref={field} rows={1} autoFocus={autoFocus} enterKeyHint="send" autoComplete="off" autoCorrect="on" className="roadie-input block max-h-[120px] min-w-0 flex-1 resize-none self-center bg-transparent text-[var(--ink)] outline-none placeholder:text-[var(--muted)]" data-testid="roadie-input" placeholder="Ask or tell me anything…" value={text}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
          <button type="button" aria-label="Send" data-testid="roadie-send" disabled={busy || !text.trim()} onClick={submit}
            className="grid size-8 shrink-0 place-items-center rounded-xl bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </div>
      </div>
    </>
  );
}

const Badge = ({ size = 38 }: { size?: number }) => (
  <span className="grid shrink-0 place-items-center rounded-[10px] bg-[var(--accent)] font-display font-extrabold text-[var(--on-accent)]" style={{ width: size, height: size }} aria-hidden>R</span>
);
const Chevron = ({ dir }: { dir: "left" | "right" }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} /></svg>
);
const iconBtn = "grid size-11 shrink-0 place-items-center rounded-lg text-[var(--ink)] hover:bg-[var(--roadie-chip)]";
const ghost = "rounded-lg border border-[var(--roadie-control-border)] bg-[var(--roadie-bubble)] px-2.5 py-1.5 text-sm text-[var(--ink)] hover:border-[var(--muted)]";

/** The assistant. Mount once, in Shell, for admins only: a left column on desktop, a pill + bottom sheet on a phone. */
export function Roadie() {
  const desktop = useDesktop();
  const [open, setOpen] = useState(false);
  const r = useRoadie(() => setOpen(false)); // after Roadie navigates, the phone sheet drops back to the pill
  const kb = useKeyboardInset();
  const fieldFocused = useFieldFocused();
  const chat = <Chat messages={r.messages} pending={r.pending} busy={r.busy} send={r.send} on={{ answer: r.answer, undo: r.undo, open: r.open, reply: r.send }} notice={r.notice} autoFocus={!desktop} />;

  if (desktop) {
    if (r.width === "narrow") {
      return (
        <aside className="sticky top-0 flex h-dvh w-[72px] shrink-0 flex-col items-center gap-2 border-r border-[var(--roadie-border)] bg-[var(--roadie-bg)] py-4" data-testid="roadie-panel" data-width="narrow">
          <button data-testid="roadie-expand" aria-label="Expand Roadie" title="Expand Roadie" onClick={() => r.setWidth("full")}><Badge /></button>
        </aside>
      );
    }
    return (
      <aside className="sticky top-0 flex h-dvh w-[360px] shrink-0 flex-col border-r border-[var(--roadie-border)] bg-[var(--roadie-bg)]" data-testid="roadie-panel" data-width="full">
        <div className="flex items-center gap-2.5 px-3 py-3">
          <Badge />
          <span className="font-display text-lg font-extrabold">Roadie</span>
          <span className="ml-auto flex gap-1.5">
            <button className={ghost} data-testid="roadie-new" onClick={r.newChat}>New chat</button>
            <button className={ghost} data-testid="roadie-narrow" aria-label="Narrow Roadie" title="Narrow Roadie" onClick={() => r.setWidth("narrow")}><Chevron dir="left" /></button>
          </span>
        </div>
        {chat}
      </aside>
    );
  }

  if (!open) {
    if (fieldFocused) return null; // the keyboard is up for some other field: the pill would float over it
    return (
      <button className="fixed inset-x-3 z-10 flex min-w-0 items-center gap-2.5 rounded-full bg-[var(--strong)] p-1.5 pr-4 text-left text-[var(--on-strong)] shadow-[var(--shadow)]"
        style={{ bottom: "calc(var(--tabbar-h, 64px) + env(safe-area-inset-bottom) + 8px)" }}
        data-testid="roadie-pill" aria-label="Open Roadie" onClick={() => setOpen(true)}>
        <Badge size={32} />
        <span className="text-sm opacity-80">Ask or tell Roadie…</span>
      </button>
    );
  }
  return (
    <div className="fixed inset-x-0 z-30 flex w-full max-w-full flex-col overflow-hidden rounded-t-2xl border border-[var(--roadie-border)] bg-[var(--roadie-bg)] shadow-2xl" data-testid="roadie-sheet"
      style={{ bottom: kb.bottom, height: kb.height ? `min(75dvh, ${kb.height}px)` : "75dvh" }}>
      <div className="flex items-center gap-2.5 px-3 py-3">
        <Badge />
        <span className="font-display text-lg font-extrabold">Roadie</span>
        <span className="ml-auto flex gap-1.5">
          <button className={iconBtn} data-testid="roadie-new" aria-label="New chat" title="New chat" onClick={r.newChat}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <button className={iconBtn} data-testid="roadie-close" aria-label="Close Roadie" title="Close Roadie" onClick={() => setOpen(false)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </span>
      </div>
      {chat}
    </div>
  );
}
