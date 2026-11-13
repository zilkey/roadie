"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { collection, onSnapshot, orderBy, query, type Timestamp } from "firebase/firestore";
import { clientAuth, clientDb } from "@/lib/firebase-client";
import { useProfile } from "@/lib/auth";
import { useArtist } from "@/lib/artist";
import { useDoc } from "@/lib/firestore-hooks";
import { artistHeaders, runCommand } from "@/lib/commands";
import { resolveRoute, routeForPath } from "@/lib/routes";
import type { AssistantAction, AssistantEvent, PageContext } from "@/schema/assistant";
import { DEFAULT_PX, fromSaved, type PanelWidth } from "@/lib/roadie-width";

export type Width = PanelWidth;
export interface ChatMsg { id: string; role: "user" | "assistant"; text: string; actions: AssistantAction[]; stopped?: boolean }
/** `replyId` is where the server will save the reply (from its first event); `stopped` once the person tapped Stop. */
export interface Pending { text: string; reply: string; actions: AssistantAction[]; doneId?: string; error?: string; replyId?: string; stopped?: boolean }

const WIDTH_KEY = "roadie.width";
const readWidth = (): Width => { try { return fromSaved(localStorage.getItem(WIDTH_KEY)); } catch { return DEFAULT_PX; } };

/** Where the admin is, as a named route plus the record in view and the tab (`?tab=` or `#tab`, from the browser's address). */
export function pageContextFor(path: string, search = "", hash = ""): PageContext {
  const r = routeForPath(path);
  if (!r) return { route: path };
  const tab = (new URLSearchParams(search).get("tab") ?? hash.replace(/^#/, "")).slice(0, 40);
  return { route: r.route, ...(r.params.id ? { recordKind: r.route, recordId: r.params.id } : {}), ...(/^[\w-]+$/.test(tab) ? { tab } : {}) };
}

/** All of Roadie's client state. Lives in Shell, so it survives navigation. */
export function useRoadie(onNavigated?: () => void) {
  const profile = useProfile();
  const { slug } = useArtist();
  const router = useRouter();
  const path = usePathname();
  const prefs = useDoc<{ prefs?: { assistant?: { width?: "full" | Width; threadId?: string } } }>("users", profile.userId);
  const [width, setWidthState] = useState<Width>(DEFAULT_PX);
  const [threadId, setThreadId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const loaded = useRef(false);

  useEffect(() => { setWidthState(readWidth()); }, []);
  // Take the saved width and conversation once, when the users doc first arrives.
  useEffect(() => {
    if (loaded.current || prefs.loading) return;
    loaded.current = true;
    const a = prefs.doc?.prefs?.assistant;
    if (a?.width !== undefined) setWidthState(fromSaved(a.width));
    if (a?.threadId) setThreadId(a.threadId);
  }, [prefs.loading, prefs.doc]);

  // `save: false` while a drag or a held arrow key is still moving; the last call saves.
  const setWidth = useCallback((w: Width, { save = true }: { save?: boolean } = {}) => {
    setWidthState(w);
    if (!save) return;
    try { localStorage.setItem(WIDTH_KEY, String(w)); } catch { /* private mode */ }
    runCommand("assistant.setPrefs", { width: w }).catch(() => {});
  }, []);

  // Live transcript for the current thread (owner-only read).
  useEffect(() => {
    if (!threadId) { setMessages([]); return; }
    return onSnapshot(
      query(collection(clientDb(), "assistantThreads", threadId, "messages"), orderBy("at")),
      (s) => setMessages(s.docs.map((d) => {
        const x = d.data() as { role: "user" | "assistant"; text: string; actions?: AssistantAction[]; at?: Timestamp; stopped?: boolean };
        return { id: d.id, role: x.role, text: x.text, actions: x.actions ?? [], ...(x.stopped ? { stopped: true } : {}) };
      })),
      () => setMessages([]),
    );
  }, [threadId]);

  // The reply is shown from `pending` until the saved copy arrives (or a few seconds pass). A stopped reply is saved
  // once the server notices the Stop and the tool it was running finishes, so it is kept on screen until then.
  useEffect(() => {
    if (!pending?.doneId) return;
    if (messages.some((m) => m.id === pending.doneId)) { setPending(null); return; }
    const t = setTimeout(() => setPending(null), pending.stopped ? 60000 : 5000);
    return () => clearTimeout(t);
  }, [pending?.doneId, pending?.stopped, messages]);

  type Turn = { reply: string; actions: AssistantAction[]; error?: string; stopped?: boolean };
  const inFlight = useRef<AbortController | null>(null);
  /** Applies one event to the visible `pending` and to `acc`, the finished turn that `send` returns. */
  const apply = useCallback((e: AssistantEvent, acc: Turn) => {
    const add = (a: AssistantAction) => { acc.actions.push(a); setPending((p) => p && { ...p, actions: [...p.actions, a] }); };
    if (e.type === "start") {
      // Where the reply will be saved: switch to its conversation now, so a Stop still shows the saved copy.
      if (e.threadId !== threadId) {
        setThreadId(e.threadId);
        runCommand("assistant.setPrefs", { threadId: e.threadId }).catch(() => {});
      }
      setPending((p) => p && { ...p, replyId: e.messageId });
    } else if (e.type === "text") { acc.reply += e.delta; setPending((p) => p && { ...p, reply: p.reply + e.delta }); }
    else if (e.type === "action") add({ kind: "action", label: e.label });
    else if (e.type === "readback") add({ kind: "readback", label: e.label, runId: e.runId });
    else if (e.type === "confirm") add({ kind: "confirm", label: e.summary, pendingId: e.pendingId, command: e.command, status: "pending", ...(e.fields ? { fields: e.fields } : {}), ...(e.voice ? { voice: true } : {}) });
    else if (e.type === "reply") add({ kind: "reply", label: e.label });
    else if (e.type === "link") add({ kind: "link", label: e.label, route: e.route, params: e.params });
    else if (e.type === "navigate") {
      const r = resolveRoute(e.route, e.params, slug); // always inside the artist you are in
      if (!r) return;
      add({ kind: "navigate", label: e.label, route: e.route, params: e.params });
      // A hash on the page you are already on (/shows#played) fires no router transition: set it so the page's hashchange listener runs.
      const [target, hash] = r.href.split("#");
      if (hash && target === window.location.pathname) window.location.hash = hash;
      else router.push(r.href);
      onNavigated?.();
    } else if (e.type === "done") {
      setThreadId(e.threadId);
      runCommand("assistant.setPrefs", { threadId: e.threadId }).catch(() => {});
      setPending((p) => p && { ...p, doneId: e.messageId });
    } else if (e.type === "error") {
      // Saved anyway: stay in this thread so the retry has the message, and let the saved copy replace this one.
      acc.error = e.message;
      if (e.threadId && e.threadId !== threadId) {
        setThreadId(e.threadId);
        runCommand("assistant.setPrefs", { threadId: e.threadId }).catch(() => {});
      }
      setPending((p) => p && { ...p, error: e.message, ...(e.messageId ? { doneId: e.messageId } : {}) });
    }
  }, [router, onNavigated, slug, threadId]);

  /**
   * Sends a message and streams the reply into `pending`. Resolves to the finished turn, or null when it didn't send (busy or empty).
   * `voice` marks a spoken turn; `fresh` starts a new conversation for it; `pageContext` is the page it is about, when that isn't
   * the one in the address bar yet (a banner that navigates and asks in the same tap).
   */
  const send = useCallback(async (text: string, opts?: { voice?: boolean; fresh?: boolean; pageContext?: PageContext }): Promise<Turn | null> => {
    const message = text.trim();
    if (!message || (pending && !pending.doneId && !pending.error && !pending.stopped)) return null;
    const thread = opts?.fresh ? undefined : threadId;
    if (opts?.fresh) setThreadId(undefined);
    setNotice(null);
    setPending({ text: message, reply: "", actions: [] });
    const acc: Turn = { reply: "", actions: [] };
    const ctl = new AbortController();
    inFlight.current = ctl;
    try {
      const token = await clientAuth().currentUser?.getIdToken();
      if (ctl.signal.aborted) throw ctl.signal.reason;
      const res = await fetch("/api/assistant/chat", {
        method: "POST", signal: ctl.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...artistHeaders() },
        body: JSON.stringify({ threadId: thread, message, pageContext: opts?.pageContext ?? pageContextFor(path, window.location.search, window.location.hash), ...(opts?.voice ? { voice: true } : {}) }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error?.message ?? "Roadie is unavailable");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) if (part.startsWith("data: ")) apply(JSON.parse(part.slice(6)), acc);
      }
    } catch (e) {
      if (ctl.signal.aborted) {
        // Stopped: what came in stays on screen, marked stopped, until the server's saved copy replaces it.
        acc.stopped = true;
        setPending((p) => p && { ...p, stopped: true, ...(p.replyId ? { doneId: p.replyId } : {}) });
      } else {
        acc.error = e instanceof Error ? e.message : "Roadie is unavailable";
        setPending((p) => p && { ...p, error: acc.error });
      }
    } finally {
      if (inFlight.current === ctl) inFlight.current = null;
    }
    return { reply: acc.reply, actions: acc.actions, ...(acc.error ? { error: acc.error } : {}), ...(acc.stopped ? { stopped: true } : {}) };
  }, [pending, threadId, path, apply]);

  /** Stop the reply being written. Whatever Roadie already did stands (and can be undone); nothing more runs. */
  const stop = useCallback(() => { inFlight.current?.abort(); }, []);

  /** Start a fresh conversation (the old one stays in Firestore). */
  const newChat = useCallback(() => {
    inFlight.current?.abort();
    setThreadId(undefined); setPending(null);
    runCommand("assistant.setPrefs", { threadId: null }).catch(() => {});
  }, []);

  /** Yes / Cancel on a confirm card, and Undo on a read-back line. The server does the work from what it stored; the page just shows the result. */
  const [notice, setNotice] = useState<string | null>(null);
  const post = useCallback(async (path: "confirm" | "undo", body: Record<string, unknown>): Promise<{ status?: string; label?: string; message?: string } | null> => {
    setNotice(null);
    try {
      const token = await clientAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/assistant/${path}`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...artistHeaders() }, body: JSON.stringify({ threadId, ...body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice(json.error?.message ?? "Roadie is unavailable"); return null; }
      if (json.status === "failed") setNotice(json.message ?? "That didn't work");
      return json;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Roadie is unavailable");
      return null;
    }
  }, [threadId]);
  const answer = useCallback(async (pendingId: string, decision: "yes" | "cancel", picks?: Record<string, string>, by?: "voice"): Promise<{ status: "done" | "canceled" | "failed"; label?: string; message?: string } | null> =>
    (await post("confirm", { pendingId, decision, ...(picks ? { picks } : {}), ...(by ? { by } : {}) })) as { status: "done" | "canceled" | "failed"; label?: string; message?: string } | null, [post]);
  const undo = useCallback((runId: string) => post("undo", { runId }), [post]);

  const busy = !!pending && !pending.doneId && !pending.error && !pending.stopped;
  /** A "link" action's button: opens its page inside the artist, only when tapped. */
  const open = useCallback((a: AssistantAction) => {
    const r = resolveRoute(a.route, a.params, slug);
    if (!r) return;
    router.push(r.href);
    onNavigated?.();
  }, [router, onNavigated, slug]);

  return { width, setWidth, messages, pending, busy, send, stop, newChat, answer, undo, open, notice };
}
