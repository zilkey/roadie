"use client";
import { useState } from "react";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import { ErrorBox, useCommand } from "@/components/ui";
import { AdminOnlyBadge, ShowCard, UnfinishedPlaceholder } from "@/components/shows/page/kit";
import { useBand } from "@/components/shows/common";
import { CATEGORY_LABEL, INCOME_LABEL, METHOD_LABEL, PAYOUT_KIND_LABEL, countsAsPaidOut, formatCents, owesBack, parseDollars, showTotals, splitEvenly } from "@/lib/money";
import { useTourEntries } from "@/components/tours/money";
import { tourDayOf } from "@/lib/tours";
import type { Expense, Income, Payout, User } from "@/schema";
import type { ShowDeal } from "@/schema/shows";
import { MoneyInModal } from "./MoneyInModal";
import { MoneyOutModal } from "./MoneyOutModal";
import type { MoneyCardProps, MoneyContext, MoneyDefaults } from "./modals";

/**
 * Money in and Money out, the admin's two money cards on a show (Finances), rehearsal, release (Money) and release
 * track. Members keep their own expenses card. Each lists the records on its context and opens the matching modal
 * (MoneyInModal / MoneyOutModal) with that context.
 *
 * Money in: the income on the context, each with its status; one still owed to us gets a How? select and a Received
 * button. A show also shows its deal terms. A release lists its tracks' lines too, tagged with the track. A tour's lines are
 * tagged with their day and entry ("Tue Mar 9 · Drive Boulder → Fort Collins") or "Whole tour"; its `day` prop narrows both
 * cards to one day's lines (a date), or to the unpinned ones (null), for the Money tab's By day table.
 * Money out: everything going out or owed: expenses (a bandmate's pay-back ones with who paid and whether they are
 * owed back or paid back, open bills as "We owe" with Mark paid), and payouts (paid, or "We owe" with Mark paid).
 * Mark paid opens the modal's mark-paid form. A rehearsal's + Money out starts on Gas (a tour's starts empty). On a show, Split evenly
 * proposes one "pay" payout per player without pay (nothing about the rule is stored).
 * Clicking a line opens its modal in edit mode (defaults.edit): fields autosave, one Done; a paid-back expense is read-only.
 * Every line has Remove (income, payouts, and expenses nobody has paid back yet).
 * Reimbursement payouts are not listed: the expense they paid shows "paid back".
 */

const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const dollars = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
function dealLine(d: ShowDeal | null): string | null {
  if (!d) return null;
  const parts: string[] = [];
  if (d.deal === "doorSplit") parts.push(d.doorSplitPct !== undefined ? `Door split ${d.doorSplitPct} / ${100 - d.doorSplitPct}` : "Door split");
  else parts.push({ guarantee: "Guarantee", flat: "Flat fee", tips: "Tips only", free: "Free show" }[d.deal]);
  if (d.ticketPrice) parts.push(`${dollars(d.ticketPrice)} tickets`);
  if (d.paidAttendance !== undefined) parts.push(`${d.paidAttendance} paid`);
  return parts.join(" · ");
}

/** The Firestore filter that picks the records of a context (a release: its project, so its tracks' lines come too; a tour: its tag, whatever the project). */
function whereOf(c: MoneyContext): [string, "==", string] {
  switch (c.kind) {
    case "show": return ["showId", "==", c.showId];
    case "rehearsal": return ["rehearsalId", "==", c.rehearsalId];
    case "release": return ["projectId", "==", c.projectId];
    case "track": return ["releaseTrackId", "==", c.releaseTrackId];
    case "tour": return ["tourId", "==", c.tourId];
  }
}
const releaseIdOf = (c: MoneyContext) => (c.kind === "release" || c.kind === "track" ? c.releaseId : null);

/**
 * The tag a money line carries: on a release, the track it is pinned to ("3 · Low Light"); on a tour, its entry ("Tue Mar 9 ·
 * Drive Boulder → Fort Collins") or "Whole tour". Also `dayOf`, the date a tour line falls on (null = Whole tour), for the day filter.
 */
function useLineTag(c: MoneyContext) {
  const releaseId = releaseIdOf(c);
  const tracks = useCollection<{ position: string | number; title: string }>(`releases/${releaseId ?? "none"}/tracks`, { skip: !releaseId }).rows ?? [];
  const entries = useTourEntries(c.kind === "tour" ? c.tourId : undefined);
  const dates = new Map([...entries.byId].map(([id, o]) => [id, o.date as string | undefined]));
  // On a track page every line is the track's: no tag.
  const tag = (x: { releaseTrackId?: string; tourEntryId?: string }) => {
    if (c.kind === "tour") return entries.labelOf(x.tourEntryId) ?? "Whole tour";
    if (!x.releaseTrackId || c.kind === "track") return null;
    const t = tracks.find((y) => y.id === x.releaseTrackId);
    return t ? `${t.position} · ${t.title}` : null;
  };
  /** Whether a line is on the day the card is narrowed to (undefined = all of them). */
  const onDay = (x: { tourEntryId?: string }, day: string | null | undefined) => day === undefined || c.kind !== "tour" || tourDayOf(x, dates) === day;
  return { tag, onDay };
}

/** Props that make a money line open its edit modal: a hover style, reachable by keyboard, and ignoring clicks on the buttons and selects inside it. */
function lineProps(testid: string, onOpen: () => void) {
  const inner = (t: EventTarget) => !!(t as HTMLElement).closest?.("button, select, input, a");
  return {
    "data-testid": testid, role: "button" as const, tabIndex: 0, className: "money-row cursor-pointer hover:bg-soft", "aria-label": "Edit",
    onClick: (e: React.MouseEvent) => { if (!inner(e.target)) onOpen(); },
    onKeyDown: (e: React.KeyboardEvent) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); onOpen(); } },
  };
}

/** A small Remove button; asks first. */
function RemoveButton({ testid, onClick, busy }: { testid: string; onClick(): void; busy: boolean }) {
  return <button type="button" className="btn ghost sm" aria-label="Remove" disabled={busy} onClick={() => { if (window.confirm("Remove this?")) onClick(); }} data-testid={testid}>×</button>;
}

/** A show's deal terms ("Guarantee · $20 tickets"), above its income. */
function ShowTerms({ showId }: { showId: string }) {
  const terms = dealLine(useDoc<ShowDeal>("showDeals", showId).doc);
  return terms ? <p className="s mb-2" data-testid="income-terms">{terms}</p> : null;
}

/** Narrows a tour's cards to one day's lines: a date, or null for the lines not pinned to an entry. Undefined shows everything. */
export interface DayFilter { day?: string | null | undefined }

export function MoneyInCard({ context, day }: MoneyCardProps & DayFilter) {
  const rows = useCollection<Income>("income", { where: [whereOf(context)] }).rows;
  const { tag: tagOf, onDay } = useLineTag(context);
  const income = (rows ?? []).filter((x) => onDay(x, day)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const [modal, setModal] = useState<MoneyDefaults | null>(null);
  const [how, setHow] = useState<Record<string, string>>({});
  const { call, busy, error } = useCommand();
  const add = <button type="button" className="btn ghost" onClick={() => setModal({ context })} data-testid="money-in-open">+ Money in</button>;

  return (
    <ShowCard title="Money in" testid="income" badge={<AdminOnlyBadge />} aside={add}>
      {context.kind === "show" && <ShowTerms showId={context.showId} />}
      {rows && income.length === 0 ? (
        <UnfinishedPlaceholder lead="Nothing in yet." testid="income-empty">{day === undefined ? "Add what came in or is owed to the band with + Money in." : "Nothing came in on that day."}</UnfinishedPlaceholder>
      ) : (
        <div>
          {income.map((x) => {
            const tag = tagOf(x);
            return (
              <div key={x.id} {...lineProps(`income-row-${x.id}`, () => setModal({ context, edit: { kind: "income", id: x.id } }))}>
                <span>
                  {[INCOME_LABEL[x.category] ?? x.category, x.method ? METHOD_LABEL[x.method] ?? x.method : null].filter(Boolean).join(" · ")}
                  {(x.from || tag) && <span className="s"> · {[x.from, tag].filter(Boolean).join(" · ")}</span>}
                </span>
                <span className="flex flex-wrap items-center justify-end gap-2">
                  <b>{formatCents(x.amount)}</b>
                  {x.receivedAt ? <span className="pill ok" data-testid={`income-status-${x.id}`}>Received</span> : (
                    <>
                      <span className="chip owed" data-testid={`income-status-${x.id}`}>Owed to us</span>
                      {!x.method && (
                        <select className="select" style={{ width: 96 }} aria-label="How it was paid" value={how[x.id] ?? ""} onChange={(e) => setHow((h) => ({ ...h, [x.id]: e.target.value }))} data-testid={`income-how-${x.id}`}>
                          <option value="">How?</option>
                          {Object.entries(METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      )}
                      <button type="button" className="btn outline sm" disabled={busy} onClick={() => void call("income.setReceived", { id: x.id, ...(!x.method && how[x.id] ? { method: how[x.id] } : {}) })} data-testid={`income-received-${x.id}`}>Received</button>
                    </>
                  )}
                  <RemoveButton testid={`income-remove-${x.id}`} busy={busy} onClick={() => void call("income.remove", { id: x.id })} />
                </span>
              </div>
            );
          })}
        </div>
      )}
      <ErrorBox error={error} />
      <MoneyInModal open={!!modal} onClose={() => setModal(null)} defaults={modal ?? undefined} />
    </ShowCard>
  );
}

interface Proposal { key: string; name: string; to: { musicianId: string } | { userId: string }; amount: string }

export function MoneyOutCard({ context, day, splitEvenly: canSplit }: MoneyCardProps & DayFilter & { /** Shows only: the Split evenly button. */ splitEvenly?: boolean }) {
  const where = [whereOf(context)];
  const expenses = useCollection<Expense>("expenses", { where }).rows;
  const payouts = useCollection<Payout>("payouts", { where }).rows;
  const income = useCollection<Income>("income", { where, skip: context.kind !== "show" }).rows ?? [];
  const users = useCollection<User>("users").rows ?? [];
  const { tag: tagOf, onDay } = useLineTag(context);
  const { shows, musicians } = useBand();
  const show = context.kind === "show" ? shows.find((s) => s.id === context.showId) : undefined;
  const [modal, setModal] = useState<MoneyDefaults | null>(null);
  const [plan, setPlan] = useState<Proposal[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { call, busy, error, setError } = useCommand();

  const nameOfUser = (uid: string) => users.find((u) => u.id === uid)?.name ?? "Someone";
  const lines = [
    ...(expenses ?? []).filter((x) => onDay(x, day)).map((x) => ({ key: `e-${x.id}`, date: x.date, e: x as Expense | undefined, p: undefined as Payout | undefined })),
    ...(payouts ?? []).filter(countsAsPaidOut).filter((p) => onDay(p, day)).map((p) => ({ key: `p-${p.id}`, date: p.paidAt ?? p.dueDate ?? "9", e: undefined as Expense | undefined, p: p as Payout | undefined })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key.localeCompare(b.key)));
  const total = lines.reduce((n, l) => n + (l.e?.amount ?? l.p?.amount ?? 0), 0);
  const loaded = expenses !== null && payouts !== null;

  const projectId = context.projectId;
  function propose() {
    setError(null); setNote(null);
    const have = payouts ?? [];
    const missing = (show?.personnel ?? []).map((id) => musicians.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m)
      .filter((m) => !have.some((p) => p.kind === "pay" && (("musicianId" in p.to && p.to.musicianId === m.id) || (!!m.userId && "userId" in p.to && p.to.userId === m.userId))));
    if (!missing.length) { setNote("Everyone playing already has pay on this show."); setPlan(null); return; }
    const net = showTotals({ income, payouts: have, expenses: expenses ?? [] }).net;
    if (net <= 0) { setNote("Nothing left to split: money in doesn't cover what's already paid out and spent."); setPlan(null); return; }
    const amounts = splitEvenly(net, missing.length);
    setPlan(missing.map((m, i) => ({ key: m.id, name: m.name, to: m.userId ? { userId: m.userId } : { musicianId: m.id }, amount: (amounts[i]! / 100).toFixed(2) })));
  }
  async function addAll() {
    if (!plan || context.kind !== "show") return;
    const parsed = plan.map((r) => parseDollars(r.amount));
    if (parsed.some((c) => !c)) { setError("Enter each amount like 100 or 100.50."); return; }
    for (const [i, r] of plan.entries()) {
      const ok = await call("payouts.add", { to: r.to, kind: "pay", amount: parsed[i], what: "for the show", showId: context.showId, ...(projectId ? { projectId } : {}) });
      if (!ok) return;
    }
    setPlan(null);
  }

  // A rehearsal's money out is mostly gas.
  const openDefaults: MoneyDefaults = { context, ...(context.kind === "rehearsal" ? { category: "gas" } : {}) };
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {canSplit && <button type="button" className="btn ghost" disabled={busy} onClick={propose} data-testid="split-evenly">Split evenly</button>}
      <button type="button" className="btn ghost" onClick={() => setModal(openDefaults)} data-testid="money-out-open">+ Money out</button>
    </div>
  );

  return (
    <ShowCard title="Money out" testid="paid-out" badge={<AdminOnlyBadge />} aside={actions}>
      {loaded && lines.length === 0 && !plan ? (
        <UnfinishedPlaceholder lead="Nothing out yet." testid="paid-out-empty">
          {day === undefined ? <>Add what the band paid or owes with + Money out{canSplit ? ", or split the night" : ""}.</> : "Nothing went out on that day."}
        </UnfinishedPlaceholder>
      ) : (
        <div>
          {lines.map(({ key, e, p }) => {
            if (e) {
              const tag = tagOf(e);
              const bill = e.owed === true;
              return (
                <div key={key} {...lineProps(`expense-row-${e.id}`, () => setModal({ context, edit: { kind: "expense", id: e.id } }))}>
                  <span>
                    {bill ? <>We owe <b>{e.to?.name ?? "someone"}</b> {e.what}</> : <>{e.what}</>}
                    <span className="s"> · {[bill ? null : `${nameOfUser(e.userId)} paid`, CATEGORY_LABEL[e.category] ?? e.category, tag].filter(Boolean).join(" · ")}</span>{" "}
                    {bill ? <span className="chip a" data-testid={`expense-status-${e.id}`}>we owe</span>
                      : e.payBack === false ? <span className="chip" data-testid={`expense-status-${e.id}`}>no pay back</span>
                      : e.paidBackAt ? <span className="chip g" data-testid={`expense-status-${e.id}`}>paid back {shortDate(e.paidBackAt)}</span>
                      : <span className="chip owed" data-testid={`expense-status-${e.id}`}>owed back</span>}
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    <b>{formatCents(e.amount)}</b>
                    {bill && <button type="button" className="btn outline sm" disabled={busy} onClick={() => setModal({ context, markPaid: { kind: "expense", id: e.id } })} data-testid={`expense-mark-paid-${e.id}`}>Mark paid</button>}
                    {owesBack(e) && <button type="button" className="btn outline sm" disabled={busy} onClick={() => void call("expenses.setPaidBack", { id: e.id, paid: true })} data-testid={`expense-paid-back-${e.id}`}>Mark paid back</button>}
                    {!e.paidBackAt && <RemoveButton testid={`expense-remove-${e.id}`} busy={busy} onClick={() => void call("expenses.remove", { id: e.id })} />}
                  </span>
                </div>
              );
            }
            const pay = p!;
            const tag = tagOf(pay);
            return (
              <div key={key} {...lineProps(`payout-row-${pay.id}`, () => setModal({ context, edit: { kind: "payout", id: pay.id } }))}>
                <span>
                  {pay.paidAt ? "We paid" : "We owe"} <b>{pay.to.name}</b> {pay.what ?? (pay.kind === "pay" && context.kind === "show" ? "for the show" : "")}
                  <span className="s"> · {[PAYOUT_KIND_LABEL[pay.kind] ?? pay.kind, pay.paidAt ? [pay.method ? METHOD_LABEL[pay.method] ?? pay.method : null, shortDate(pay.paidAt)].filter(Boolean).join(" · ") : null, tag].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="flex flex-wrap items-center justify-end gap-2">
                  <b>{formatCents(pay.amount)}</b>
                  {pay.paidAt ? <span className="pill ok" data-testid={`payout-status-${pay.id}`}>Paid</span> : (
                    <button type="button" className="btn outline sm" disabled={busy} onClick={() => setModal({ context, markPaid: { kind: "payout", id: pay.id } })} data-testid={`payout-mark-paid-${pay.id}`}>Mark paid</button>
                  )}
                  <RemoveButton testid={`payout-remove-${pay.id}`} busy={busy} onClick={() => void call("payouts.remove", { id: pay.id })} />
                </span>
              </div>
            );
          })}
          {lines.length > 0 && <div className="money-row" style={{ fontWeight: 700 }}><span>Total</span><span data-testid="paid-out-total">{formatCents(total)}</span></div>}
        </div>
      )}
      {note && <p className="s mt-2" data-testid="split-note">{note}</p>}
      {plan && (
        <div className="mt-3 grid gap-2 rounded-xl p-3" style={{ border: "1px solid var(--line)" }} data-testid="split-plan">
          <b>Split what's left evenly</b>
          {plan.map((r) => (
            <div key={r.key} className="money-row" data-testid="split-row">
              <span>We owe <b>{r.name}</b> for the show</span>
              <input className="input" style={{ width: 112 }} inputMode="decimal" aria-label={`Amount for ${r.name}`} value={r.amount}
                onChange={(e) => setPlan((pl) => pl && pl.map((x) => (x.key === r.key ? { ...x, amount: e.target.value } : x)))} data-testid="split-amount" />
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn outline" disabled={busy} onClick={() => { setPlan(null); setError(null); }} data-testid="split-cancel">Cancel</button>
            <button type="button" className="btn acc" disabled={busy} onClick={() => void addAll()} data-testid="split-add">Add payouts</button>
          </div>
        </div>
      )}
      <ErrorBox error={error} />
      <MoneyOutModal open={!!modal} onClose={() => setModal(null)} defaults={modal ?? undefined} />
    </ShowCard>
  );
}
