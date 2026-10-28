"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { clientDb } from "./firebase-client";
import { useAuth, useProfile } from "./auth";
import { useHref } from "./artist";
import { DraftChannel, openDraft, pushPending } from "./draftSync";
import { DRAFT_TTL_MS, isEditPath } from "@/schema/drafts";
import type { SaveState } from "./autosave";
import { useBusyWhile } from "./busy";

/** Keep a channel's flush hooks wired for as long as the component is mounted. */
export function useChannelLifecycle(ch: DraftChannel | null) {
  useEffect(() => {
    if (!ch) return;
    const exit = () => ch.flushOnExit();
    const back = () => ch.resume();
    const vis = () => (document.visibilityState === "hidden" ? exit() : back());
    window.addEventListener("pagehide", exit); window.addEventListener("pageshow", back); window.addEventListener("online", back);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("pagehide", exit); window.removeEventListener("pageshow", back); window.removeEventListener("online", back);
      document.removeEventListener("visibilitychange", vis); void ch.flush();
    };
  }, [ch]);
}

/**
 * Draft of a "new X" form, stored at unsubmittedDrafts/{uid}__{path}. `path` is the collection the record will live in
 * (`draftPath.newIn("expenses")`) or the parent's path plus the child collection (`draftPath.newUnder("venues", id, "contacts")`).
 * Every change is written (the whole form state, last write wins) to this device at once and to the server 500ms later; opening
 * the same path on any machine restores it. The create command clears it (pass `draftId` as `clearDraft`).
 *   const d = useDraft(draftPath.newIn("shows"), blank, { title: (v) => `New show ${v.date}` });
 *   if (!d.ready) return <Loading/>;   <ShowForm value={d.value} onChange={d.setValue} />
 *   after the create command succeeded:  await d.clear();
 * `initial` is read once and merged under the stored values.
 */
export function useDraft<T extends object>(path: string, initial: T, meta: { title?(v: T): string; route?: string } = {}) {
  const { uid } = useProfile();
  const toHref = useHref(); // a relative `route` is stored inside the current artist
  const toHrefRef = useRef(toHref); toHrefRef.current = toHref;
  const [value, setVal] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  useBusyWhile(!ready); // the top loading bar covers restoring a saved draft
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [status, setStatus] = useState<SaveState>("idle");
  const initialRef = useRef(initial);
  const metaRef = useRef(meta); metaRef.current = meta;
  const cur = useRef<T>(initial);
  const ch = useMemo(() => new DraftChannel(uid, path, setStatus), [uid, path]);
  useChannelLifecycle(ch);

  useEffect(() => {
    let live = true;
    void openDraft(uid, path).then((d) => {
      if (!live) return;
      if (d) { cur.current = { ...initialRef.current, ...d.values } as T; setVal(cur.current); setRestoredAt(d.at); ch.adopt(); void ch.flush(); }
      setReady(true);
    });
    return () => { live = false; };
  }, [uid, path, ch]);

  const setValue = useCallback((next: T | ((p: T) => T)) => {
    const v = typeof next === "function" ? (next as (p: T) => T)(cur.current) : next;
    cur.current = v; setVal(v);
    const m = metaRef.current;
    ch.set({ values: v as Record<string, unknown>, title: m.title?.(v) ?? "", route: m.route ? toHrefRef.current(m.route) : window.location.pathname + window.location.search });
  }, [ch]);

  /** Drop the draft everywhere (call after the create command succeeded, or for "Start over"). */
  const clear = useCallback(async ({ reset = false }: { reset?: boolean } = {}) => {
    setRestoredAt(null);
    if (reset) { cur.current = initialRef.current; setVal(initialRef.current); }
    await ch.clear();
    setStatus("idle");
  }, [ch]);

  /** Await any unsaved change reaching the server. Call right before the create command so a late save can't resurrect the draft. */
  const settle = useCallback(() => ch.flush(), [ch]);

  /** `draftId` is the path: pass it as the `clearDraft` meta of the create command. */
  return { value, setValue, ready, restoredAt, status, clear, settle, draftId: path };
}

export interface DraftRow { id: string; path: string; title: string; route: string; updatedAt: number; /** Unsaved edits to an existing record (not a new one). */ edit: boolean }

/** Live list of the signed-in user's own unsubmitted drafts (rules: owner-only read), newest first, without the expired ones. */
export function useDrafts(): DraftRow[] | null {
  const { state } = useAuth();
  const uid = state.status === "ready" ? state.profile.uid : null;
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  useEffect(() => {
    if (!uid) return;
    pushPending(uid);
    return onSnapshot(query(collection(clientDb(), "unsubmittedDrafts"), where("uid", "==", uid)), (s) => {
      const now = Date.now();
      setRows(s.docs.map((d) => {
        const x = d.data();
        return { id: d.id, path: x.path as string, title: x.title, route: x.route, updatedAt: (x.updatedAt as { toMillis(): number }).toMillis(), expiresAt: (x.expiresAt as { toMillis(): number }).toMillis() };
      }).filter((r) => r.expiresAt > now && now - r.updatedAt <= DRAFT_TTL_MS)
        .map(({ expiresAt: _e, ...r }) => ({ ...r, edit: isEditPath(r.path) }))
        .sort((a, b) => b.updatedAt - a.updatedAt));
    }, () => setRows([]));
  }, [uid]);
  return rows;
}

/** True when a draft exists at this path: open an inline "add" form straight away. */
export function useHasDraft(path: string): boolean {
  const rows = useDrafts();
  return useMemo(() => !!rows?.some((r) => r.path === path), [rows, path]);
}
