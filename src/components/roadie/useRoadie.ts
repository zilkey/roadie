"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { collection, onSnapshot, orderBy, query, type Timestamp } from "firebase/firestore";
import { clientAuth, clientDb } from "@/lib/firebase-client";
import { useProfile } from "@/lib/auth";
import { useDoc } from "@/lib/firestore-hooks";
import { runCommand } from "@/lib/commands";
import { resolveRoute, routeForPath } from "@/lib/routes";
import type { AssistantAction, AssistantEvent, PageContext } from "@/schema/assistant";

export type Width = "full" | "narrow";
export interface ChatMsg { id: string; role: "user" | "assistant"; text: string; actions: AssistantAction[] }
export interface Pending { text: string; reply: string; actions: AssistantAction[]; doneId?: string; error?: string }

const WIDTH_KEY = "roadie.width";
const readWidth = (): Width => { try { return localStorage.getItem(WIDTH_KEY) === "narrow" ? "narrow" : "full"; } catch { return "full"; } };

/** Where the admin is, as a named route plus the record in view. */
export function pageContextFor(path: string): PageContext {
  const r = routeForPath(path);
  if (!r) return { route: path };
  return { route: r.route, ...(r.params.id ? { recordKind: r.route, recordId: r.params.id } : {}) };
}

/** All of Roadie's client state. Lives in Shell, so it survives navigation. */
export function useRoadie(onNavigated?: () => void) {
  const profile = useProfile();
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
    else if (e.type === "navigate") {
      const r = resolveRoute(e.route, e.params);
      if (!r) return;
      setPending((p) => p && { ...p, actions: [...p.actions, { kind: "navigate", label: e.label, route: e.route, params: e.params }] });
      router.push(r.href);
      onNavigated?.();
    } else if (e.type === "done") {
      setThreadId(e.threadId);
      runCommand("assistant.setPrefs", { threadId: e.threadId }).catch(() => {});
      setPending((p) => p && { ...p, doneId: e.messageId });
    } else setPending((p) => p && { ...p, error: e.message });
  }, [router, onNavigated]);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || (pending && !pending.doneId && !pending.error)) return;
    setPending({ text: message, reply: "", actions: [] });
    try {
      const token = await clientAuth().currentUser?.getIdToken();
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ threadId, message, pageContext: pageContextFor(path) }),
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

  const busy = !!pending && !pending.doneId && !pending.error;
  return { width, setWidth, messages, pending, busy, send, newChat };
}
