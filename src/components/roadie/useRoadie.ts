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

export type Width = "full" | "narrow";
export interface ChatMsg { id: string; role: "user" | "assistant"; text: string; actions: AssistantAction[] }
export interface Pending { text: string; reply: string; actions: AssistantAction[]; doneId?: string; error?: string }

const WIDTH_KEY = "roadie.width";
const readWidth = (): Width => { try { return localStorage.getItem(WIDTH_KEY) === "narrow" ? "narrow" : "full"; } catch { return "full"; } };

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
  const prefs = useDoc<{ prefs?: { assistant?: { width?: Width; threadId?: string } } }>("users", profile.userId);
  const [width, setWidthState] = useState<Width>("full");
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
    if (a?.width) setWidthState(a.width);
    if (a?.threadId) setThreadId(a.threadId);
  }, [prefs.loading, prefs.doc]);

  const setWidth = useCallback((w: Width) => {
    setWidthState(w);
    try { localStorage.setItem(WIDTH_KEY, w); } catch { /* private mode */ }
    runCommand("assistant.setPrefs", { width: w }).catch(() => {});
  }, []);

  // Live transcript for the current thread (owner-only read).
  useEffect(() => {
    if (!threadId) { setMessages([]); return; }
    return onSnapshot(
      query(collection(clientDb(), "assistantThreads", threadId, "messages"), orderBy("at")),
      (s) => setMessages(s.docs.map((d) => {
        const x = d.data() as { role: "user" | "assistant"; text: string; actions?: AssistantAction[]; at?: Timestamp };
        return { id: d.id, role: x.role, text: x.text, actions: x.actions ?? [] };
      })),
      () => setMessages([]),
    );
  }, [threadId]);

  // The reply is shown from `pending` until the saved copy arrives (or a few seconds pass).
  useEffect(() => {
    if (!pending?.doneId) return;
    if (messages.some((m) => m.id === pending.doneId)) { setPending(null); return; }
    const t = setTimeout(() => setPending(null), 5000);
    return () => clearTimeout(t);
  }, [pending?.doneId, messages]);

  const apply = useCallback((e: AssistantEvent) => {
    if (e.type === "text") setPending((p) => p && { ...p, reply: p.reply + e.delta });
    else if (e.type === "action") setPending((p) => p && { ...p, actions: [...p.actions, { kind: "action", label: e.label }] });
    else if (e.type === "readback") setPending((p) => p && { ...p, actions: [...p.actions, { kind: "readback", label: e.label, runId: e.runId }] });
    else if (e.type === "confirm") setPending((p) => p && { ...p, actions: [...p.actions, { kind: "confirm", label: e.summary, pendingId: e.pendingId, command: e.command, status: "pending", ...(e.fields ? { fields: e.fields } : {}) }] });
    else if (e.type === "reply") setPending((p) => p && { ...p, actions: [...p.actions, { kind: "reply", label: e.label }] });
    else if (e.type === "link") setPending((p) => p && { ...p, actions: [...p.actions, { kind: "link", label: e.label, route: e.route, params: e.params }] });
    else if (e.type === "navigate") {
      const r = resolveRoute(e.route, e.params, slug); // always inside the artist you are in
      if (!r) return;
      setPending((p) => p && { ...p, actions: [...p.actions, { kind: "navigate", label: e.label, route: e.route, params: e.params }] });
      // A hash on the page you are already on (/shows#played) fires no router transition: set it so the page's hashchange listener runs.
      const [target, hash] = r.href.split("#");
      if (hash && target === window.location.pathname) window.location.hash = hash;
      else router.push(r.href);
      onNavigated?.();
    } else if (e.type === "done") {
      setThreadId(e.threadId);
      runCommand("assistant.setPrefs", { threadId: e.threadId }).catch(() => {});
      setPending((p) => p && { ...p, doneId: e.messageId });
    } else if (e.type === "error") setPending((p) => p && { ...p, error: e.message });
  }, [router, onNavigated, slug]);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || (pending && !pending.doneId && !pending.error)) return;
    setNotice(null);
    setPending({ text: message, reply: "", actions: [] });
    try {
      const token = await clientAuth().currentUser?.getIdToken();
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...artistHeaders() },
        body: JSON.stringify({ threadId, message, pageContext: pageContextFor(path, window.location.search, window.location.hash) }),
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
        for (const part of parts) if (part.startsWith("data: ")) apply(JSON.parse(part.slice(6)));
      }
    } catch (e) {
      setPending((p) => p && { ...p, error: e instanceof Error ? e.message : "Roadie is unavailable" });
    }
  }, [pending, threadId, path, apply]);

  /** Start a fresh conversation (the old one stays in Firestore). */
  const newChat = useCallback(() => {
    setThreadId(undefined); setPending(null);
    runCommand("assistant.setPrefs", { threadId: null }).catch(() => {});
  }, []);

  /** Yes / Cancel on a confirm card, and Undo on a read-back line. The server does the work from what it stored; the page just shows the result. */
  const [notice, setNotice] = useState<string | null>(null);
  const post = useCallback(async (path: "confirm" | "undo", body: Record<string, unknown>) => {
    setNotice(null);
    try {
      const token = await clientAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/assistant/${path}`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...artistHeaders() }, body: JSON.stringify({ threadId, ...body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setNotice(json.error?.message ?? "Roadie is unavailable");
      else if (json.status === "failed") setNotice(json.message ?? "That didn't work");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Roadie is unavailable");
    }
  }, [threadId]);
  const answer = useCallback((pendingId: string, decision: "yes" | "cancel", picks?: Record<string, string>) => post("confirm", { pendingId, decision, ...(picks ? { picks } : {}) }), [post]);
  const undo = useCallback((runId: string) => post("undo", { runId }), [post]);

  const busy = !!pending && !pending.doneId && !pending.error;
  /** A "link" action's button: opens its page inside the artist, only when tapped. */
  const open = useCallback((a: AssistantAction) => {
    const r = resolveRoute(a.route, a.params, slug);
    if (!r) return;
    router.push(r.href);
    onNavigated?.();
  }, [router, onNavigated, slug]);

  return { width, setWidth, messages, pending, busy, send, newChat, answer, undo, open, notice };
}
