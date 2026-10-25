"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandError, runCommandFull } from "@/lib/commands";
import type { SaveState } from "@/lib/autosave";
import { applyMoves, reorderInputs, type Move } from "@/lib/stagePlots/plot";
import type { PlotShape } from "@/schema/stagePlots";

interface Overlay { moves: Record<string, Move>; order: string[] | null }
const EMPTY: Overlay = { moves: {}, order: null };

/**
 * Sends one stage plot's edits to the server, one command at a time and in order, and keeps what the person just did on screen
 * until the live document has caught up (`view`): a drag, a nudge or a row reorder shows at once, with ONE command per gesture.
 * A failed command drops the optimistic state, so the screen goes back to what the server has.
 */
export function useStagePlotSaver(plotId: string, rev: number, server: PlotShape) {
  const [status, setStatus] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [busyN, setBusyN] = useState(0);
  const [tick, setTick] = useState(0);
  const [ov, setOv] = useState<Overlay>(EMPTY);
  const inflight = useRef(0);
  const needRev = useRef(0);
  const failed = useRef(false);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const send = useCallback(<T = Record<string, unknown>>(name: string, input: Record<string, unknown> = {}): Promise<T | undefined> => {
    inflight.current++; setBusyN(inflight.current); failed.current = false;
    setStatus("saving"); setError(null);
    const job = chain.current.then(async () => {
      try {
        const out = await runCommandFull<T>(name, { id: plotId, ...input });
        needRev.current = Math.max(needRev.current, out.revs[plotId] ?? 0);
        return out.result;
      } catch (e) {
        const ce = e as CommandError;
        failed.current = true;
        setOv(EMPTY);
        setError(ce.issues?.length ? `${ce.message}: ${ce.issues.map((i) => `${i.path} ${i.message}`).join("; ")}` : ce.message ?? "error");
        setStatus(ce.code === "offline" ? "offline" : "error");
        return undefined;
      } finally {
        inflight.current--; setBusyN(inflight.current); setTick((t) => t + 1);
        if (!failed.current) setStatus(inflight.current ? "saving" : "saved");
      }
    });
    chain.current = job.catch(() => undefined);
    return job;
  }, [plotId]);

  /** Everything sent so far has finished. */
  const settle = useCallback(async () => { await chain.current; }, []);

  /** One drag, nudge, rotate or return-to-strip: shown at once, sent as a single stagePlots.move. */
  const commitMoves = useCallback((moves: Move[]) => {
    setOv((o) => ({ ...o, moves: { ...o.moves, ...Object.fromEntries(moves.map((m) => [m.id, { ...o.moves[m.id], ...m }])) } }));
    return send("stagePlots.move", { moves });
  }, [send]);
  const commitOrder = useCallback((order: string[]) => {
    setOv((o) => ({ ...o, order }));
    return send("stagePlots.reorderInputs", { order });
  }, [send]);

  // Drop the optimistic layer once every command is done and the live document has seen the result.
  const hasOv = ov.order !== null || Object.keys(ov.moves).length > 0;
  useEffect(() => {
    if (hasOv && inflight.current === 0 && rev >= needRev.current) setOv(EMPTY);
  }, [hasOv, rev, tick, busyN]);

  /** The plot as it should look now: the live one with this person's unsaved gestures applied. */
  const view = useMemo<PlotShape>(() => {
    let p = server;
    try {
      const known = new Set([...p.inputs.map((i) => i.id), ...p.items.map((i) => i.id), ...p.monitors.map((m) => m.id)]);
      const moves = Object.values(ov.moves).filter((m) => known.has(m.id));
      if (moves.length) p = applyMoves(p, moves);
      if (ov.order && ov.order.length === p.inputs.length && p.inputs.every((i) => ov.order!.includes(i.id))) p = reorderInputs(p, ov.order);
    } catch { /* fall back to what we have */ }
    return p;
  }, [server, ov]);

  return { status, error, busy: busyN > 0, send, settle, commitMoves, commitOrder, view };
}
