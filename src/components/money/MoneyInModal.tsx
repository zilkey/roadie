"use client";
import { useState } from "react";
import { PickChip, useCommand } from "@/components/ui";
import { INCOME_LABEL, METHOD_LABEL, formatCents, parseDollars } from "@/lib/money";
import { dateInBandZone } from "@/lib/timezone";
import { showName } from "@/lib/shows";
import type { MoneyInModalProps } from "./modals";
import { MethodWhenFields, ModalFoot, ModalHead, MoneyDialog, ProjectShowFields, Toggle, shortDate, useProjectsAndShows } from "./MoneyOutModal";

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
  const sentence = got
    ? `We got ${money} ${category === "door" ? "at the door" : `(${cat})`} from ${who || "someone"} (${METHOD_LABEL[method]?.toLowerCase() ?? "how?"}, ${shortDate(when)})`
    : `${who || "Someone"} owes us ${money} (${cat})`;
  const saves = got ? `Saved as income, received (${METHOD_LABEL[method] ?? "how?"}, ${shortDate(when)})` : "Saved as income, still owed to us";

  async function submit(e: React.FormEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!canSave || !cents) return;
    const r = await call("income.add", {
      amount: cents, category, from: who, projectId: ps.projectId, ...(ps.showId ? { showId: ps.showId } : {}),
      date: got ? when : dateInBandZone(), ...(got ? { method, receivedAt: when } : {}),
    });
    if (r) onClose();
  }

  return (
    <form onSubmit={submit} data-testid="money-in-form">
      <ModalHead title="Money in" sub="Only admins see income" onClose={onClose} testid="mi-close" />
      <div className="grid gap-[16px]" style={{ padding: "18px 22px" }}>
        <Toggle name="mi-status" value={got ? "b" : "a"} a="Owed to us" b="We got it" onChange={(v) => setGot(v === "b")} testidA="mi-owed" testidB="mi-got" />
        <div className="grid gap-1">
          <span className="lbl">What kind</span>
          <div className="flex flex-wrap gap-2">
            {Object.entries(INCOME_LABEL).map(([c, l]) => <PickChip key={c} on={category === c} onToggle={() => setCategory(c)} testid={`mi-cat-${c}`}>{l}</PickChip>)}
          </div>
        </div>
        <div className="grid gap-[14px] sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="lbl">From</span>
            <input className="input" type="text" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Venue, Bandcamp, a grant" data-testid="mi-from" />
          </label>
          <label className="grid gap-1">
            <span className="lbl">Amount</span>
            <input className="input" inputMode="decimal" placeholder="$0.00" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="mi-amount" />
          </label>
        </div>
        <ProjectShowFields s={ps} prefix="mi" />
        {got && <MethodWhenFields method={method} setMethod={setMethod} when={when} setWhen={setWhen} prefix="mi" />}
      </div>
      <ModalFoot sentence={sentence} saves={saves} error={error} busy={busy} canSave={canSave} onCancel={onClose} prefix="mi" />
    </form>
  );
}
