"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import type { ShowRow } from "../common";

type Choice = "hold" | "confirmed" | "canceled" | "dropped";
const LABEL: Record<string, string> = { hold: "Hold", confirmed: "Confirmed", played: "Played", canceled: "Canceled", dropped: "Dropped" };
const OPTIONS: [Choice, string][] = [
  ["hold", "penciled in, not locked"],
  ["confirmed", "it's happening"],
  ["canceled", "the venue called it off"],
  ["dropped", "we called it off"],
];
const pillClass = (status: string) => `pill${status === "confirmed" ? " ok" : status === "hold" || status === "canceled" || status === "dropped" ? ` ${status}` : ""}`;

/** The status pill beside the title. Admins press it to open "Change status"; members see it plain. */
export function StatusPill({ show, admin }: { show: ShowRow; admin: boolean }) {
  const status = show.status;
  const label = LABEL[status] ?? status;
  const lastReason = (status === "canceled" || status === "dropped")
    ? [...(show.statusHistory ?? [])].reverse().find((h) => h.status === status)?.reason
    : undefined;
  const reasonNote = lastReason ? <span className="s" data-testid="show-reason">{lastReason}</span> : null;

  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<Choice>("hold");
  const [reason, setReason] = useState("");
  const { call, error, busy, setError } = useCommand();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialogId = useId();

  function close() { setOpen(false); setError(null); trigger.current?.focus(); }
  function toggle() {
    if (open) return close();
    setPick((status === "hold" || status === "confirmed" || status === "canceled" || status === "dropped" ? status : "hold") as Choice);
    setReason("");
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) { setOpen(false); setError(null); } };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const r = await call("shows.setStatus", { id: show.id, status: pick, ...(pick !== "confirmed" && reason.trim() ? { reason: reason.trim() } : {}) });
    if (r !== undefined) { setOpen(false); trigger.current?.focus(); }
  }

  if (!admin || status === "played") {
    return <span className="inline-flex items-center gap-2"><span className={pillClass(status)} data-testid="show-status">{label}</span>{reasonNote}</span>;
  }

  return (
    <div className="relative inline-flex items-center gap-2" ref={root}>
      <button
        ref={trigger} type="button" className={pillClass(status)} style={{ minHeight: 44, border: 0, cursor: "pointer", font: "inherit", fontWeight: 700, fontSize: "0.8125rem" }}
        aria-label={`Change status, currently ${label}`} aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? dialogId : undefined}
        onClick={toggle} data-testid="show-status"
      >
        {label}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={open ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} />
        </svg>
      </button>
      {reasonNote}
      {open && (
        <div
          id={dialogId} role="dialog" aria-label="Change status" data-testid="status-menu" className="card"
          style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 30, width: "min(560px, calc(100vw - 32px))", padding: 14, gap: 4, boxShadow: "0 12px 32px rgba(40,30,10,.16)" }}
        >
          <span className="lbl" style={{ padding: "4px 14px 6px" }}>Change status</span>
          <div role="radiogroup" aria-label="Status" className="grid gap-1">
            {OPTIONS.map(([v, hint]) => (
              <label key={v} className="flex items-center gap-2.5 cursor-pointer rounded-[10px] px-3.5" style={{ minHeight: 48, background: pick === v ? "var(--divider)" : undefined }}>
                <input type="radio" name="show-status-choice" value={v} checked={pick === v} onChange={() => setPick(v)} data-testid={`status-opt-${v}`} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
                <span className={pillClass(v)} style={{ padding: 0, background: "none", minHeight: 0, gap: 0 }} aria-hidden="true" />
                <b>{LABEL[v]}</b>
                <span className="s">({hint})</span>
              </label>
            ))}
          </div>
          {pick !== "confirmed" && (
            <div className="grid gap-1.5" style={{ padding: "8px 14px 4px" }}>
              <label className="lbl" htmlFor={`${dialogId}-why`}>Reason <span className="s">(optional)</span></label>
              <textarea id={`${dialogId}-why`} className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="status-reason" />
            </div>
          )}
          <div style={{ padding: "0 14px" }}><ErrorBox error={error} /></div>
          <div className="flex justify-end gap-2.5" style={{ padding: "8px 14px 4px" }}>
            <button type="button" className="btn outline" onClick={close} data-testid="status-cancel">Cancel</button>
            <button type="button" className="btn acc" disabled={busy || pick === status} onClick={() => void save()} data-testid="status-save">Change to {LABEL[pick]}</button>
          </div>
        </div>
      )}
    </div>
  );
}
