"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, onSnapshot } from "firebase/firestore";
import { clientDb } from "./firebase-client";
import { useAuth, useProfile } from "./auth";
import { runCommand } from "./commands";
import { DRAFT_TTL_MS, draftId } from "@/schema/drafts";
import type { SaveState } from "./autosave";

const SAVE_MS = 800;
const RETRY_MS = 5000;

/**
 * Device copy of a draft: localStorage. Chosen over IndexedDB because drafts are a few KB of form text, it is synchronous
 * (every keystroke is on the device before anything else happens, and restore needs no async dance), and quota is ample.
 * Anything that throws (private mode, quota) just means no device copy; the server copy still works.
 */
interface Stored { values: unknown; updatedAt: number; /** updatedAt of the last copy the server confirmed: a synced device copy whose server draft is gone was discarded or created elsewhere. */ syncedAt?: number }
const lsKey = (uid: string, id: string) => `draft:${uid}:${id}`;
function readLocal(uid: string, id: string): Stored | null {
  try {
    const s = JSON.parse(localStorage.getItem(lsKey(uid, id)) ?? "null") as Stored | null;
    return s && typeof s.updatedAt === "number" && Date.now() - s.updatedAt <= DRAFT_TTL_MS ? s : null;
  } catch { return null; }
}
const writeLocal = (uid: string, id: string, s: Stored) => { try { localStorage.setItem(lsKey(uid, id), JSON.stringify(s)); } catch { /* no device copy */ } };
const removeLocal = (uid: string, id: string) => { try { localStorage.removeItem(lsKey(uid, id)); } catch { /* ignore */ } };

/**
 * Draft of a "new X" form: values save as you type to this device, then to the server (drafts.save, 800ms later), so
 * another machine can pick it up. Opening the same (kind, contextKey) restores the newest copy.
 *   const d = useDraft("show", pitchId ? `pitch:${pitchId}` : "new", blank, { title: (v) => `New show ${v.date}` });
 *   if (!d.ready) return <Loading/>;   <ShowForm value={d.value} onChange={d.setValue} />
 *   after the create command succeeds:  await d.clear();
 * `initial` is read once. contextKey keeps different starting points apart (e.g. "new" vs "pitch:abc"); one draft per pair.
 */
export function useDraft<T extends object>(kind: string, contextKey: string, initial: T, meta: { title?(v: T): string; route?: string } = {}) {
  const { uid } = useProfile();
  const id = draftId(kind, contextKey);
  const [value, setVal] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [status, setStatus] = useState<SaveState>("idle");
  const latest = useRef<{ value: T; at: number } | null>(null);
  const initialRef = useRef(initial);
  const metaRef = useRef(meta); metaRef.current = meta;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const cleared = useRef(false);

  // Restore: the newer of the device copy and the server copy.
  useEffect(() => {
    let live = true;
    (async () => {
      let local = readLocal(uid, id);
      let server: { values: T; at: number } | null = null, serverKnown = false;
      try {
        const snap = await getDoc(doc(clientDb(), "users", uid, "drafts", id));
        const d = snap.data();
        if (d) {
          const at = (d.updatedAt as { toMillis(): number }).toMillis();
          if (Date.now() - at <= DRAFT_TTL_MS) server = { values: d.values as T, at };
        }
        serverKnown = true;
      } catch { /* offline: the device copy will do */ }
      if (!live) return;
      if (serverKnown && !server && local && (local.syncedAt ?? 0) >= local.updatedAt) { removeLocal(uid, id); local = null; }
      const best = server && (!local || server.at >= local.updatedAt) ? { values: server.values, at: server.at } : local ? { values: local.values as T, at: local.updatedAt } : null;
      if (best) { setVal({ ...initialRef.current, ...best.values }); setRestoredAt(best.at); latest.current = null; }
      setReady(true);
    })();
    return () => { live = false; };
  }, [uid, id]);

  const send = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const cur = latest.current;
    if (!cur || cleared.current) return;
    if (inflight.current) { await inflight.current; if (latest.current !== cur) return; }
    setStatus("saving");
    const m = metaRef.current;
    const p = runCommand("drafts.save", {
      kind, contextKey, values: cur.value, title: m.title?.(cur.value) ?? `New ${kind}`,
      route: m.route ?? window.location.pathname + window.location.search,
    }).then(() => {
      const l = readLocal(uid, id);
      if (l && l.updatedAt === cur.at) writeLocal(uid, id, { ...l, syncedAt: cur.at });
      if (latest.current === cur) latest.current = null;
      setStatus("saved");
    })
      .catch((e: { code?: string }) => {
        setStatus(e.code === "offline" ? "offline" : "error");
        timer.current = setTimeout(() => { timer.current = null; void send(); }, RETRY_MS);
      }).finally(() => { inflight.current = null; });
    inflight.current = p;
    await p;
  }, [kind, contextKey, uid, id]);

  const setValue = useCallback((next: T | ((p: T) => T)) => {
    setVal((prev) => {
      const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      const at = Date.now();
      latest.current = { value: v, at };
      writeLocal(uid, id, { values: v, updatedAt: at });
      return v;
    });
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void send(); }, SAVE_MS);
  }, [uid, id, send]);

  useEffect(() => {
    const out = () => void send();
    window.addEventListener("pagehide", out); window.addEventListener("online", out);
    return () => { window.removeEventListener("pagehide", out); window.removeEventListener("online", out); void send(); };
  }, [send]);

  /** Drop the draft everywhere (call after the create command succeeded, or for "Start over"). */
  const clear = useCallback(async ({ reset = false }: { reset?: boolean } = {}) => {
    cleared.current = true;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    latest.current = null;
    if (inflight.current) await inflight.current;
    removeLocal(uid, id);
    setStatus("idle"); setRestoredAt(null);
    if (reset) { setVal(initialRef.current); cleared.current = false; }
    try { await runCommand("drafts.discard", { draftId: id }); } catch { /* it expires on its own */ }
  }, [uid, id]);

  /** Await any unsaved change reaching the server. Call right before the create command so a late save can't resurrect the draft. */
  const settle = useCallback(async () => { await send(); if (inflight.current) await inflight.current; }, [send]);

  return { value, setValue, ready, restoredAt, status, clear, settle, draftId: id };
}

export interface DraftRow { id: string; kind: string; contextKey: string; title: string; route: string; updatedAt: number }

/** Live list of the signed-in user's own drafts (rules: owner-only read), newest first, without the expired ones. */
export function useDrafts(): DraftRow[] | null {
  const { state } = useAuth();
  const uid = state.status === "ready" ? state.profile.uid : null;
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(collection(clientDb(), "users", uid, "drafts"), (s) => {
      const now = Date.now();
      setRows(s.docs.map((d) => {
        const x = d.data();
        return { id: d.id, kind: x.kind, contextKey: x.contextKey, title: x.title, route: x.route, updatedAt: (x.updatedAt as { toMillis(): number }).toMillis() };
      }).filter((r) => now - r.updatedAt <= DRAFT_TTL_MS).sort((a, b) => b.updatedAt - a.updatedAt));
    }, () => setRows([]));
  }, [uid]);
  return rows;
}

/** True when a draft exists for this (kind, contextKey): open an inline "add" form straight away. */
export function useHasDraft(kind: string, contextKey: string): boolean {
  const rows = useDrafts();
  const id = draftId(kind, contextKey);
  return useMemo(() => !!rows?.some((r) => r.id === id), [rows, id]);
}
