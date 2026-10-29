"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorBox, PickChip, useCommand } from "@/components/ui";
import { useCollection, useDocs } from "@/lib/firestore-hooks";
import { EXPENSE_LABEL, METHOD_LABEL, PAYOUT_KIND_LABEL, formatCents, parseDollars } from "@/lib/money";
import { dateInBandZone } from "@/lib/timezone";
import { fmtLong, showName } from "@/lib/shows";
import type { Contact, Expense, Musician, Project, Show, User } from "@/schema";
import type { MoneyOutModalProps } from "./modals";

type Row<T> = T & { id: string };

/** The native <dialog> both money modals sit in: closed unless `open`, and the form inside is keyed on each open so it resets. */
export function MoneyDialog({ open, onClose, testid, title, children }: { open: boolean; onClose(): void; testid: string; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="pitch-dlg" data-testid={testid} aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && children}
    </dialog>
  );
}

export function ModalHead({ title, sub, onClose, testid }: { title: string; sub?: string; onClose(): void; testid: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-divider" style={{ padding: "18px 14px 14px 22px" }}>
      <div className="grid min-w-0 flex-1">
        <h2 className="text-[1.25rem] font-extrabold leading-[1.3]">{title}</h2>
        {sub && <span className="text-[0.875rem] text-muted">{sub}</span>}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" data-testid={testid}
        className="grid shrink-0 place-items-center border-0 bg-transparent text-muted" style={{ width: 44, height: 44, borderRadius: 10 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
}

/** A two-way toggle (We owe / We paid, Owed to us / We got it). */
export function Toggle({ value, a, b, onChange, name, testidA, testidB }: {
  value: "a" | "b"; a: string; b: string; onChange(v: "a" | "b"): void; name: string; testidA: string; testidB: string;
}) {
  return (
    <div className="seg wide" role="radiogroup">
      <label><input type="radio" name={name} checked={value === "a"} onChange={() => onChange("a")} data-testid={testidA} />{a}</label>
      <label><input type="radio" name={name} checked={value === "b"} onChange={() => onChange("b")} data-testid={testidB} />{b}</label>
    </div>
  );
}

/** Shared pickers: open projects and shows (newest first). */
export function useProjectsAndShows(defaults: { projectId?: string; showId?: string } | undefined) {
  const projects = useCollection<Project>("projects");
  const shows = useCollection<Show>("shows");
  const open = useMemo(() => (projects.rows ?? []).filter((p) => p.status !== "closed").sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || a.name.localeCompare(b.name)), [projects.rows]);
  const sortedShows = useMemo(() => [...(shows.rows ?? [])].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")), [shows.rows]);
  const [projectPick, setProjectPick] = useState<string | null>(null);
  const [showId, setShowId] = useState(defaults?.showId ?? "");
  const show = sortedShows.find((s) => s.id === showId);
  // Untouched: the opener's project, else the chosen show's (if still open), else the default project.
  const projectId = projectPick ?? [defaults?.projectId, show?.projectId as string | undefined].find((p) => p && open.some((o) => o.id === p)) ?? open.find((p) => p.isDefault)?.id ?? open[0]?.id ?? "";
  return { open, shows: sortedShows, show, projectId, setProjectPick, showId, setShowId };
}

export function ProjectShowFields({ s, prefix }: { s: ReturnType<typeof useProjectsAndShows>; prefix: string }) {
  return (
    <div className="grid gap-[14px] sm:grid-cols-2">
      <label className="grid gap-1">
        <span className="lbl">Project</span>
        <select className="select" value={s.projectId} onChange={(e) => s.setProjectPick(e.target.value)} data-testid={`${prefix}-project`}>
          {s.open.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="lbl">Show <span className="font-normal">(optional)</span></span>
        <select className="select" value={s.showId} onChange={(e) => s.setShowId(e.target.value)} data-testid={`${prefix}-show`}>
          <option value="">None</option>
          {s.shows.map((x) => <option key={x.id} value={x.id}>{showName(x)} · {fmtLong(x.date)}</option>)}
        </select>
      </label>
    </div>
  );
}

export function MethodWhenFields({ method, setMethod, when, setWhen, prefix }: {
  method: string; setMethod(v: string): void; when: string; setWhen(v: string): void; prefix: string;
}) {
  return (
    <div className="grid gap-[14px] sm:grid-cols-2">
      <label className="grid gap-1">
        <span className="lbl">How</span>
        <select className="select" value={method} onChange={(e) => setMethod(e.target.value)} data-testid={`${prefix}-method`}>
          <option value="">Pick one</option>
          {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="lbl">When</span>
        <input className="input" type="date" value={when} onChange={(e) => setWhen(e.target.value)} data-testid={`${prefix}-when`} />
      </label>
    </div>
  );
}

export const shortDate = (d: string) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

export function ModalFoot({ sentence, saves, error, busy, canSave, onCancel, prefix }: {
  sentence: string; saves: string; error: string | null; busy: boolean; canSave: boolean; onCancel(): void; prefix: string;
}) {
  return (
    <>
      <div className="grid gap-[2px] border-t border-divider" style={{ padding: "14px 22px 0" }}>
        <span className="font-bold" data-testid={`${prefix}-sentence`}>{sentence}</span>
        <span className="text-[0.875rem] text-muted" data-testid={`${prefix}-saves`}>{saves}</span>
      </div>
      <div style={{ padding: "0 22px" }}><ErrorBox error={error} /></div>
      <div className="flex flex-wrap justify-end gap-[10px]" style={{ padding: "14px 22px 20px" }}>
        <button type="button" className="btn ghost" onClick={onCancel} data-testid={`${prefix}-cancel`}>Cancel</button>
        <button type="submit" className="btn acc" disabled={!canSave || busy} data-testid={`${prefix}-save`}>Save</button>
      </div>
    </>
  );
}

type Kind = "back" | "pay" | "split" | "other";
const KINDS: [Kind, string][] = [["back", "Pay back something they bought"], ["pay", PAYOUT_KIND_LABEL.pay], ["split", PAYOUT_KIND_LABEL.split], ["other", PAYOUT_KIND_LABEL.other]];

/** "We owe" / "We paid" someone: a pay-back expense in a bandmate's name, or a payout. Opened with no props but open/onClose, or with defaults from the page. */
export function MoneyOutModal({ open, onClose, defaults }: MoneyOutModalProps) {
  return (
    <MoneyDialog open={open} onClose={onClose} testid="money-out-modal" title="Money out">
      <OutForm onClose={onClose} defaults={defaults} />
    </MoneyDialog>
  );
}

function OutForm({ onClose, defaults }: { onClose(): void; defaults?: MoneyOutModalProps["defaults"] }) {
  const { call, error, busy } = useCommand();
  const users = useCollection<User>("users");
  const musicians = useCollection<Musician>("musicians");
  const contacts = useCollection<Contact>("contacts");
  const ps = useProjectsAndShows(defaults);
  const reimburse = !!defaults?.expenseIds?.length;
  const owed = useDocs<Expense>("expenses", defaults?.expenseIds ?? [], { skip: !reimburse });

  const [paid, setPaid] = useState<boolean>(!!defaults?.paid || reimburse);
  const [kind, setKind] = useState<Kind>(reimburse ? "back" : "back");
  const [whoPick, setWhoPick] = useState<string | null>(null);
  const [otherName, setOtherName] = useState("");
  const [amount, setAmount] = useState("");
  const [what, setWhat] = useState("");
  const [category, setCategory] = useState("other");
  const [method, setMethod] = useState("");
  const [when, setWhen] = useState(dateInBandZone());

  const back = kind === "back";
  const userRows = users.rows ?? [];
  const bandUsers = [...userRows].sort((a, b) => a.name.localeCompare(b.name));
  const playersOnly = (musicians.rows ?? []).filter((m) => !m.userId && !m.archivedAt).sort((a, b) => a.name.localeCompare(b.name));
  const contactRows = [...(contacts.rows ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const musicianUser = (mid?: string) => (musicians.rows ?? []).find((m) => m.id === mid)?.userId;
  const defaultWho = defaults?.userId ? `u:${defaults.userId}` : defaults?.musicianId ? (musicianUser(defaults.musicianId) ? `u:${musicianUser(defaults.musicianId)}` : `m:${defaults.musicianId}`) : "";
  const rawWho = whoPick ?? defaultWho;
  // A pay-back needs a band user: a player, contact or name can't be picked for it.
  const who = back && !rawWho.startsWith("u:") ? "" : rawWho;
  const reimbUser = defaults?.userId ?? owed.rows[0]?.userId ?? "";

  const nameOf = (w: string) => {
    if (w === "other") return otherName.trim();
    const [t, id] = [w.slice(0, 1), w.slice(2)];
    return (t === "u" ? userRows.find((u) => u.id === id)?.name : t === "m" ? (musicians.rows ?? []).find((m) => m.id === id)?.name : contactRows.find((c) => c.id === id)?.name) ?? "";
  };
  const personName = reimburse ? nameOf(`u:${reimbUser}`) : nameOf(who);
  const cents = reimburse ? owed.rows.reduce((n, x) => n + x.amount, 0) : parseDollars(amount);
  const whatText = reimburse ? "" : what.trim();
  const forText = whatText || (ps.show ? `the ${showName(ps.show)} show` : "");

  const hasWho = reimburse ? !!reimbUser : who === "other" ? !!otherName.trim() : !!who && !!personName;
  const canSave = hasWho && !!cents && cents > 0 && !!ps.projectId && (!paid || (!!method && !!when)) && (reimburse ? owed.rows.length > 0 : !back || !!whatText);

  const sentence = `${paid ? "We paid" : "We owe"} ${personName || "someone"} ${cents ? formatCents(cents) : "$0.00"}${forText ? ` for ${forText}` : ""}`;
  const paidBit = paid ? ` (${METHOD_LABEL[method] ?? "how?"}, ${shortDate(when)})` : "";
  const saves = reimburse ? `Saved as a payout that paid back ${owed.rows.length} expense${owed.rows.length === 1 ? "" : "s"}${paidBit}`
    : back ? (paid ? `Saved as an expense in ${personName || "their"}${personName ? "’s" : ""} name, and the payout that paid it back${paidBit}` : `Saved as an expense in ${personName || "their"}${personName ? "’s" : ""} name, to pay back`)
    : paid ? `Saved as a paid payout${paidBit}` : "Saved as a payout, still owed";

  async function submit(e: React.FormEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!canSave || !cents) return;
    const dates = paid ? { method, paidAt: when } : {};
    if (reimburse) {
      if (!(await call("expenses.payPerson", { userId: reimbUser, ids: owed.rows.map((x) => x.id), ...dates }))) return;
    } else if (back) {
      const r = await call<{ id: string }>("expenses.add", {
        userId: who.slice(2), amount: cents, what: whatText, category, projectId: ps.projectId, payBack: true, ...(ps.showId ? { showId: ps.showId } : {}),
      });
      if (!r) return;
      if (paid && !(await call("expenses.payPerson", { userId: who.slice(2), ids: [r.id], ...dates }))) return;
    } else {
      const to = who === "other" ? { name: otherName.trim() } : who.startsWith("u:") ? { userId: who.slice(2) } : who.startsWith("m:") ? { musicianId: who.slice(2) } : { contactId: who.slice(2) };
      if (!(await call("payouts.add", {
        to, kind, amount: cents, projectId: ps.projectId, ...(whatText ? { what: whatText } : {}), ...(ps.showId ? { showId: ps.showId } : {}), ...dates,
      }))) return;
    }
    onClose();
  }

  return (
    <form onSubmit={submit} data-testid="money-out-form">
      <ModalHead title="Money out" onClose={onClose} testid="mo-close" />
      <div className="grid gap-[16px]" style={{ padding: "18px 22px" }}>
        {!reimburse && <Toggle name="mo-status" value={paid ? "b" : "a"} a="We owe" b="We paid" onChange={(v) => setPaid(v === "b")} testidA="mo-owe" testidB="mo-paid" />}
        {!reimburse && (
          <div className="grid gap-1">
            <span className="lbl">What kind</span>
            <div className="flex flex-wrap gap-2">
              {KINDS.map(([k, label]) => <PickChip key={k} on={kind === k} onToggle={() => setKind(k)} testid={`mo-kind-${k === "back" ? "pay-back" : k}`}>{label}</PickChip>)}
            </div>
          </div>
        )}
        {!reimburse && back && (
          <div className="grid gap-1">
            <span className="lbl">Category</span>
            <div className="flex flex-wrap gap-2">
              {Object.entries(EXPENSE_LABEL).map(([c, l]) => <PickChip key={c} on={category === c} onToggle={() => setCategory(c)} testid={`mo-cat-${c}`}>{l}</PickChip>)}
            </div>
          </div>
        )}
        {reimburse ? (
          <div className="grid gap-1" data-testid="mo-expenses">
            <span className="lbl">Paying {personName || "them"} back for</span>
            {owed.rows.map((x) => (
              <div key={x.id} className="flex justify-between gap-3" data-testid={`mo-expense-${x.id}`}><span>{x.what}</span><span className="font-bold">{formatCents(x.amount)}</span></div>
            ))}
          </div>
        ) : (
          <>
            <label className="grid gap-1">
              <span className="lbl">Who</span>
              <select className="select" value={who} onChange={(e) => setWhoPick(e.target.value)} data-testid="mo-who">
                <option value="">Pick someone</option>
                <optgroup label="Band">
                  {bandUsers.map((u) => <option key={u.id} value={`u:${u.id}`}>{u.name}</option>)}
                  {!back && playersOnly.map((m) => <option key={m.id} value={`m:${m.id}`}>{m.name}</option>)}
                </optgroup>
                {!back && contactRows.length > 0 && (
                  <optgroup label="Contacts">{contactRows.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}</optgroup>
                )}
                {!back && <option value="other">Someone else…</option>}
              </select>
            </label>
            {who === "other" && (
              <label className="grid gap-1">
                <span className="lbl">Their name</span>
                <input className="input" type="text" value={otherName} onChange={(e) => setOtherName(e.target.value)} data-testid="mo-name" />
              </label>
            )}
            <div className="grid gap-[14px] sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="lbl">Amount</span>
                <input className="input" inputMode="decimal" placeholder="$0.00" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="mo-amount" />
              </label>
              <label className="grid gap-1">
                <span className="lbl">{back ? "What they bought" : "For"}</span>
                <input className="input" type="text" value={what} onChange={(e) => setWhat(e.target.value)} data-testid="mo-what" />
              </label>
            </div>
          </>
        )}
        <ProjectShowFields s={ps} prefix="mo" />
        {paid && <MethodWhenFields method={method} setMethod={setMethod} when={when} setWhen={setWhen} prefix="mo" />}
      </div>
      <ModalFoot sentence={sentence} saves={saves} error={error} busy={busy} canSave={canSave} onCancel={onClose} prefix="mo" />
    </form>
  );
}
