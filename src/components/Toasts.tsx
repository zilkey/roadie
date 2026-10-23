"use client";
import { useEffect, useState } from "react";
import { runCommand } from "@/lib/commands";

/** Tiny toast store. `toast()` from anywhere; mount <ToastHost /> once in the app layout. */
export interface ToastItem {
  /** Same key replaces the earlier toast (a folded autosave keeps one toast). */
  key: string; text: string;
  /** When set, the toast shows an Undo button that undoes this run. */
  undoRunId?: string; ms: number;
}
let items: ToastItem[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const dismiss = (key: string) => { items = items.filter((t) => t.key !== key); emit(); };

export const UNDO_MS = 10_000;
export function toast(t: Omit<ToastItem, "ms"> & { ms?: number }) {
  items = [...items.filter((x) => x.key !== t.key), { ms: 4000, ...t }].slice(-3);
  emit();
}

export function useToasts() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return items;
}

/** What to say after history.undoRun. A field edited again since is left alone, never overwritten. */
async function undo(t: ToastItem) {
  dismiss(t.key);
  try {
    const r = await runCommand<{ reverted: { skippedFields?: string[] }[]; changedSince: unknown[] }>("history.undoRun", { runId: t.undoRunId });
    const kept = r.reverted.flatMap((x) => x.skippedFields ?? []);
    if (r.reverted.length) toast({ key: `${t.key}:undone`, text: kept.length ? `Undone. Kept newer changes to ${kept.join(", ")}.` : "Undone" });
    else toast({ key: `${t.key}:undone`, text: r.changedSince.length ? "Not undone: it was changed again since." : "Nothing to undo", ms: 5000 });
  } catch (e) {
    toast({ key: `${t.key}:undone`, text: `Couldn't undo: ${e instanceof Error ? e.message : "error"}`, ms: 6000 });
  }
}

function One({ t }: { t: ToastItem }) {
  useEffect(() => { const h = setTimeout(() => dismiss(t.key), t.ms); return () => clearTimeout(h); }, [t]);
  return (
    <div className="toast" role="status" data-testid="toast">
      <span data-testid="toast-text">{t.text}</span>
      {t.undoRunId && <button type="button" className="btn sm ghost" data-testid="undo-button" onClick={() => undo(t)}>Undo</button>}
    </div>
  );
}

export function ToastHost() {
  const list = useToasts();
  if (!list.length) return null;
  return <div className="toasts" data-testid="toasts" aria-live="polite">{list.map((t) => <One key={t.key + t.text} t={t} />)}</div>;
}
