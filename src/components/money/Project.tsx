"use client";
import Link from "@/lib/artist";
import { Suspense, useState } from "react";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { InlineValue } from "@/components/InlineValue";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import { CATEGORY_LABEL, INCOME_LABEL, METHOD_LABEL, PAYOUT_KIND_LABEL, PROJECT_KIND_LABEL, byCategory, defaultProject, formatCents, moneyRows, owesBack, parseDollars, projectOf, projectTotals, weOwe } from "@/lib/money";
import { HBars } from "./charts";
import { BudgetBar, projectWhen } from "./Projects";
import { MoneyInModal } from "./MoneyInModal";
import { MoneyOutModal } from "./MoneyOutModal";
import type { Expense, Income, Musician, Payout, Project as ProjectDoc, User } from "@/schema";

const shortDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One line of the money feed: any income, expense or payout, newest first. */
export interface LedgerLine { key: string; kind: "income" | "expense" | "payout"; date: string; title: string; meta: string; amount: number; sign: 1 | -1; status: string; projectId?: string }

export function ledger(i: { income: readonly Income[]; expenses: readonly Expense[]; payouts: readonly Payout[] }): LedgerLine[] {
  const out: LedgerLine[] = [];
  for (const x of i.income) {
    out.push({
      key: `income-${x.id}`, kind: "income", date: x.date, projectId: x.projectId, amount: x.amount, sign: 1,
      title: x.from, meta: [INCOME_LABEL[x.category] ?? x.category, x.method && METHOD_LABEL[x.method], shortDate(x.date)].filter(Boolean).join(" · "),
      status: x.receivedAt ? "Received" : "Owed to us",
    });
  }
  for (const x of i.expenses) {
    const owed = owesBack(x);
    out.push({
      key: `expense-${x.id}`, kind: "expense", date: x.date, projectId: x.projectId, amount: x.amount, sign: -1,
      title: x.what, meta: [EXP(x.category), shortDate(x.date)].join(" · "), status: owed ? "We owe" : x.paidBackAt ? "Paid back" : "Paid",
    });
  }
  for (const p of i.payouts) {
    const date = p.paidAt ?? p.dueDate ?? "";
    out.push({
      key: `payout-${p.id}`, kind: "payout", date, projectId: p.projectId, amount: p.amount, sign: -1,
      title: `We ${p.paidAt ? "paid" : "owe"} ${p.to.name}${p.what ? ` for ${p.what}` : ""}`,
      meta: [PAYOUT_KIND_LABEL[p.kind] ?? p.kind, p.method && METHOD_LABEL[p.method], p.paidAt ? shortDate(p.paidAt) : p.dueDate ? `due ${shortDate(p.dueDate)}` : ""].filter(Boolean).join(" · "),
      status: p.paidAt ? "Paid" : "We owe",
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.key.localeCompare(b.key)));
}
const EXP = (c: string) => CATEGORY_LABEL[c] ?? c;

export function statusClass(status: string) {
  return status === "Paid" || status === "Paid back" || status === "Received" ? "chip g" : "chip a";
}

export function Project({ id }: { id: string }) { return <Suspense><Page id={id} /></Suspense>; }

function Page({ id }: { id: string }) {
  const { doc: project, loading } = useDoc<ProjectDoc>("projects", id);
  if (loading) return null;
  if (!project) return <div className="empty" data-testid="not-found"><span>That project isn&apos;t here any more.</span> <Link href="/money/projects" className="font-bold">Back to Projects</Link></div>;
  return <View project={project} />;
}

function View({ project }: { project: ProjectDoc & { id: string } }) {
  const projects = useCollection<ProjectDoc>("projects");
  const income = useCollection<Income>("income");
  const expenses = useCollection<Expense>("expenses");
  const payouts = useCollection<Payout>("payouts");
  const users = useCollection<User>("users");
  const musicians = useCollection<Musician>("musicians");
  const { call, error, busy } = useCommand();
  const [modal, setModal] = useState<"in" | "out" | null>(null);

  const def = defaultProject(projects.rows ?? []);
  const mine = <T extends { projectId?: string }>(xs: readonly T[] | null) => (xs ?? []).filter((x) => projectOf(x, def?.id) === project.id);
  const inc = mine(income.rows), exp = mine(expenses.rows), pay = mine(payouts.rows);
  const t = projectTotals({ projectId: project.id, defaultProjectId: def?.id, income: income.rows ?? [], expenses: expenses.rows ?? [], payouts: payouts.rows ?? [] });
  const spent = t.expenses + t.paidOut;
  const personName = (uid: string) => users.rows?.find((u) => u.id === uid)?.name ?? musicians.rows?.find((m) => m.userId === uid)?.name ?? "Someone";
  const owe = weOwe({ payouts: pay, expenses: exp, musicianUserId: (mid) => musicians.rows?.find((m) => m.id === mid)?.userId, personName });
  // The feed is money that actually moved: income only once it was received (what is still owed sits on the In tile and the overview's Owed to us card).
  const lines = ledger({ income: inc.filter((x) => x.receivedAt), expenses: exp, payouts: pay });
  const cats = byCategory(moneyRows({ income: [], expenses: exp, payouts: pay }));
  const closed = project.status === "closed";

  const update = async (patch: Record<string, unknown>) => !!(await call("projects.update", { id: project.id, patch }));
  const defaults = { projectId: project.id };

  return (
    <div className="grid gap-5" data-testid="project-page">
      <PageTitle
        back={<Link href="/money/projects" className="back-link" data-testid="back">‹ Projects</Link>}
        title={<InlineValue testid="project-name" label="Project name" kind="text" value={project.name} canEdit onSave={(v) => update({ name: v })} error={error} validate={(v) => (v ? null : "A project needs a name.")} />}
        sub={<>{PROJECT_KIND_LABEL[project.kind] ?? project.kind}{projectWhen(project) && ` · ${projectWhen(project)}`} · <span data-testid="project-status">{closed ? "closed" : "open"}</span></>}
        actions={
          <>
            <button className="btn acc" disabled={closed} data-testid="money-in-open" onClick={() => setModal("in")}>+ Money in</button>
            <button className="btn acc" disabled={closed} data-testid="money-out-open" onClick={() => setModal("out")}>+ Money out</button>
            <button className="btn outline" disabled={busy} data-testid={closed ? "project-reopen" : "project-close"} onClick={() => call(closed ? "projects.reopen" : "projects.close", { id: project.id })}>{closed ? "Reopen project" : "Close project"}</button>
          </>
        }
      />
      <ErrorBox error={error} />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span className="flex items-center gap-2"><span className="lbl">Starts</span>
          <InlineValue testid="project-start" label="Start date" kind="text" value={project.start ?? ""} emptyLabel="Set" placeholder="YYYY-MM-DD" canEdit error={error}
            validate={(v) => (v && !DATE.test(v) ? "Use YYYY-MM-DD." : null)} onSave={(v) => update({ start: v || null })} /></span>
        <span className="flex items-center gap-2"><span className="lbl">Ends</span>
          <InlineValue testid="project-end" label="End date" kind="text" value={project.end ?? ""} emptyLabel="Set" placeholder="YYYY-MM-DD" canEdit error={error}
            validate={(v) => (v && !DATE.test(v) ? "Use YYYY-MM-DD." : null)} onSave={(v) => update({ end: v || null })} /></span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="project-totals">
        <div className="card" data-testid="tile-spent">
          <span className="lbl">Spent{project.budget ? " of budget" : ""}</span>
          <b className="font-mono text-xl" data-testid="project-spent">{formatCents(spent)}</b>
          {project.budget ? <BudgetBar spent={spent} budget={project.budget} /> : null}
          <span className="s flex items-center gap-1">Budget
            <InlineValue testid="project-budget" label="Budget" kind="text" value={project.budget ? (project.budget / 100).toFixed(2) : ""} display={project.budget ? formatCents(project.budget) : undefined}
              emptyLabel="Set a budget" placeholder="$0.00" inputMode="decimal" canEdit error={error}
              validate={(v) => (v && parseDollars(v) === null ? "Budget should be a dollar amount." : null)}
              onSave={(v) => update({ budget: v ? parseDollars(v) : null })} />
          </span>
        </div>
        <div className="card" data-testid="tile-in">
          <span className="lbl">In so far</span>
          <b className="font-mono text-xl" data-testid="project-in">{formatCents(t.income)}</b>
          <span className="s">{t.owedToUs > 0 ? `${formatCents(t.owedToUs)} owed to us` : "Nothing owed to us"}</span>
        </div>
        <div className="card" data-testid="tile-net">
          <span className="lbl">Net</span>
          <b className="font-mono text-xl" data-testid="project-net">{t.net < 0 ? "" : "+"}{formatCents(t.net)}</b>
          <span className="s">counts owed amounts</span>
        </div>
        <div className="card" data-testid="tile-owe">
          <span className="lbl">We owe</span>
          <b className="font-mono text-xl" data-testid="project-owe">{formatCents(t.weOwe)}</b>
          <span className="s">{owe[0] ? `most to ${owe[0].name}` : "Nobody"}</span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="card grid content-start gap-1" data-testid="project-records">
          <span className="lbl">Everything on this project</span>
          {lines.length === 0 && <span className="s">{t.owedToUs > 0 ? `Nothing has come in or gone out yet. ${formatCents(t.owedToUs)} is still owed to us.` : "Nothing yet. Add money in or out."}</span>}
          {lines.map((l) => (
            <div key={l.key} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0" data-testid={`project-record-${l.key}`}>
              <div className="min-w-0"><div className="truncate font-bold">{l.title}</div><div className="s">{l.meta}</div></div>
              <div className="flex shrink-0 items-center gap-2">
                <b className="font-mono">{l.sign > 0 ? "+" : "−"}{formatCents(l.amount)}</b>
                <span className={statusClass(l.status)}>{l.status}</span>
              </div>
            </div>
          ))}
        </div>
        <HBars title="Spent by category" testid="project-by-category" spent rows={cats.map((r) => ({ ...r, label: CATEGORY_LABEL[r.key] ?? r.key }))} />
      </div>

      <MoneyInModal open={modal === "in"} onClose={() => setModal(null)} defaults={defaults} />
      <MoneyOutModal open={modal === "out"} onClose={() => setModal(null)} defaults={defaults} />
    </div>
  );
}
