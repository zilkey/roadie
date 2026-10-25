"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StagePlot } from "@/schema/stagePlots";

export type InputEdit = { source?: string; gear?: string; stand?: string; note?: string; phantom?: boolean; musicianId?: string };
export type MixEdit = { kind?: "wedge" | "iem" | "sidefill"; musicianId?: string; wants?: string };
export type TextEdit = { name?: string; bring?: string; need?: string };
interface Edits { i: Record<string, InputEdit>; m: Record<string, MixEdit>; t: TextEdit }
const EMPTY: Edits = { i: {}, m: {}, t: {} };
const DEBOUNCE_MS = 800;

const nul = (s: string) => s.trim() || null;
const inputRow = (id: string, e: InputEdit) => ({
  id,
  ...(e.source !== undefined ? { source: nul(e.source) } : {}), ...(e.gear !== undefined ? { gear: nul(e.gear) } : {}),
  ...(e.stand !== undefined ? { stand: nul(e.stand) } : {}), ...(e.note !== undefined ? { note: nul(e.note) } : {}),
  ...(e.phantom !== undefined ? { phantom: e.phantom ? true : null } : {}), ...(e.musicianId !== undefined ? { musicianId: e.musicianId || null } : {}),
});
const mixRow = (id: string, e: MixEdit) => ({
  id, ...(e.kind ? { kind: e.kind } : {}),
  ...(e.musicianId !== undefined ? { musicianId: e.musicianId || null } : {}), ...(e.wants !== undefined ? { wants: nul(e.wants) } : {}),
});

const merge = (a: Edits, b: Edits): Edits => {
  const out: Edits = { i: { ...a.i }, m: { ...a.m }, t: { ...a.t, ...b.t } };
  for (const [k, v] of Object.entries(b.i)) out.i[k] = { ...out.i[k], ...v };
  for (const [k, v] of Object.entries(b.m)) out.m[k] = { ...out.m[k], ...v };
  return out;
};

/**
 * Text and checkbox edits in the channel list, mixes, bring/need and plot name. What was typed shows at once (`edits`); after a
 * pause (or at once with `now`, and on leaving) the unsent part goes out as updateInputs / setMonitors / setBringNeed / rename.
 * An edit stays on screen until the live plot shows the same value, so nothing flickers back to the old text.
 */
export function useRowEdits(plot: StagePlot & { id: string }, send: (name: string, input: Record<string, unknown>) => Promise<unknown>) {
  const [edits, setEdits] = useState<Edits>(EMPTY);
  const unsent = useRef<Edits>(EMPTY);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendRef = useRef(send); sendRef.current = send;

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const u = unsent.current;
    unsent.current = EMPTY;
    const s = sendRef.current;
    if (Object.keys(u.i).length) void s("stagePlots.updateInputs", { inputs: Object.entries(u.i).map(([id, e]) => inputRow(id, e)) });
    if (Object.keys(u.m).length) void s("stagePlots.setMonitors", { monitors: Object.entries(u.m).map(([id, e]) => mixRow(id, e)) });
    if (u.t.bring !== undefined || u.t.need !== undefined) void s("stagePlots.setBringNeed", { ...(u.t.bring !== undefined ? { bring: nul(u.t.bring) } : {}), ...(u.t.need !== undefined ? { need: nul(u.t.need) } : {}) });
    if (u.t.name !== undefined && u.t.name.trim()) void s("stagePlots.rename", { name: u.t.name.trim() });
  }, []);

  const queue = useCallback((e: Partial<Edits>, now: boolean) => {
    const add: Edits = { i: e.i ?? {}, m: e.m ?? {}, t: e.t ?? {} };
    setEdits((x) => merge(x, add));
    unsent.current = merge(unsent.current, add);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, now ? 0 : DEBOUNCE_MS);
  }, [flush]);

  const editInput = useCallback((id: string, p: InputEdit, now = false) => queue({ i: { [id]: p } }, now), [queue]);
  const editMix = useCallback((id: string, p: MixEdit, now = false) => queue({ m: { [id]: p } }, now), [queue]);
  const editText = useCallback((p: TextEdit, now = false) => queue({ t: p }, now), [queue]);
  /** Forget a text edit that must not be sent (an emptied name): the field shows the saved value again. */
  const revertText = useCallback((k: keyof TextEdit) => {
    setEdits((x) => { const t = { ...x.t }; delete t[k]; return { ...x, t }; });
    const t = { ...unsent.current.t }; delete t[k]; unsent.current = { ...unsent.current, t };
  }, []);

  // Drop an edit once the live plot shows the same value.
  useEffect(() => {
    setEdits((x) => {
      let changed = false;
      const next: Edits = { i: {}, m: {}, t: {} };
      for (const [id, e] of Object.entries(x.i)) {
        const row = plot.inputs.find((r) => r.id === id);
        if (!row) { changed = true; continue; }
        const keep: InputEdit = {};
        for (const [k, v] of Object.entries(e) as [keyof InputEdit, string | boolean][]) {
          const sv = row[k];
          const same = k === "phantom" ? !!sv === !!v : (typeof v === "string" ? v.trim() : v) === (sv ?? "");
          if (same && unsent.current.i[id]?.[k] === undefined) changed = true; else (keep as Record<string, unknown>)[k] = v;
        }
        if (Object.keys(keep).length) next.i[id] = keep;
      }
      for (const [id, e] of Object.entries(x.m)) {
        const row = plot.monitors.find((r) => r.id === id);
        if (!row) { changed = true; continue; }
        const keep: MixEdit = {};
        for (const [k, v] of Object.entries(e) as [keyof MixEdit, string][]) {
          const same = (k === "wants" ? v.trim() : v) === (row[k] ?? "");
          if (same && unsent.current.m[id]?.[k] === undefined) changed = true; else (keep as Record<string, unknown>)[k] = v;
        }
        if (Object.keys(keep).length) next.m[id] = keep;
      }
      for (const [k, v] of Object.entries(x.t) as [keyof TextEdit, string][]) {
        const same = v.trim() === (plot[k] ?? "");
        if (same && unsent.current.t[k] === undefined) changed = true; else next.t[k] = v;
      }
      return changed ? next : x;
    });
  }, [plot]);

  // Don't lose a pending edit when leaving the page.
  useEffect(() => {
    const out = () => flush();
    window.addEventListener("pagehide", out);
    return () => { window.removeEventListener("pagehide", out); flush(); };
  }, [flush]);

  return { edits, editInput, editMix, editText, revertText, flush };
}
