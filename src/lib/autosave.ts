"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommandError, newMutationId, runCommandFull } from "./commands";
import { toast, UNDO_MS } from "@/components/Toasts";

export type SaveState = "idle" | "saving" | "saved" | "offline" | "error" | "conflict";
export const AUTOSAVE_MS = 800;
const RETRY_MS = 5000;

interface Job { patch: Record<string, unknown>; mutationId: string }
const emptyToNull = (s: string) => (s.trim() === "" ? null : s);

/**
 * Autosave for ONE existing record, through its `<kind>.update` command.
 *   const as = useAutosave({ command: "venues.update", id, rev: venue.rev });
 *   <input {...as.bind("notes", venue.notes ?? "")} />      // text field: local value, saves on blur or after 800ms
 *   as.patch({ capacity: 120 })                             // any other change: a field-level patch ({key: null} clears)
 *   <SaveStatus {...as.statusProps} />
 * Patches merge per key and go out one request at a time. Each request carries a clientMutationId (a double tap or a
 * retry after a lost response is applied once), baseRev (a field someone else changed meanwhile comes back as a
 * conflict instead of being overwritten) and autosave:true (the server folds bursts into one history entry).
 * After each save a toast with Undo (10s) is shown. Offline: the patch is kept and retried.
 */
export function useAutosave({ command, id, rev, delay = AUTOSAVE_MS, onUseTheirs }: {
  command: string; id: string; rev?: number; delay?: number;
  /** Called when the person picks "Use theirs" after a conflict: reset your local form state to the server's. */
  onUseTheirs?(): void;
}) {
  const [status, setStatus] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ message: string; currentRev: number } | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const pending = useRef<Record<string, unknown>>({});
  const retry = useRef<Job | null>(null);
  const held = useRef<Job | null>(null);
  const running = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseRev = useRef(rev ?? 0);
  const seenId = useRef(id);
  const cfg = useRef({ command, id, onUseTheirs });
  cfg.current = { command, id, onUseTheirs };

  useEffect(() => {
    if (seenId.current !== id) { seenId.current = id; baseRev.current = 0; pending.current = {}; retry.current = null; held.current = null; }
    baseRev.current = Math.max(baseRev.current, rev ?? 0);
  }, [id, rev]);

  const isBusy = useCallback(
    () => running.current || !!timer.current || !!retry.current || !!held.current || Object.keys(pending.current).length > 0, []);

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (retry.current || Object.keys(pending.current).length) {
        const job: Job = retry.current ?? { patch: pending.current, mutationId: newMutationId() };
        if (!retry.current) pending.current = {};
        retry.current = null;
        setStatus("saving"); setError(null);
        const { command: cmd, id: rid } = cfg.current;
        try {
          const out = await runCommandFull(cmd, { id: rid, patch: job.patch }, { clientMutationId: job.mutationId, baseRev: baseRev.current, autosave: true });
          if (out.revs[rid]) baseRev.current = Math.max(baseRev.current, out.revs[rid]);
          if (Object.keys(out.revs).length) {
            toast({ key: `${cmd}:${rid}:${out.runId}`, text: `Saved ${Object.keys(job.patch).join(", ")}`, undoRunId: out.runId, ms: UNDO_MS });
          }
          setStatus(held.current ? "conflict" : "saved");
        } catch (e) {
          const ce = e as CommandError;
          if (ce.code === "offline") {
            retry.current = job; setStatus("offline");
            retryTimer.current = setTimeout(() => { retryTimer.current = null; void drain(); }, RETRY_MS);
          } else if (ce.code === "conflict") {
            held.current = job;
            setConflict({ message: ce.message, currentRev: (ce.data as { currentRev?: number } | undefined)?.currentRev ?? baseRev.current });
            setStatus("conflict");
          } else {
            setError(ce.issues?.length ? `${ce.message}: ${ce.issues.map((i) => `${i.path} ${i.message}`).join("; ")}` : ce.message ?? "error");
            setStatus("error");
          }
          break;
        }
      }
    } finally { running.current = false; }
  }, []);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    return drain();
  }, [drain]);

  const patch = useCallback((p: Record<string, unknown>, o: { now?: boolean } = {}) => {
    if (!Object.keys(p).length) return;
    pending.current = { ...pending.current, ...p };
    setStatus((s) => (s === "conflict" ? s : "saving"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void drain(); }, o.now ? 0 : delay);
  }, [delay, drain]);

  // Don't lose a pending edit when leaving the page or coming back online.
  useEffect(() => {
    const out = () => void flush();
    const vis = () => { if (document.visibilityState === "hidden") out(); };
    window.addEventListener("pagehide", out); window.addEventListener("online", out); document.addEventListener("visibilitychange", vis);
    return () => { window.removeEventListener("pagehide", out); window.removeEventListener("online", out); document.removeEventListener("visibilitychange", vis); void flush(); };
  }, [flush]);

  // Local text edits stay on screen until the live document has caught up with what we saved (or an Undo changed it).
  useEffect(() => {
    if ((status === "saved" || status === "idle") && !isBusy() && (rev ?? 0) >= baseRev.current) setEdits((e) => (Object.keys(e).length ? {} : e));
  }, [rev, status, isBusy]);

  const bind = (key: string, serverValue: string, o: { toPatch?(s: string): unknown } = {}) => ({
    value: key in edits ? edits[key] : serverValue,
    onChange: (e: { target: { value: string } }) => {
      const val = e.target.value;
      setEdits((x) => ({ ...x, [key]: val }));
      patch({ [key]: (o.toPatch ?? emptyToNull)(val) });
    },
    onBlur: () => { void flush(); },
  });

  /** Show "Not saved: <why>" without sending anything (e.g. a required field was emptied). */
  const hold = (why: string) => { setError(why); setStatus("error"); };

  const keepMine = () => {
    const j = held.current; held.current = null;
    if (conflict) baseRev.current = Math.max(baseRev.current, conflict.currentRev);
    setConflict(null);
    if (j) { retry.current = j; void drain(); }
  };
  const acceptTheirs = () => {
    held.current = null; pending.current = {}; setConflict(null); setEdits({}); setStatus("saved"); cfg.current.onUseTheirs?.();
  };

  return {
    status, error, conflict, patch, hold, flush, bind, isBusy,
    /** Spread onto <SaveStatus />. */
    statusProps: { status, error, conflict, onKeepMine: keepMine, onUseTheirs: acceptTheirs },
  };
}
