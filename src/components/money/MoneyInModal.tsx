"use client";
import { useState } from "react";
import { Select, useCommand } from "@/components/ui";
import { INCOME_LABEL, METHOD_LABEL, formatCents, parseDollars } from "@/lib/money";
import { dateInBandZone } from "@/lib/timezone";
import { showName } from "@/lib/shows";
import type { MoneyInModalProps } from "./modals";
import { useDoc, type Row } from "@/lib/firestore-hooks";
import type { Income } from "@/schema";
import type { MoneyDefaults } from "./modals";
import { EditAmount, EditFoot, EditInput, MethodWhenFields, ModalFoot, ModalHead, MoneyDialog, ProjectShowFields, Toggle, TrackField, shortDate, useEditPickers, useEditSave, useProjectsAndShows, useReleaseTracks, withContext } from "./MoneyOutModal";
import { TourFields, useTourPick } from "./TourFields";

const KINDS = Object.entries(INCOME_LABEL) as [string, string][];

/**
 * "Owed to us" / "We got it": one income record (admins only). Opened with a `context` (modals.ts) it hides what the record
 * decides: a show hides Project and Show, a release or track hides Project and Track (a track pins the income to it).
 * With `defaults.edit` it edits one existing income record instead (IncomeEdit): each field autosaves through income.update
 * with only the changed field, and the footer has one Done.
 */
export function MoneyInModal({ open, onClose, defaults }: MoneyInModalProps) {
  return (
    <MoneyDialog open={open} onClose={onClose} testid="money-in-modal" title="Money in">
      {defaults?.edit?.kind === "income" ? <IncomeEdit id={defaults.edit.id} context={defaults.context} onClose={onClose} /> : <InForm onClose={onClose} defaults={defaults} />}
    </MoneyDialog>
  );
}

function InForm({ onClose, defaults: given }: { onClose(): void; defaults?: MoneyInModalProps["defaults"] }) {
  const { call, error, busy } = useCommand();
  const context = given?.context;
  const defaults = withContext(given);
  const ps = useProjectsAndShows(defaults);
  const tr = useReleaseTracks(ps.projectId, defaults);
  const tp = useTourPick(context, undefined, { ps });
  const [got, setGot] = useState(false);
  const [category, setCategory] = useState("guarantee");
  const [from, setFrom] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [when, setWhen] = useState(dateInBandZone());

  const cents = parseDollars(amount);
  const who = from.trim();
  const canSave = !!who && !!cents && cents > 0 && !!ps.projectId && (!got || (!!method && !!when));
  const money = cents ? formatCents(cents) : "$0.00";
  const cat = (INCOME_LABEL[category] ?? category).toLowerCase();
  const saves = got
    ? `Saved as income: ${money} ${category === "door" ? "at the door" : `(${cat})`} from ${who || "someone"}, received (${METHOD_LABEL[method] ?? "how?"}, ${shortDate(when)})`
    : `Saved as income: ${who || "someone"} owes us ${money} (${cat})`;

  async function submit(e: React.FormEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!canSave || !cents) return;
    const r = await call("income.add", {
      amount: cents, category, from: who, projectId: ps.projectId, ...(ps.showId ? { showId: ps.showId } : {}), ...(tr.trackId ? { releaseTrackId: tr.trackId } : {}), ...tp.payload,
      date: got ? when : dateInBandZone(), ...(got ? { method, receivedAt: when } : {}),
    });
    if (r) onClose();
  }

  return (
    <form onSubmit={submit} data-testid="money-in-form">
      <ModalHead title="Money in" sub="Only admins see income" onClose={onClose} testid="mi-close" />
      <div className="grid gap-[16px]" style={{ padding: "18px 22px" }}>
        <Toggle name="mi-status" value={got ? "b" : "a"} a="Owed to us" b="We got it" onChange={(v) => setGot(v === "b")} testidA="mi-owed" testidB="mi-got" />
        <div className="grid gap-[14px] sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="lbl">What kind</span>
            <Select value={category} options={KINDS} onChange={setCategory} testid="mi-cat" />
          </label>
          <label className="grid gap-1">
            <span className="lbl">From</span>
            <input className="input" type="text" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Venue, Bandcamp, a grant" data-testid="mi-from" />
          </label>
        </div>
        <label className="grid gap-1">
          <span className="lbl">Amount</span>
          <input className="input" inputMode="decimal" placeholder="$0.00" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="mi-amount" />
        </label>
        <ProjectShowFields s={ps} prefix="mi" context={context} />
        <TrackField t={tr} prefix="mi" context={context} />
        <TourFields t={tp} prefix="mi" />
        {got && <MethodWhenFields method={method} setMethod={setMethod} when={when} setWhen={setWhen} prefix="mi" />}
      </div>
      <ModalFoot saves={saves} error={error} busy={busy} canSave={canSave} onCancel={onClose} prefix="mi" />
    </form>
  );
}

function IncomeEdit({ id, context, onClose }: { id: string; context?: MoneyDefaults["context"]; onClose(): void }) {
  const { doc } = useDoc<Income>("income", id);
  return doc ? <IncomeEditBody x={doc} context={context} onClose={onClose} /> : <div style={{ padding: 22 }} data-testid="mi-edit-loading">Loading…</div>;
}

function IncomeEditBody({ x, context, onClose }: { x: Row<Income>; context?: MoneyDefaults["context"]; onClose(): void }) {
  const { save, status, error, bad, setBad } = useEditSave("income.update", x.id);
  const { s, t, tp } = useEditPickers(x, context, save);
  return (
    <div data-testid="money-in-edit">
      <ModalHead title="Money in" sub="Changes save as you go" onClose={onClose} testid="mi-close" />
      <div className="grid gap-[16px]" style={{ padding: "18px 22px" }}>
        <div className="grid gap-[14px] sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="lbl">What kind</span>
            <Select value={x.category} options={KINDS} onChange={(category) => void save({ category }, "the kind")} testid="mi-cat" />
          </label>
          <EditInput label="From" value={x.from} testid="mi-from" onCommit={(v) => { if (!v.trim()) { setBad("From can't be empty."); return false; } setBad(null); void save({ from: v.trim() }, "who it is from"); return true; }} />
        </div>
        <EditAmount cents={x.amount} setBad={setBad} testid="mi-amount" onSave={(amount) => void save({ amount }, "the amount")} />
        <ProjectShowFields s={s} prefix="mi" context={context} />
        <TrackField t={t} prefix="mi" context={context} />
        <TourFields t={tp} prefix="mi" />
        {x.receivedAt && (
          <div className="grid gap-[14px] sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="lbl">How</span>
              <select className="select" value={x.method ?? ""} onChange={(e) => { if (e.target.value) void save({ method: e.target.value }, "how"); }} data-testid="mi-method">
                <option value="">Pick one</option>
                {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <EditInput label="When" type="date" value={x.receivedAt} testid="mi-when" onCommit={(v) => { if (!v) return false; void save({ receivedAt: v }, "the date"); return true; }} />
          </div>
        )}
      </div>
      <EditFoot prefix="mi" status={status} error={error} bad={bad} onClose={onClose} />
    </div>
  );
}
