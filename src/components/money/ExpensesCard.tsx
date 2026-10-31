"use client";
import { useState } from "react";
import { useCollection } from "@/lib/firestore-hooks";
import { useProfile } from "@/lib/auth";
import { useCommand } from "@/components/ui";
import { CATEGORY_LABEL, defaultProject, formatCents, owesBack, parseDollars, projectOf, sumExpenses } from "@/lib/money";
import { roleIn, type Expense, type Project, type User } from "@/schema";
import Link, { useArtist } from "@/lib/artist";
import { EditableCard, UnfinishedPlaceholder, useCardEdit } from "@/components/shows/page/kit";

const fileIdOf = (url: string) => /\/d\/([\w-]+)/.exec(url)?.[1] ?? /[?&]id=([\w-]+)/.exec(url)?.[1] ?? url.replace(/\W+/g, "").slice(-24);
const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

interface Line { key: string; id?: string; what: string; amount: string; userId: string; payBack: boolean; link: string; showLink: boolean; receipt?: { driveFileId: string; url: string } }

/** What a gas row (logged through /money/expense) shows: its frozen estimate. Other rows show nothing extra. */
function gasDetail(x: Expense): string | null {
  const g = x.gas;
  if (!g) return null;
  return `${g.miles.toFixed(1)} mi ${g.roundTrip ? "round trip" : "one way"} · ${g.mpg} MPG · $${(g.priceMilli / 1000).toFixed(2)}/gal`;
}

export type ExpenseTarget = { kind: "show" | "rehearsal"; id: string };

/**
 * Expenses on a show or a rehearsal, one component for both: members see and add their own, admins see all.
 * Adding always goes through the full form at /money/expense; Edit fixes the lines the caller can see and
 * Save sends them all through `shows.setExpenses` / `rehearsals.setExpenses`.
 */
export function ExpensesCardFor({ target, admin }: { target: ExpenseTarget; admin: boolean }) {
  const me = useProfile();
  const { doc: artist } = useArtist();
  const field = target.kind === "show" ? "showId" : "rehearsalId";
  const { call, error, busy, setError } = useCommand();
  // Members can only read their own expenses (rules), so their query must say so.
  const rows = useCollection<Expense>("expenses", { where: [[field, "==", target.id], ...(admin ? [] : [["userId", "==", me.uid] as ["userId", "==", string]])] }).rows ?? [];
  const users = useCollection<User>("users", { skip: !admin }).rows ?? [];
  const projects = useCollection<Project>("projects").rows ?? [];
  const defaultId = defaultProject(projects)?.id;
  const projectName = (x: Expense) => projects.find((p) => p.id === projectOf(x, defaultId))?.name;
  const bandUsers = users.filter((u) => ["admin", "member"].includes(roleIn(u, artist?.id)));
  const nameOfUser = (uid: string) => (!admin ? "You" : users.find((u) => u.id === uid)?.name ?? (uid === me.uid ? "You" : "Someone"));
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const [lines, setLines] = useState<Line[]>([]);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const ed = useCardEdit({
    canEdit: rows.length > 0,
    onStart: () => {
      setError(null); setErrs({});
      const ls = sorted.map((x): Line => ({ key: x.id, id: x.id, what: x.what, amount: formatCents(x.amount).replace("$", "").replace(/,/g, ""), userId: x.userId, payBack: x.payBack !== false, link: "", showLink: false, receipt: x.receipt }));
      setLines(ls);
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
    return !!(await call(`${target.kind}s.setExpenses`, { id: target.id, lines: out }));
  }

  async function markPaid(l: Line) {
    if (l.id) await call("expenses.setPaidBack", { id: l.id, paid: true });
  }

  const nobody = rows.length === 0;
  // The full form (category, gas estimate, logging for a bandmate), filed under this show or rehearsal.
  const fullForm = <Link href={`/money/expense?${target.kind === "show" ? "show" : "rehearsalId"}=${encodeURIComponent(target.id)}`} className="btn ghost" data-testid="expenses-full-form">+ Add expense</Link>;
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
                  {locked && <span className="pill ok" data-testid="expense-status">paid back {shortDate(at!)}</span>}
                  {owed && <span className="chip owed" data-testid="expense-status">waiting</span>}
                  {admin && owed && <button type="button" className="btn outline sm" disabled={busy} onClick={() => void markPaid(l)} data-testid="expense-markpaid">Mark paid back</button>}
                  {l.receipt && !l.showLink ? <a href={l.receipt.url} target="_blank" rel="noreferrer" data-testid="expense-receipt">Receipt ↗</a>
                    : locked ? null
                    : l.showLink ? <input className="input" style={{ maxWidth: 320 }} aria-label="Receipt link" placeholder="Paste a Google Drive link" value={l.link} onChange={(ev) => set(l.key, { link: ev.target.value })} data-testid="expense-link" />
                    : <button type="button" className="btn outline sm" onClick={() => set(l.key, { showLink: true })} data-testid="expense-attach">Attach receipt</button>}
                </div>
              </div>
            );
          })}
          <div className="money-row" style={{ fontWeight: 700 }}><span>Total</span><span data-testid="expenses-total">{formatCents(total)}</span></div>
          <span className="s">Band members can add their own expenses; only admins see income and net.</span>
        </div>
      ) : nobody ? (
        <UnfinishedPlaceholder row lead="Nothing spent yet." testid="expenses-empty" actions={fullForm}>
          Gas, strings, food — anyone in the band can add what they paid for and get paid back.
        </UnfinishedPlaceholder>
      ) : (
        <div className="flex flex-col">
          {sorted.map((x) => (
            <div key={x.id} className="money-row" data-testid="expense-row">
              <span>{x.what} <span className="s">· {[x.to?.name, projectName(x), x.owed ? "nobody has paid yet" : nameOfUser(x.userId), CATEGORY_LABEL[x.category], gasDetail(x)].filter(Boolean).join(" · ")}</span>{" "}
                {x.owed ? <span className="chip a" data-testid="expense-status">we owe</span>
                  : x.payBack === false ? <span className="chip" data-testid="expense-status">no pay back</span>
                  : x.paidBackAt ? <span className="chip g" data-testid="expense-status">paid back {shortDate(x.paidBackAt)}</span>
                  : owesBack(x) ? <span className="chip owed" data-testid="expense-status">waiting</span> : null}
                {x.notes && <span className="s block" data-testid="expense-notes">{x.notes}</span>}</span>
              <span>{formatCents(x.amount)}</span>
            </div>
          ))}
          <div className="money-row" style={{ fontWeight: 700 }}><span>Total</span><span data-testid="expenses-total">{formatCents(sumExpenses(sorted))}</span></div>
          <div className="pt-2">{fullForm}</div>
        </div>
      )}
    </EditableCard>
  );
}
