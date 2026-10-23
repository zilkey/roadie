"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { Seg } from "@/components/booking/common";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { todayStr } from "@/lib/booking";
import {
  CATEGORY_LABEL, KIND_LABEL, byCategory, byMonth, byShow, dollarsToCents, formatCents, indexLedger, netOf, owedLines, reversedIds, totals, type LedgerLike,
} from "@/lib/money";
import { fmtLong } from "@/lib/shows";
import { HBars, MonthBars } from "./charts";
import type { Expense, Musician, Show, ShowDeal, User } from "@/schema";

type Tab = "overview" | "shows" | "categories" | "ledger";

export function AdminMoney() {
  const ledger = useCollection<LedgerLike>("ledger");
  const expenses = useCollection<Expense>("expenses");
  const deals = useCollection<ShowDeal>("showDeals");
  const shows = useCollection<Show>("shows");
  const musicians = useCollection<Musician>("musicians");
  const users = useCollection<User>("users");
  const [tab, setTab] = useState<Tab>("overview");
  const { call, error, busy } = useCommand();

  const led = useMemo(() => ledger.rows ?? [], [ledger.rows]);
  const showById = useMemo(() => new Map((shows.rows ?? []).map((s) => [s.id, s])), [shows.rows]);
  const showName = (id: string) => showById.get(id)?.venue.name ?? "Show";
  const person = (userId?: string, musicianId?: string) =>
    users.rows?.find((u) => u.id === userId)?.name ?? musicians.rows?.find((m) => m.id === musicianId || m.userId === userId)?.name ?? "Someone";
  const t = totals(led);
  const owed = owedLines({ expenses: expenses.rows ?? [], ledger: led, deals: deals.rows ?? [], showName });
  const owedBy = new Map<string, { name: string; total: number; lines: typeof owed }>();
  for (const l of owed) {
    const key = l.userId ?? l.musicianId ?? "?";
    const name = l.kind === "expense" ? person(l.userId) : person(undefined, l.musicianId);
    const o = owedBy.get(key) ?? { name, total: 0, lines: [] };
    o.total += l.amount; o.lines.push(l); owedBy.set(key, o);
  }

  return (
    <div className="grid gap-3" data-testid="admin-money">
      <PageTitle title="Money" />
      <Seg<Tab> testid="money-tab" value={tab} onChange={setTab} options={[["overview", "Overview"], ["shows", "By show"], ["categories", "By category"], ["ledger", "Ledger"]]} />
      <ErrorBox error={error} />

      {tab === "overview" && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid content-start gap-3">
            <div className="card" data-testid="money-totals">
              <div className="sum flex justify-between"><span>In</span><span className="font-mono" data-testid="total-in">{formatCents(t.in)}</span></div>
              <div className="sum flex justify-between"><span>Out</span><span className="font-mono" data-testid="total-out">{formatCents(t.out)}</span></div>
              <div className="sum flex justify-between border-t border-line pt-2"><b>Left</b><b className="font-mono" data-testid="total-left">{formatCents(t.left)}</b></div>
            </div>
            <MonthBars data={byMonth(led)} testid="chart-months" />
          </div>
          <div className="grid content-start gap-2" data-testid="owed">
            <span className="lbl">Owed to people</span>
            {owed.length === 0 && <div className="card"><span className="s">Nobody is owed anything.</span></div>}
            {[...owedBy.entries()].map(([key, o]) => (
              <div key={key} className="card" data-testid={`owed-${key}`}>
                <div className="flex justify-between"><b>{o.name}</b><b className="font-mono">{formatCents(o.total)}</b></div>
                {o.lines.map((l) => (
                  <div key={l.key} className="flex items-center justify-between gap-2 text-sm">
                    <span>{l.label} <span className="s">{formatCents(l.amount)}</span></span>
                    {l.kind === "expense"
                      ? <button className="btn sm" disabled={busy} data-testid={`reimburse-${l.expenseId}`} onClick={() => call("expenses.reimburse", { id: l.expenseId })}>Mark reimbursed</button>
                      : <button className="btn sm" disabled={busy} data-testid={`pay-${l.showId}-${l.musicianId}`} onClick={() => call("payouts.pay", { showId: l.showId, musicianId: l.musicianId })}>Mark paid</button>}
                  </div>
                ))}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Link href="/stats" className="btn ghost sm" data-testid="stats-link">Spotify stats</Link>
              <Link href="/money/expense" className="btn ghost sm">Add an expense</Link>
              <button className="btn ghost sm" onClick={() => setTab("ledger")}>Add money in or out</button>
            </div>
          </div>
        </div>
      )}

      {tab === "shows" && (
        <HBars title="Each show's take" testid="chart-shows"
          rows={byShow(led).map((r) => ({ ...r, label: showName(r.key), sub: showById.get(r.key) ? fmtLong(showById.get(r.key)!.date) : undefined }))} />
      )}
      {tab === "categories" && <HBars title="By category" testid="chart-categories" rows={byCategory(led).map((r) => ({ ...r, label: CATEGORY_LABEL[r.key] ?? r.key }))} />}

      {tab === "ledger" && (
        <div className="grid gap-3 md:grid-cols-2">
          <RecordForm shows={shows.rows ?? []} musicians={(musicians.rows ?? []).filter((m) => m.active)} />
          <LedgerList rows={led} showName={showName} person={person} onCorrect={(id) => call("ledger.correct", { reversesId: id })} busy={busy} />
        </div>
      )}
    </div>
  );
}

function LedgerList({ rows, showName, person, onCorrect, busy }: {
  rows: Row<LedgerLike>[]; showName(id: string): string; person(u?: string, m?: string): string; onCorrect(id: string): void; busy: boolean;
}) {
  const by = indexLedger(rows);
  const rev = reversedIds(rows);
  const sorted = [...rows].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  return (
    <div className="grid content-start gap-2" data-testid="ledger-list">
      <span className="lbl">Ledger</span>
      {rows.length === 0 && <div className="card"><span className="s">No entries yet.</span></div>}
      {sorted.map((e) => {
        const n = netOf(e, by);
        return (
          <div key={e.id} className="card" data-testid={`ledger-${e.id}`}>
            <div className="flex items-center justify-between gap-2">
              <b>{CATEGORY_LABEL[e.category] ?? e.category}</b>
              <span className={`font-mono ${rev.has(e.id) ? "line-through opacity-60" : ""}`}>{n >= 0 ? "+" : ""}{formatCents(n)}</span>
            </div>
            <span className="s">
              {fmtLong(e.date)} · {KIND_LABEL[e.kind]}{e.showId ? ` · ${showName(e.showId)}` : ""}{e.payeeUserId || e.payeeMusicianId ? ` · ${person(e.payeeUserId, e.payeeMusicianId)}` : ""}{e.method ? ` · ${e.method}` : ""}{e.memo ? ` · ${e.memo}` : ""}
            </span>
            {rev.has(e.id) && <span className="chip self-start" data-testid={`reversed-${e.id}`}>Corrected</span>}
            {e.kind !== "correction" && !rev.has(e.id) && (
              <button className="btn ghost sm self-start" disabled={busy} data-testid={`correct-${e.id}`}
                onClick={() => { if (confirm("Add a correction that reverses this entry? The original stays in the ledger.")) onCorrect(e.id); }}>Correct…</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RecordForm({ shows, musicians }: { shows: Row<Show>[]; musicians: Row<Musician>[] }) {
  const { call, error, busy } = useCommand();
  const [f, setF] = useState({ kind: "expense", date: todayStr(), amount: "", category: "photo", method: "card", memo: "", showId: "", payee: "" });
  const [ok, setOk] = useState(false);
  const set = (k: keyof typeof f, v: string) => { setOk(false); setF({ ...f, [k]: v }); };
  const cents = f.amount.trim() && !isNaN(Number(f.amount)) ? dollarsToCents(f.amount) : 0;
  async function save() {
    const r = await call("ledger.record", {
      date: f.date, kind: f.kind, amount: cents, category: f.category, method: f.method,
      ...(f.memo.trim() ? { memo: f.memo.trim() } : {}), ...(f.showId ? { showId: f.showId } : {}), ...(f.kind === "payout" && f.payee ? { payeeMusicianId: f.payee } : {}),
    });
    if (r) { setOk(true); setF({ ...f, amount: "", memo: "" }); }
  }
  return (
    <div className="card content-start" data-testid="record-form">
      <span className="lbl">Record</span>
      <span className="s">Photo shoots, video, room rentals, anything else. Entries can't be edited later; fix one with a correction.</span>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1"><span className="lbl">Kind</span>
          <select className="select" value={f.kind} onChange={(e) => set("kind", e.target.value)} data-testid="rec-kind">
            <option value="income">Money in</option><option value="expense">Money out</option><option value="payout">Payout to a person</option>
          </select></label>
        <label className="grid gap-1"><span className="lbl">Date</span><input type="date" className="input" value={f.date} onChange={(e) => set("date", e.target.value)} data-testid="rec-date" /></label>
        <label className="grid gap-1"><span className="lbl">Amount</span><input className="input font-mono" inputMode="decimal" placeholder="$0.00" value={f.amount} onChange={(e) => set("amount", e.target.value)} data-testid="rec-amount" /></label>
        <label className="grid gap-1"><span className="lbl">For</span>
          <select className="select" value={f.category} onChange={(e) => set("category", e.target.value)} data-testid="rec-category">
            {Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></label>
        <label className="grid gap-1"><span className="lbl">Paid by</span>
          <select className="select" value={f.method} onChange={(e) => set("method", e.target.value)} data-testid="rec-method">
            {["cash", "venmo", "check", "card", "bank", "other"].map((m) => <option key={m}>{m}</option>)}
          </select></label>
        <label className="grid gap-1"><span className="lbl">Show</span>
          <select className="select" value={f.showId} onChange={(e) => set("showId", e.target.value)} data-testid="rec-show">
            <option value="">None</option>{shows.map((s) => <option key={s.id} value={s.id}>{s.date} · {s.venue.name}</option>)}
          </select></label>
      </div>
      {f.kind === "payout" && (
        <label className="grid gap-1"><span className="lbl">Paid to</span>
          <select className="select" value={f.payee} onChange={(e) => set("payee", e.target.value)} data-testid="rec-payee">
            <option value="">Pick a person</option>{musicians.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select></label>
      )}
      <input className="input" placeholder="Note (optional)" value={f.memo} onChange={(e) => set("memo", e.target.value)} data-testid="rec-memo" />
      <ErrorBox error={error} />
      {ok && <span className="chip g self-start" data-testid="rec-saved">Recorded</span>}
      <button className="btn acc" disabled={busy || cents <= 0 || (f.kind === "payout" && !f.payee)} onClick={save} data-testid="rec-save">Record</button>
    </div>
  );
}
