"use client";
import { useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { AddressAutocomplete, type Place } from "@/components/AddressAutocomplete";
import { EditFoot, EditInput, ModalHead, MoneyDialog } from "@/components/money/MoneyOutModal";
import { useInstantSave } from "@/components/shows/saved";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { EXPENSE_LABEL, formatCents } from "@/lib/money";
import { dayLabel, driveText } from "@/lib/tours";
import type { Expense, Income, Payout, TourEntry } from "@/schema";
import { townOf } from "./common";

export type EntryKind = "drive" | "stay" | "note";
/** What the modal is for: a new drive, stay or note at a slot of a day (from a + or a dragged chip), or an existing entry. */
export type EntryTarget =
  | { kind: EntryKind; tourId: string; date: string; after?: string; before?: string; from?: Place }
  | { kind: EntryKind; tourId: string; entry: Row<TourEntry> };

const NOUN: Record<EntryKind, string> = { drive: "drive", stay: "stay", note: "note" };
const placeText = (p?: { name?: string; address: string } | null) => (p ? (p.name && !p.address.startsWith(p.name) ? `${p.name}, ${p.address}` : p.address) : "");

/**
 * A drive, stay or note on a tour day (the "Stay modal" board). From a + it is new: the fields stay here until the explicit
 * "Add stay" (tours.entries.add, at the slot the + was in). Clicking an existing entry opens the same fields autosaving one at a
 * time through tours.entries.update (each with an Undo toast), and one Done. A drive shows its miles and time once the server
 * has them. For admins, an existing drive or stay lists the money pinned to it.
 */
export function EntryModal({ target, admin, onClose }: { target: EntryTarget | null; admin: boolean; onClose(): void }) {
  const title = !target ? "" : "entry" in target ? existingTitle(target.entry) : `Add a ${NOUN[target.kind]}`;
  return (
    <MoneyDialog open={!!target} onClose={onClose} testid="entry-modal" title={title}>
      {target && ("entry" in target
        ? <EditEntry key={target.entry.id} tourId={target.tourId} entry={target.entry} admin={admin} onClose={onClose} />
        : <NewEntry key={`${target.kind}:${target.date}:${target.after ?? ""}:${target.before ?? ""}`} target={target} onClose={onClose} />)}
    </MoneyDialog>
  );
}

function existingTitle(e: Row<TourEntry>): string {
  if (e.kind === "drive") return e.to ? `Drive to ${townOf(e.to)}` : "Drive";
  if (e.kind === "stay") return e.name ? `Stay · ${e.name}` : "Stay";
  return "Note";
}

function NewEntry({ target, onClose }: { target: Extract<EntryTarget, { date: string }>; onClose(): void }) {
  const { call, busy, error } = useCommand();
  const [from, setFrom] = useState<Place | null>(target.from ?? null);
  const [to, setTo] = useState<Place | null>(null);
  const [leaveBy, setLeaveBy] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState<Place | null>(null);
  const [nights, setNights] = useState("1");
  const [checkIn, setCheckIn] = useState("");
  const [text, setText] = useState("");
  const k = target.kind;
  const n = Number(nights);
  const ok = k === "note" ? !!text.trim() : k === "stay" ? Number.isInteger(n) && n > 0 : true;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!ok) return;
    const fields = k === "drive" ? { from: from ?? undefined, to: to ?? undefined, leaveBy: leaveBy || undefined }
      : k === "stay" ? { name: name.trim() || undefined, address: address ?? undefined, nights: n, checkIn: checkIn || undefined }
      : { text: text.trim() };
    if (await call("tours.entries.add", { tourId: target.tourId, kind: k, date: target.date, after: target.after, before: target.before, ...fields })) onClose();
  }

  return (
    <form onSubmit={add} data-testid={`entry-new-${k}`}>
      <ModalHead title={`Add a ${NOUN[k]}`} sub={dayLabel(target.date)} onClose={onClose} testid="entry-close" />
      <div className="grid gap-4" style={{ padding: "18px 22px" }}>
        {k === "drive" && <>
          <PlaceField label="From" value={from} onPick={setFrom} onClear={() => setFrom(null)} testid="entry-from" />
          <PlaceField label="To" value={to} onPick={setTo} onClear={() => setTo(null)} testid="entry-to" />
          <label className="grid gap-1"><span className="lbl">Leave by <i className="font-normal not-italic">(optional)</i></span>
            <input className="input" type="time" value={leaveBy} onChange={(e) => setLeaveBy(e.target.value)} data-testid="entry-leave-by" /></label>
        </>}
        {k === "stay" && <>
          <label className="grid gap-1"><span className="lbl">Where</span>
            <input className="input" value={name} placeholder="Airbnb, The van, a friend's place" autoFocus onChange={(e) => setName(e.target.value)} data-testid="entry-name" /></label>
          <PlaceField label="Address" optional value={address} onPick={setAddress} onClear={() => setAddress(null)} testid="entry-address" />
          <div className="grid grid-cols-2 gap-[14px]">
            <label className="grid gap-1"><span className="lbl">Nights</span>
              <input className="input" inputMode="numeric" value={nights} onChange={(e) => setNights(e.target.value)} data-testid="entry-nights" /></label>
            <label className="grid gap-1"><span className="lbl">Check in <i className="font-normal not-italic">(optional)</i></span>
              <input className="input" type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} data-testid="entry-check-in" /></label>
          </div>
        </>}
        {k === "note" && <label className="grid gap-1"><span className="lbl">Note</span>
          <textarea className="input" rows={3} value={text} autoFocus onChange={(e) => setText(e.target.value)} data-testid="entry-text" style={{ paddingTop: 10, paddingBottom: 10 }} /></label>}
        <ErrorBox error={error} />
      </div>
      <div className="flex justify-end border-t border-divider" style={{ padding: "14px 22px 20px" }}>
        <button type="submit" className="btn acc" disabled={busy || !ok} data-testid="entry-add">Add {NOUN[k]}</button>
      </div>
    </form>
  );
}

function EditEntry({ tourId, entry: e, admin, onClose }: { tourId: string; entry: Row<TourEntry>; admin: boolean; onClose(): void }) {
  const s = useInstantSave();
  const [bad, setBad] = useState<string | null>(null);
  const k = e.kind as EntryKind;
  const save = (patch: Record<string, unknown>, what: string) => s.save("tours.entries.update", { tourId, id: e.id, patch }, what);
  const facts = k === "drive" ? driveText(e.minutes, e.miles) : "";
  const sub = [dayLabel(e.date!), k === "stay" && e.address ? townOf(e.address) : "", "changes save as you go"].filter(Boolean).join(" · ");

  return (
    <div data-testid={`entry-edit-${k}`}>
      <ModalHead title={existingTitle(e)} sub={sub} onClose={onClose} testid="entry-close" />
      <div className="grid gap-4" style={{ padding: "18px 22px" }}>
        {k === "drive" && <>
          <PlaceField label="From" value={e.from ?? null} onPick={(p) => void save({ from: p }, "where the drive starts")} onClear={() => void save({ from: null }, "where the drive starts")} testid="entry-from" />
          <PlaceField label="To" value={e.to ?? null} onPick={(p) => void save({ to: p }, "where the drive goes")} onClear={() => void save({ to: null }, "where the drive goes")} testid="entry-to" />
          <TimeInput label="Leave by" value={e.leaveBy ?? ""} testid="entry-leave-by" onCommit={(v) => save({ leaveBy: v || null }, "leave by")} />
          <span className="text-[0.875rem] text-muted" data-testid="entry-drive-facts">{facts || "Miles and drive time show once both ends are set."}</span>
        </>}
        {k === "stay" && <>
          <EditInput label="Where" value={e.name ?? ""} testid="entry-name" onCommit={(v) => save({ name: v.trim() || null }, "where you're staying")} />
          <PlaceField label="Address" value={e.address ?? null} onPick={(p) => void save({ address: p }, "the address")} onClear={() => void save({ address: null }, "the address")} testid="entry-address" />
          <div className="grid grid-cols-2 gap-[14px]">
            <EditInput label="Nights" value={String(e.nights ?? 1)} testid="entry-nights"
              onCommit={(v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) { setBad("Nights is a whole number, 1 or more."); return false; } setBad(null); return save({ nights: n }, "nights"); }} />
            <TimeInput label="Check in" value={e.checkIn ?? ""} testid="entry-check-in" onCommit={(v) => save({ checkIn: v || null }, "check in")} />
          </div>
        </>}
        {k === "note" && <NoteInput value={e.text ?? ""} onCommit={(v) => { if (!v.trim()) { setBad("A note needs some text. Use × on the plan to remove it."); return false; } setBad(null); return save({ text: v.trim() }, "the note"); }} />}
        {admin && k !== "note" && <EntryMoney entryId={e.id} />}
      </div>
      <EditFoot prefix="entry" status={s.status} error={s.error} bad={bad} onClose={onClose} />
    </div>
  );
}

/** A place: the label of the picked place, or a search; picking saves (or, for a new entry, keeps) it, emptying the box clears it. */
function PlaceField({ label, optional, value, onPick, onClear, testid }: { label: string; optional?: boolean; value: Place | null; onPick(p: Place): void; onClear(): void; testid: string }) {
  return (
    <div className="grid gap-1">
      <span className="lbl">{label}{optional && <i className="font-normal not-italic"> (optional)</i>}</span>
      <AddressAutocomplete value={placeText(value)} testId={testid} placeholder="Search a town or an address" onPick={onPick}
        onChange={(t) => { if (!t.trim() && value) onClear(); }} />
    </div>
  );
}

function TimeInput({ label, value, onCommit, testid }: { label: string; value: string; onCommit(v: string): unknown; testid: string }) {
  const [v, setV] = useState(value);
  return (
    <label className="grid gap-1"><span className="lbl">{label}</span>
      <input className="input" type="time" value={v} onChange={(x) => setV(x.target.value)} onBlur={() => { if (v !== value) void onCommit(v); }} data-testid={testid} />
    </label>
  );
}

function NoteInput({ value, onCommit }: { value: string; onCommit(v: string): boolean | Promise<boolean> }) {
  const [v, setV] = useState(value);
  return (
    <label className="grid gap-1"><span className="lbl">Note</span>
      <textarea className="input" rows={3} value={v} onChange={(x) => setV(x.target.value)} data-testid="entry-text" style={{ paddingTop: 10, paddingBottom: 10 }}
        onBlur={async () => { if (v.trim() !== value.trim() && !(await onCommit(v))) setV(value); }} />
    </label>
  );
}

/** Admins: the money pinned to this entry (tourEntryId). Adding money from here comes with the tour's Money tab. */
function EntryMoney({ entryId }: { entryId: string }) {
  const by = { where: [["tourEntryId", "==", entryId]] as [string, "==", string][] };
  const expenses = useCollection<Expense>("expenses", by).rows ?? [];
  const payouts = useCollection<Payout>("payouts", by).rows ?? [];
  const income = useCollection<Income>("income", by).rows ?? [];
  const lines = [
    ...expenses.map((x) => ({ id: x.id, what: x.what, sub: EXPENSE_LABEL[x.category] ?? x.category, cents: -x.amount })),
    ...payouts.map((x) => ({ id: x.id, what: x.to.name, sub: "Payout", cents: -x.amount })),
    ...income.map((x) => ({ id: x.id, what: x.from, sub: "Money in", cents: x.amount })),
  ];
  return (
    <div className="grid gap-1 border-t border-divider pt-3" data-testid="entry-money">
      <span className="flex items-center gap-2"><b>Money</b><span className="text-[0.75rem] font-bold" style={{ color: "var(--owed-text)" }}>Admins only</span></span>
      {lines.length === 0 && <span className="text-[0.875rem] text-muted">Nothing on this yet.</span>}
      {lines.map((l) => (
        <div key={l.id} className="d-row" data-testid="entry-money-row">
          <span>{l.what}<span className="text-muted"> · {l.sub}</span></span><b>{formatCents(Math.abs(l.cents))}</b>
        </div>
      ))}
    </div>
  );
}
