"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRoadie, type ChatMsg, type Pending } from "./useRoadie";
import { useVamp } from "./vamp";
import type { AssistantAction } from "@/schema/assistant";

const useDesktop = () =>
  useSyncExternalStore(
    (cb) => { const m = window.matchMedia("(min-width: 768px)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia("(min-width: 768px)").matches,
    () => true,
  );

const actionText = (a: AssistantAction) => (a.kind === "navigate" ? `→ Opened ${a.label}` : a.label);

interface Handlers { answer(pendingId: string, d: "yes" | "cancel"): void; undo(runId: string): void }

const CONFIRM_DONE = { done: "Done", canceled: "Canceled", expired: "Expired. Ask me again.", failed: "Didn't work" } as const;

function Actions({ actions, on }: { actions: AssistantAction[]; on: Handlers }) {
  return (
    <>
      {actions.map((a, i) => {
        if (a.kind === "readback") {
          return (
            <div key={i} className="s flex flex-wrap items-center gap-2" data-testid="roadie-readback">
              <span>✓ {a.label}</span>
              {a.undone ? <span data-testid="roadie-undone">Undone</span> : a.runId && <button className="btn ghost sm" data-testid="roadie-undo" onClick={() => on.undo(a.runId!)}>Undo</button>}
            </div>
          );
        }
        if (a.kind === "confirm") {
          const open = (a.status ?? "pending") === "pending";
          return (
            <div key={i} className="grid gap-2 rounded-xl border border-line bg-panel p-2 text-sm" data-testid="roadie-confirm" data-status={a.status ?? "pending"}>
              <span>{a.label}?</span>
              {open ? (
                <span className="flex gap-1">
                  <button className="btn acc sm" data-testid="roadie-confirm-yes" onClick={() => a.pendingId && on.answer(a.pendingId, "yes")}>Yes</button>
                  {/* TODO: Edit (open the draft in the page) */}
                  <button className="btn ghost sm" data-testid="roadie-confirm-cancel" onClick={() => a.pendingId && on.answer(a.pendingId, "cancel")}>Cancel</button>
                </span>
              ) : <span className="s" data-testid="roadie-confirm-result">{CONFIRM_DONE[a.status as keyof typeof CONFIRM_DONE]}</span>}
            </div>
          );
        }
        return <div key={i} className="s" data-testid="roadie-action">{actionText(a)}</div>;
      })}
    </>
  );
}

function Bubble({ role, text, actions = [], on }: { role: "user" | "assistant"; text: string; actions?: AssistantAction[]; on: Handlers }) {
  return (
    <div className={`grid gap-1 ${role === "user" ? "justify-items-end" : ""}`}>
      {role === "assistant" && <Actions actions={actions} on={on} />}
      {text && (
        <div data-testid={`roadie-msg-${role}`} className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${role === "user" ? "bg-accent-soft" : "bg-soft"}`}>{text}</div>
      )}
    </div>
  );
}

function Chat({ messages, pending, busy, send, on, notice }: { messages: ChatMsg[]; pending: Pending | null; busy: boolean; send(t: string): void; on: Handlers; notice: string | null }) {
  const [text, setText] = useState("");
  // Once the saved copy of the exchange arrives, `pending` stands in for it for one more render: hide the pair so it isn't doubled.
  const at = pending?.doneId ? messages.findIndex((m) => m.id === pending.doneId) : -1;
  const shown = at >= 0 ? messages.slice(0, Math.max(0, at - 1)) : messages;
  const end = useRef<HTMLDivElement>(null);
  const vamp = useVamp(busy && !pending?.reply && !pending?.actions.length);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages, pending]);
  const submit = () => { if (!text.trim() || busy) return; send(text); setText(""); };
  return (
    <>
      <div className="flex-1 overflow-y-auto" data-testid="roadie-messages">
        <div className="grid content-start gap-3 p-3">
          {!messages.length && !pending && <div className="s">Hey. I'm Roadie. Ask me about shows, tours or money.</div>}
          {shown.map((m) => <Bubble key={m.id} {...m} on={on} />)}
          {pending && (
            <>
              <Bubble role="user" text={pending.text} on={on} />
              <Bubble role="assistant" text={pending.reply} actions={pending.actions} on={on} />
              {busy && !pending.reply && !pending.actions.length && <div className="s italic" data-testid="roadie-vamp">{vamp}</div>}
              {pending.error && <div className="text-sm text-warn" data-testid="roadie-error">{pending.error}</div>}
            </>
          )}
          {notice && <div className="text-sm text-warn" data-testid="roadie-notice">{notice}</div>}
          <div ref={end} />
        </div>
      </div>
      <div className="border-t border-line p-3">
        <input className="input" data-testid="roadie-input" placeholder="Ask or tell me anything…" value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
      </div>
    </>
  );
}

/** The assistant. Mount once, in Shell, for admins only: a left column on desktop, a pill + bottom sheet on a phone. */
export function Roadie() {
  const desktop = useDesktop();
  const [open, setOpen] = useState(false);
  const r = useRoadie(() => setOpen(false)); // after Roadie navigates, the phone sheet drops back to the pill
  const chat = <Chat messages={r.messages} pending={r.pending} busy={r.busy} send={r.send} on={{ answer: r.answer, undo: r.undo }} notice={r.notice} />;

  if (desktop) {
    if (r.width === "narrow") {
      return (
        <aside className="sticky top-0 flex h-dvh w-12 shrink-0 flex-col items-center gap-2 border-r border-line bg-panel py-3" data-testid="roadie-panel" data-width="narrow">
          <button className="btn acc sm" data-testid="roadie-expand" aria-label="Expand Roadie" title="Expand Roadie" onClick={() => r.setWidth("full")}>R</button>
          <span className="s">⇥</span>
        </aside>
      );
    }
    return (
      <aside className="sticky top-0 flex h-dvh w-[300px] shrink-0 flex-col border-r border-line bg-panel" data-testid="roadie-panel" data-width="full">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="font-display text-lg font-extrabold">Roadie</span>
          <span className="flex gap-1">
            <button className="btn ghost sm" data-testid="roadie-new" onClick={r.newChat}>New</button>
            <button className="btn ghost sm" data-testid="roadie-narrow" onClick={() => r.setWidth("narrow")}>⇤ Narrow</button>
          </span>
        </div>
        {chat}
      </aside>
    );
  }

  if (!open) {
    return (
      <button className="btn acc fixed right-3 z-10 shadow-lg" style={{ bottom: "calc(4.25rem + env(safe-area-inset-bottom))" }}
        data-testid="roadie-pill" onClick={() => setOpen(true)}>Roadie</button>
    );
  }
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex h-[75dvh] flex-col rounded-t-2xl border border-line bg-panel shadow-2xl" data-testid="roadie-sheet">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="font-display text-lg font-extrabold">Roadie</span>
        <span className="flex gap-1">
          <button className="btn ghost sm" data-testid="roadie-new" onClick={r.newChat}>New</button>
          <button className="btn ghost sm" data-testid="roadie-close" onClick={() => setOpen(false)}>Close</button>
        </span>
      </div>
      {chat}
    </div>
  );
}
