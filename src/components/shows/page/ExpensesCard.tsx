"use client";
import { useRef, useState } from "react";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { useProfile } from "@/lib/auth";
import { useCommand } from "@/components/ui";
import { formatCents, owesBack, parseDollars, sumExpenses } from "@/lib/money";
import { roleIn, type Expense, type User } from "@/schema";
import { useBand, type ShowRow } from "../common";
import { EditableCard, UnfinishedPlaceholder, useCardEdit } from "./kit";

const fileIdOf = (url: string) => /\/d\/([\w-]+)/.exec(url)?.[1] ?? /[?&]id=([\w-]+)/.exec(url)?.[1] ?? url.replace(/\W+/g, "").slice(-24);
const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

interface Line { key: string; id?: string; what: string; amount: string; userId: string; payBack: boolean; link: string; showLink: boolean; receipt?: { driveFileId: string; url: string } }

/** Expenses: members see and add their own, admins see all. Edit = every line the caller can see; Save sends them all. */
export function ExpensesCard({ show, admin }: { show: ShowRow; admin: boolean }) {
  const me = useProfile();
  const { artist } = useBand();
  const { call, error, busy, setError } = useCommand();
  // Members can only read their own expenses (rules), so their query must say so.
  const rows = useCollection<Expense>("expenses", { where: [["showId", "==", show.id], ...(admin ? [] : [["userId", "==", me.uid] as ["userId", "==", string]])] }).rows ?? [];
  const users = useCollection<User>("users", { skip: !admin }).rows ?? [];
  const bandUsers = users.filter((u) => ["admin", "member"].includes(roleIn(u, artist?.id)));
  const nameOfUser = (uid: string) => (!admin ? "You" : users.find((u) => u.id === uid)?.name ?? (uid === me.uid ? "You" : "Someone"));
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const seq = useRef(0);
  const blank = (): Line => ({ key: `n${++seq.current}`, what: "", amount: "", userId: me.uid, payBack: true, link: "", showLink: false });
  const [lines, setLines] = useState<Line[]>([]);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const ed = useCardEdit({
    canEdit: true,
    onStart: () => {
      setError(null); setErrs({});
      const ls = sorted.map((x): Line => ({ key: x.id, id: x.id, what: x.what, amount: formatCents(x.amount).replace("$", "").replace(/,/g, ""), userId: x.userId, payBack: x.payBack !== false, link: "", showLink: false, receipt: x.receipt }));
      setLines(ls.length ? ls : [blank()]);
    },
  });
  const set = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const paidAt = (l: Line) => (l.id ? rows.find((x) => x.id === l.id)?.paidBackAt : undefined);

  const total = lines.reduce((n, l) => n + (parseDollars(l.amount) ?? 0), 0);

  async function save() {
    const e: Record<string, string> = {};
    const out: unknown[] = [];
    for (const l of lines) {
      const locked = !!paidAt(l);
      const empty = !l.id && !l.what.trim() && !l.amount.trim();
      if (empty) continue;
      const cents = parseDollars(l.amount);
      if (!locked && (!cents || cents <= 0)) e[l.key] = "Enter an amount like 12.50";
      else if (!locked && !l.what.trim()) e[l.key] = "Say what it was for";
      const url = l.link.trim();
      const receipt = url ? { driveFileId: fileIdOf(url), url } : l.receipt ?? null;
      const old = l.id ? rows.find((x) => x.id === l.id) : undefined;
      out.push({
        ...(l.id ? { id: l.id } : {}), what: l.what.trim(), amount: locked ? old!.amount : cents,
        ...(admin ? { userId: l.userId } : {}), payBack: l.payBack, receipt,
      });
    }
    setErrs(e);
    if (Object.keys(e).length) return false;
    return !!(await call("shows.setExpenses", { id: show.id, lines: out }));
  }

  async function markPaid(l: Line) {
    if (l.id) await call("expenses.setPaidBack", { id: l.id, paid: true });
  }

  const nobody = rows.length === 0;
  return (
    <EditableCard title="Expenses" testid="expenses" ed={ed} onSave={save} busy={busy} error={error}>
      {ed.editing ? (
        <div className="grid gap-3">
          {lines.map((l, i) => {
            const at = paidAt(l);
            const locked = !!at;
            const owed = !!l.id && !locked && l.payBack;
            return (
              <div key={l.key} className="grid gap-2 rounded-xl p-3" style={{ border: "1px solid var(--line)" }} data-testid={`expense-line-${i}`}>
                <div className="grid items-start gap-2 sm:grid-cols-[minmax(0,1fr)_112px_160px_44px]">
                  <input className="input" aria-label="What" placeholder="What was it?" value={l.what} disabled={locked} onChange={(ev) => set(l.key, { what: ev.target.value })} data-testid="expense-what" />
                  <div className="grid gap-1">
                    <input className="input" aria-label="Amount" inputMode="decimal" placeholder="$0.00" value={l.amount} disabled={locked} aria-invalid={!!errs[l.key]} onChange={(ev) => set(l.key, { amount: ev.target.value })} data-testid="expense-amount" />
                  </div>
                  {admin ? (
                    <select className="select" aria-label="Paid by" value={l.userId} disabled={locked} onChange={(ev) => set(l.key, { userId: ev.target.value })} data-testid="expense-by">
                      {bandUsers.some((u) => u.id === l.userId) || !l.userId ? null : <option value={l.userId}>{nameOfUser(l.userId)}</option>}
                      {bandUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  ) : <span className="s" data-testid="expense-by">You</span>}
                  {locked ? <span /> : <button type="button" className="btn ghost" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} data-testid="expense-remove">×</button>}
                </div>
                {errs[l.key] && <span className="err" role="alert" data-testid="expense-error">{errs[l.key]}</span>}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <label className="flex min-h-[44px] items-center gap-2">
                    <input type="checkbox" checked={l.payBack} disabled={locked} onChange={(ev) => set(l.key, { payBack: ev.target.checked })} data-testid="expense-payback" />Pay back
                  </label>
                  {locked && <span className="pill ok" data-testid="expense-status">Paid back {shortDate(at!)}</span>}
                  {owed && <span className="chip owed" data-testid="expense-status">Owed</span>}
                  {admin && owed && <button type="button" className="btn outline sm" disabled={busy} onClick={() => void markPaid(l)} data-testid="expense-markpaid">Mark paid back</button>}
                  {l.receipt && !l.showLink ? <a href={l.receipt.url} target="_blank" rel="noreferrer" data-testid="expense-receipt">Receipt ↗</a>
                    : locked ? null
                    : l.showLink ? <input className="input" style={{ maxWidth: 320 }} aria-label="Receipt link" placeholder="Paste a Google Drive link" value={l.link} onChange={(ev) => set(l.key, { link: ev.target.value })} data-testid="expense-link" />
                    : <button type="button" className="btn outline sm" onClick={() => set(l.key, { showLink: true })} data-testid="expense-attach">Attach receipt</button>}
                </div>
              </div>
            );
          })}
          <div><button type="button" className="btn ghost" onClick={() => setLines((ls) => [...ls, blank()])} data-testid="expenses-add-line">+ Add expense</button></div>
          <div className="money-row" style={{ fontWeight: 700 }}><span>Total</span><span data-testid="expenses-total">{formatCents(total)}</span></div>
          <span className="s">Band members can add their own expenses; only admins see income and net.</span>
        </div>
      ) : nobody ? (
        <UnfinishedPlaceholder row lead="Nothing spent yet." testid="expenses-empty" actions={<button type="button" className="btn ghost" onClick={ed.start} data-testid="expenses-add">Add expense</button>}>
          Gas, strings, food — anyone in the band can add what they paid for and get paid back.
        </UnfinishedPlaceholder>
      ) : (
        <div className="flex flex-col">
          {sorted.map((x) => (
            <div key={x.id} className="money-row" data-testid="expense-row">
              <span>{x.what} <span className="s">· {nameOfUser(x.userId)}{x.payBack !== false && x.paidBackAt ? " · paid back" : ""}</span>{owesBack(x) && <> <span className="chip owed">Owed</span></>}</span>
              <span>{formatCents(x.amount)}</span>
            </div>
          ))}
          <div className="money-row" style={{ fontWeight: 700 }}><span>Total</span><span data-testid="expenses-total">{formatCents(sumExpenses(sorted))}</span></div>
        </div>
      )}
    </EditableCard>
  );
}
