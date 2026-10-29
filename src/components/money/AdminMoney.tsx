"use client";
import Link from "@/lib/artist";
import { Suspense, useMemo, useState } from "react";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { Tabs } from "@/components/booking/common";
import { useCollection } from "@/lib/firestore-hooks";
import { CATEGORY_LABEL, INCOME_LABEL, METHOD_LABEL, PROJECT_KIND_LABEL, byCategory, byMonth, byShow, defaultProject, formatCents, incomeExpected, incomeSoFar, moneyRows, moneyTotals, owedToUs, projectOf, projectTotals, totals, weOwe } from "@/lib/money";
import { todayStr } from "@/lib/booking";
import { fmtLong, showName as nameOfShow } from "@/lib/shows";
import { HBars, MonthBars } from "./charts";
import { Projects } from "./Projects";
import { InlineValue } from "@/components/InlineValue";
import { StatusChip, UPDATE_COMMAND, ledger, projectOptions } from "./Project";
import { MoneyInModal } from "./MoneyInModal";
import { MoneyOutModal } from "./MoneyOutModal";
import type { MoneyDefaults } from "./modals";
import { WelcomeEmpty } from "@/components/WelcomeEmpty";
import type { Expense, Income, Musician, Payout, Project, Show, User } from "@/schema";

type Tab = "overview" | "projects" | "shows" | "categories";

const shortDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function AdminMoney() { return <Suspense><Admin /></Suspense>; }

function Admin() {
  const income = useCollection<Income>("income");
  const expenses = useCollection<Expense>("expenses");
  const payouts = useCollection<Payout>("payouts");
  const projects = useCollection<Project>("projects");
  const shows = useCollection<Show>("shows");
  const musicians = useCollection<Musician>("musicians");
  const users = useCollection<User>("users");
  const [tab, setTab] = useState<Tab>("overview");
  const [modal, setModal] = useState<{ kind: "in" | "out"; defaults?: MoneyDefaults } | null>(null);
  const { call, error, busy } = useCommand();

  const showById = useMemo(() => new Map((shows.rows ?? []).map((s) => [s.id, s])), [shows.rows]);
  const showName = (id: string) => ((x) => (x ? nameOfShow(x) : "Show"))(showById.get(id));
  const personName = (userId: string) =>
    users.rows?.find((u) => u.id === userId)?.name ?? musicians.rows?.find((m) => m.userId === userId)?.name ?? "Someone";
  // A show that hasn't happened yet is nowhere in Money but the Expected box: its guarantee is dated on the show.
  const today = todayStr();
  const inc = useMemo(() => incomeSoFar(income.rows ?? [], today), [income.rows, today]), exp = expenses.rows ?? [], pay = payouts.rows ?? [];
  const expected = useMemo(() => incomeExpected(income.rows ?? [], today), [income.rows, today]);
  const rows = useMemo(() => moneyRows({ income: inc, expenses: exp, payouts: pay }), [inc, exp, pay]);
  const t = totals(rows);
  const all = moneyTotals({ income: inc, expenses: exp, payouts: pay });
  const def = defaultProject(projects.rows ?? []);
  const projectName = (id?: string) => (projects.rows ?? []).find((p) => p.id === projectOf({ projectId: id }, def?.id))?.name ?? "";

  const owedIn = owedToUs({ income: inc });
  const owe = weOwe({ payouts: pay, expenses: exp, musicianUserId: (mid) => musicians.rows?.find((m) => m.id === mid)?.userId, personName });
  const recent = ledger({ income: inc, expenses: exp, payouts: pay, personName }).filter((l) => l.date).slice(0, 10);
  const markPaid = (target: NonNullable<MoneyDefaults["markPaid"]>) => setModal({ kind: "out", defaults: { markPaid: target } });
  const openProjects = (projects.rows ?? []).filter((p) => p.status !== "closed");

  const loaded = income.rows !== null && expenses.rows !== null && payouts.rows !== null;
  const actions = (
    <>
      <button className="btn acc" data-testid="money-in-open" onClick={() => setModal({ kind: "in" })}>+ Money in</button>
      <button className="btn acc" data-testid="money-out-open" onClick={() => setModal({ kind: "out" })}>+ Money out</button>
      <Link href="/money/expense" className="btn outline" data-testid="add-expense-link">Add an expense</Link>
    </>
  );
  const modals = (
    <>
      <MoneyInModal open={modal?.kind === "in"} onClose={() => setModal(null)} defaults={modal?.defaults} />
      <MoneyOutModal open={modal?.kind === "out"} onClose={() => setModal(null)} defaults={modal?.defaults} />
    </>
  );

  // Nothing in, out or owed yet: only the welcome card, none of the tabs or totals.
  if (loaded && rows.length === 0 && inc.length + exp.length + pay.length === 0) {
    return (
      <>
        <WelcomeEmpty section="money" variant={0} title="Welcome to Money!"
          body="Everything that comes in and goes out: show income, gear and rentals, who's owed what, and the totals broken down by project, show and category. Add money in or out, or an expense, and the numbers start to fill in."
          actions={<>
            <button className="btn acc" data-testid="money-in-open" onClick={() => setModal({ kind: "in" })}>+ Money in</button>
            <button className="btn acc" data-testid="money-out-open" onClick={() => setModal({ kind: "out" })}>+ Money out</button>
            <Link href="/money/expense" className="btn outline" data-testid="add-expense-link">Add an expense</Link>
          </>}>
          <ErrorBox error={error} />
        </WelcomeEmpty>
        {modals}
      </>
    );
  }

  return (
    <div className="grid gap-5" data-testid="admin-money">
      <PageTitle title="Money" actions={actions} />
      <Tabs<Tab> testid="money-tab" value={tab} onChange={setTab} options={[["overview", "Overview"], ["projects", "Projects"], ["shows", "By show"], ["categories", "By category"]]} />
      <ErrorBox error={error} />

      {tab === "overview" && (
        <>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="grid min-w-0 content-start gap-5">
              <div className="card" data-testid="money-totals">
                <div className="sum flex justify-between"><span>In</span><span className="font-mono" data-testid="total-in">{formatCents(t.in)}</span></div>
                <div className="sum flex justify-between"><span>Out</span><span className="font-mono" data-testid="total-out">{formatCents(t.out)}</span></div>
                <div className="sum flex justify-between border-t border-line pt-2"><b>Net</b><b className="font-mono" data-testid="total-left">{formatCents(t.left)}</b></div>
                <div className="sum mt-2 flex justify-between border-t border-line pt-2 text-muted"><span>Owed to us</span><span className="font-mono" data-testid="total-owed-in">{formatCents(all.inOwed)}</span></div>
                <div className="sum flex justify-between text-muted"><span>We owe</span><span className="font-mono" data-testid="total-owed-out">{formatCents(all.weOwe)}</span></div>
                <div className="sum flex justify-between border-t border-line pt-2"><b>Net once everything settles</b><b className="font-mono" data-testid="total-settled">{formatCents(all.netIfSettled)}</b></div>
              </div>
              {expected.items.length > 0 && (
                <div className="card grid gap-1" data-testid="expected-income">
                  <div className="flex justify-between"><span className="lbl">Expected</span><b className="font-mono" data-testid="expected-income-total">{formatCents(expected.total)}</b></div>
                  <span className="s">Booked for {expected.items.length === 1 ? "a show" : `${expected.items.length} shows`} not played yet. Counted nowhere else until the date passes.</span>
                  {expected.items.map((x) => (
                    <div key={x.id} className="s flex justify-between gap-2" data-testid={`expected-income-${x.id}`}>
                      <span className="min-w-0">{x.from} · {shortDate(x.date)}</span><span className="font-mono">{formatCents(x.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              <MonthBars data={byMonth(rows)} testid="chart-months" />
            </div>

            <div className="grid min-w-0 content-start gap-5">
              <div className="card grid gap-2" data-testid="owed-to-us">
                <div className="flex justify-between"><span className="lbl">Owed to us</span>{owedIn.items.length > 0 && <b className="font-mono" data-testid="owed-to-us-total">{formatCents(owedIn.total)}</b>}</div>
                {owedIn.items.length === 0 && <span className="s">Everyone has paid up.</span>}
                {owedIn.items.map((x) => (
                  <div key={x.id} className="flex items-center justify-between gap-2 border-t border-line pt-2" data-testid={`owed-income-${x.id}`}>
                    <div className="min-w-0">
                      <div><b>{x.from}</b> owes the {(INCOME_LABEL[x.category] ?? x.category).toLowerCase()}</div>
                      <div className="s">{[x.showId ? `${shortDate(x.date)} show` : shortDate(x.date), projectName(x.projectId), x.method && METHOD_LABEL[x.method]].filter(Boolean).join(" · ")}</div>
                    </div>
                    <span className="flex shrink-0 items-center gap-2">
                      <b className="font-mono">{formatCents(x.amount)}</b>
                      <button className="btn sm" disabled={busy} data-testid={`owed-received-${x.id}`} onClick={() => call("income.setReceived", { id: x.id })}>Received</button>
                    </span>
                  </div>
                ))}
              </div>

              <div className="card grid gap-3" data-testid="we-owe">
                <div className="flex justify-between"><span className="lbl">We owe</span>{owe.length > 0 && <b className="font-mono" data-testid="we-owe-total">{formatCents(owe.reduce((n, g) => n + g.total, 0))}</b>}</div>
                {owe.length === 0 && <span className="s">Nobody is owed anything.</span>}
                {owe.map((g) => (
                  <div key={g.key} className="grid gap-1 border-t border-line pt-3" data-testid={`we-owe-${g.key}`}>
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <b className="min-w-0">{g.name}</b>
                      <span className="flex items-center gap-3">
                        <b className="font-mono">{formatCents(g.total)}</b>
                        {g.items.some((i) => i.kind === "expense") && (
                          <button className="btn sm" disabled={busy} data-testid={`pay-${g.key}`}
                            onClick={() => setModal({ kind: "out", defaults: { userId: g.userId, musicianId: g.userId ? undefined : g.musicianId, expenseIds: g.items.filter((i) => i.kind === "expense").map((i) => i.id), paid: true } })}>
                            Pay {g.name.split(" ")[0]}
                          </button>
                        )}
                      </span>
                    </div>
                    {g.items.map((i) => (
                      <div key={`${i.kind}-${i.id}`} className="s flex items-center justify-between gap-2">
                        <span className="min-w-0">{[i.what, i.kind === "expense" ? "pay back" : i.kind === "bill" ? "bill" : i.date && `due ${shortDate(i.date)}`, projectName(i.projectId)].filter(Boolean).join(" · ")}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="font-mono">{formatCents(i.amount)}</span>
                          {i.kind !== "expense" && (
                            <button className="btn ghost sm" disabled={busy} data-testid={`mark-paid-${i.kind}-${i.id}`} onClick={() => markPaid({ kind: i.kind === "bill" ? "expense" : "payout", id: i.id })}>Mark paid</button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card grid gap-2">
            <span className="lbl">Recently</span>
            <div className="book-tw" style={{ border: 0 }}>
              <table className="book-table" style={{ minWidth: 560 }} data-testid="recent">
                <tbody>
                  {recent.length === 0 && <tr><td className="s">Nothing yet.</td></tr>}
                  {recent.map((l) => (
                    <tr key={l.key} data-testid={`recent-${l.key}`}>
                      <td className="nw">{shortDate(l.date)}</td>
                      <td><span className="font-bold">{l.showId ? <Link href={`/shows/${l.showId}`} data-testid={`recent-${l.key}-show`}>{l.title} ›</Link> : l.title}</span> <span className="s">· {l.meta}</span></td>
                      <td className="s">
                        <InlineValue testid={`recent-${l.key}-project`} label="Project" kind="select" value={projectOf(l, def?.id) ?? ""} options={projectOptions(projects.rows ?? [], projectOf(l, def?.id))}
                          canEdit={l.editable} error={error} onSave={async (v) => !!(await call(UPDATE_COMMAND[l.kind], { id: l.id, patch: { projectId: v } }))} />
                      </td>
                      <td className="nw text-right font-mono">{l.sign > 0 ? "+" : "−"}{formatCents(l.amount)}</td>
                      <td><StatusChip line={l} canEdit onMarkPaid={markPaid} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-3" data-testid="open-projects">
            <div className="flex items-center justify-between"><span className="lbl">Open projects</span><Link href="/money/projects" className="font-bold" data-testid="all-projects">All projects</Link></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {openProjects.map((p) => {
                const pt = projectTotals({ projectId: p.id, defaultProjectId: def?.id, income: inc, expenses: exp, payouts: pay });
                return (
                  <Link key={p.id} href={`/money/projects/${p.id}`} className="card" data-testid={`open-project-${p.id}`}>
                    <span className="s">{PROJECT_KIND_LABEL[p.kind] ?? p.kind}</span>
                    <b>{p.name}</b>
                    <span className="s font-mono">net {pt.net < 0 ? "" : "+"}{formatCents(pt.net)}{pt.netIfSettled !== pt.net && ` · ${pt.netIfSettled < 0 ? "" : "+"}${formatCents(pt.netIfSettled)} settled`}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}

      {tab === "projects" && <Projects admin />}
      {tab === "shows" && (
        <HBars title="Each show's take" testid="chart-shows"
          rows={byShow(rows).map((r) => ({ ...r, label: showName(r.key), sub: showById.get(r.key) ? fmtLong(showById.get(r.key)!.date) : undefined }))} />
      )}
      {tab === "categories" && <HBars title="By category" testid="chart-categories" rows={byCategory(rows).map((r) => ({ ...r, label: CATEGORY_LABEL[r.key] ?? r.key }))} />}
      {modals}
    </div>
  );
}
