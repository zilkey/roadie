"use client";
import { useState } from "react";
import { Select, useCommand } from "@/components/ui";
import { INCOME_LABEL, METHOD_LABEL, formatCents, parseDollars } from "@/lib/money";
import { dateInBandZone } from "@/lib/timezone";
import { showName } from "@/lib/shows";
import type { MoneyInModalProps } from "./modals";
import { MethodWhenFields, ModalFoot, ModalHead, MoneyDialog, ProjectShowFields, Toggle, TrackField, shortDate, useProjectsAndShows, useReleaseTracks } from "./MoneyOutModal";

const KINDS = Object.entries(INCOME_LABEL) as [string, string][];

/** "Owed to us" / "We got it": one income record (admins only). */
export function MoneyInModal({ open, onClose, defaults }: MoneyInModalProps) {
  return (
    <MoneyDialog open={open} onClose={onClose} testid="money-in-modal" title="Money in">
      <InForm onClose={onClose} defaults={defaults} />
    </MoneyDialog>
  );
}

function InForm({ onClose, defaults }: { onClose(): void; defaults?: MoneyInModalProps["defaults"] }) {
  const { call, error, busy } = useCommand();
  const ps = useProjectsAndShows(defaults);
  const tr = useReleaseTracks(ps.projectId, defaults);
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
      amount: cents, category, from: who, projectId: ps.projectId, ...(ps.showId ? { showId: ps.showId } : {}), ...(tr.trackId ? { releaseTrackId: tr.trackId } : {}),
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
        <ProjectShowFields s={ps} prefix="mi" />
        <TrackField t={tr} prefix="mi" />
        {got && <MethodWhenFields method={method} setMethod={setMethod} when={when} setWhen={setWhen} prefix="mi" />}
      </div>
      <ModalFoot saves={saves} error={error} busy={busy} canSave={canSave} onCancel={onClose} prefix="mi" />
    </form>
  );
}
