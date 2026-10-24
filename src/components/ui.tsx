"use client";
import { useEffect, useRef, useState } from "react";
import { CommandError, runCommand, type CommandMeta } from "@/lib/commands";

export function PageTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4 grid gap-0.5">
      <h1 className="text-2xl" data-testid="page-title">{title}</h1>
      {sub && <p className="s">{sub}</p>}
    </div>
  );
}

export function Stub({ title, slice, children }: { title: string; slice: number; children?: React.ReactNode }) {
  return (
    <div className="grid gap-3">
      <PageTitle title={title} />
      <div className="card" data-testid="stub"><span className="s">Coming in slice {slice}.</span>{children}</div>
    </div>
  );
}

export function useCommand() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function call<T = { id?: string }>(name: string, input: unknown, meta?: CommandMeta): Promise<T | undefined> {
    setBusy(true); setError(null);
    try {
      return await runCommand<T>(name, input, meta);
    } catch (e) {
      const ce = e as CommandError;
      setError(ce.issues?.length ? `${ce.message}: ${ce.issues.map((i) => `${i.path} ${i.message}`).join("; ")}` : ce.message);
    } finally { setBusy(false); }
  }
  return { call, error, busy, setError };
}
export const ErrorBox = ({ error }: { error: string | null }) => (error ? <div className="err" role="alert" data-testid="error">{error}</div> : null);

/** A single choice from a list. Chips are for picking several; this is for picking one. */
export function Select<T extends string>({ value, options, onChange, placeholder, testid, label, disabled, className }: {
  value: T | ""; options: readonly (readonly [T, string])[]; onChange(v: T): void; placeholder?: string; testid?: string; label?: string; disabled?: boolean; className?: string;
}) {
  return (
    <select className={`select${className ? ` ${className}` : ""}`} value={value} disabled={disabled} aria-label={label} data-testid={testid} onChange={(e) => onChange(e.target.value as T)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

/** One toggle in a multiselect: pressed shows a check mark. Pass `on` and flip it in onToggle. */
export function PickChip({ on, onToggle, testid, children }: { on: boolean; onToggle(): void; testid?: string; children: React.ReactNode }) {
  return <button type="button" className="pick" aria-pressed={on} data-testid={testid} onClick={onToggle}>{children}</button>;
}

/** A modal question: the native <dialog>, so focus is trapped and Escape closes it. `onClose` runs for Escape and for the backdrop. */
export function Dialog({ open, onClose, title, testid, children }: { open: boolean; onClose(): void; title: string; testid?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dlg" data-testid={testid} aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && <div className="grid gap-3"><h2 className="text-lg">{title}</h2>{children}</div>}
    </dialog>
  );
}
