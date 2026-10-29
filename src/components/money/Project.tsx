"use client";
import Link from "@/lib/artist";
import { Suspense, useState } from "react";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { InlineValue } from "@/components/InlineValue";
import { Menu } from "@/components/Menu";
import { Tabs } from "@/components/booking/common";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import { CATEGORY_LABEL, INCOME_LABEL, METHOD_LABEL, PAYOUT_KIND_LABEL, PROJECT_KIND_LABEL, byCategory, defaultProject, formatCents, moneyRows, owesBack, parseDollars, projectOf, projectTotals, weOwe } from "@/lib/money";
import { HBars } from "./charts";
import { projectWhen } from "./Projects";
import { MoneyInModal } from "./MoneyInModal";
import { MoneyOutModal } from "./MoneyOutModal";
import type { Expense, Income, Musician, Payout, Project as ProjectDoc, User } from "@/schema";

const shortDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One line of the money feed: any income, expense or payout, newest first. `name` is the editable title (who paid us / what
 * was bought); a payout's title is composed, so it has none. `editable` is false once an expense was paid back (the server
 * refuses changes to it).
 */
export interface LedgerLine {
  key: string; id: string; kind: "income" | "expense" | "payout"; date: string; title: string; name?: string; meta: string; amount: number; sign: 1 | -1; status: string; projectId?: string; editable: boolean;
}

export function ledger(i: { income: readonly Income[]; expenses: readonly Expense[]; payouts: readonly Payout[] }): LedgerLine[] {
  const out: LedgerLine[] = [];
  for (const x of i.income) {
    out.push({
      key: `income-${x.id}`, id: x.id, kind: "income", date: x.date, projectId: x.projectId, amount: x.amount, sign: 1, editable: true,
      title: x.from, name: x.from, meta: [INCOME_LABEL[x.category] ?? x.category, x.method && METHOD_LABEL[x.method], shortDate(x.date)].filter(Boolean).join(" · "),
      status: x.receivedAt ? "Received" : "Owed to us",
    });
  }
  for (const x of i.expenses) {
    const owed = owesBack(x);
    out.push({
      key: `expense-${x.id}`, id: x.id, kind: "expense", date: x.date, projectId: x.projectId, amount: x.amount, sign: -1, editable: !x.paidBackAt,
      title: x.what, name: x.what, meta: [EXP(x.category), shortDate(x.date)].join(" · "), status: owed ? "We owe" : x.paidBackAt ? "Paid back" : "Paid",
    });
  }
  for (const p of i.payouts) {
    const date = p.paidAt ?? p.dueDate ?? "";
    out.push({
      key: `payout-${p.id}`, id: p.id, kind: "payout", date, projectId: p.projectId, amount: p.amount, sign: -1, editable: true,
      title: `We ${p.paidAt ? "paid" : "owe"} ${p.to.name}${p.what ? ` for ${p.what}` : ""}`,
      meta: [PAYOUT_KIND_LABEL[p.kind] ?? p.kind, p.method && METHOD_LABEL[p.method], p.paidAt ? shortDate(p.paidAt) : p.dueDate ? `due ${shortDate(p.dueDate)}` : ""].filter(Boolean).join(" · "),
      status: p.paidAt ? "Paid" : "We owe",
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.key.localeCompare(b.key)));
}
const EXP = (c: string) => CATEGORY_LABEL[c] ?? c;

/** Money that came in is green; money that went out is yellow; what is still owed either way is the accent chip. */
export function statusClass(status: string) {
  return status === "Received" ? "chip g" : status === "Paid" || status === "Paid back" ? "chip y" : "chip a";
}

/** The command that fixes a line of each kind; every one takes { id, patch }. */
export const UPDATE_COMMAND: Record<LedgerLine["kind"], string> = { income: "income.update", expense: "expenses.update", payout: "payouts.update" };
const NAME_FIELD: Record<LedgerLine["kind"], string> = { income: "from", expense: "what", payout: "what" };

/** Open projects as select options, plus the line's own project when it is closed (so the select can still show it). */
export function projectOptions(projects: readonly ProjectDoc[], current: string | undefined): [string, string][] {
  return projects.filter((p) => !p.deletedAt && (p.status !== "closed" || p.id === current)).map((p) => [p.id, p.name]);
}

export function Project({ id }: { id: string }) { return <Suspense><Page id={id} /></Suspense>; }

function Page({ id }: { id: string }) {
  const { doc: project, loading } = useDoc<ProjectDoc>("projects", id);
  if (loading) return null;
  if (!project) return <div className="empty" data-testid="not-found"><span>That project isn&apos;t here any more.</span> <Link href="/money/projects" className="font-bold">Back to Projects</Link></div>;
  return <View project={project} />;
}

type Flow = "in" | "out";

function View({ project }: { project: ProjectDoc & { id: string } }) {
  const projects = useCollection<ProjectDoc>("projects");
  const income = useCollection<Income>("income");
  const expenses = useCollection<Expense>("expenses");
  const payouts = useCollection<Payout>("payouts");
  const users = useCollection<User>("users");
  const musicians = useCollection<Musician>("musicians");
  const { call, error, busy } = useCommand();
  const [modal, setModal] = useState<"in" | "out" | null>(null);
  const [flow, setFlow] = useState<Flow>("in");

  const def = defaultProject(projects.rows ?? []);
  const mine = <T extends { projectId?: string }>(xs: readonly T[] | null) => (xs ?? []).filter((x) => projectOf(x, def?.id) === project.id);
  const inc = mine(income.rows), exp = mine(expenses.rows), pay = mine(payouts.rows);
  const t = projectTotals({ projectId: project.id, defaultProjectId: def?.id, income: income.rows ?? [], expenses: expenses.rows ?? [], payouts: payouts.rows ?? [] });
  const spent = t.expenses + t.paidOut;
  const personName = (uid: string) => users.rows?.find((u) => u.id === uid)?.name ?? musicians.rows?.find((m) => m.userId === uid)?.name ?? "Someone";
  const owe = weOwe({ payouts: pay, expenses: exp, musicianUserId: (mid) => musicians.rows?.find((m) => m.id === mid)?.userId, personName });
  const lines = flow === "in" ? ledger({ income: inc, expenses: [], payouts: [] }) : ledger({ income: [], expenses: exp, payouts: pay });
  const cats = byCategory(moneyRows({ income: [], expenses: exp, payouts: pay }));
  const closed = project.status === "closed";

  const update = async (patch: Record<string, unknown>) => !!(await call("projects.update", { id: project.id, patch }));
  const fix = async (l: LedgerLine, patch: Record<string, unknown>) => !!(await call(UPDATE_COMMAND[l.kind], { id: l.id, patch }));
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
            <Menu label="More actions" testid="project" items={[
              closed
                ? { key: "reopen", label: "Reopen project", testid: "project-reopen", disabled: busy, onSelect: () => void call("projects.reopen", { id: project.id }) }
                : { key: "close", label: "Close project", testid: "project-close", danger: true, disabled: busy, onSelect: () => void call("projects.close", { id: project.id }) },
            ]} />
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
          <span className="lbl">Spent</span>
          <b className="font-mono text-xl" data-testid="project-spent">{formatCents(spent)}</b>
          <span className="s">expenses and payouts</span>
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
          <Tabs<Flow> testid="project-flow" value={flow} onChange={setFlow} options={[["in", "Money in"], ["out", "Money out"]]} />
          {lines.length === 0 && <span className="s">{flow === "in" ? "Nothing has come in yet." : "Nothing has gone out yet."}</span>}
          {lines.map((l) => {
            const canEdit = !closed && l.editable;
            const cur = projectOf(l, def?.id) ?? "";
            return (
              <div key={l.key} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0" data-testid={`project-record-${l.key}`}>
                <div className="min-w-0">
                  <div className="font-bold">
                    {l.name !== undefined
                      ? <InlineValue testid={`${l.key}-name`} label={l.kind === "income" ? "From" : "What"} kind="text" value={l.name} canEdit={canEdit} error={error}
                          validate={(v) => (v.trim() ? null : "Needs a name.")} onSave={(v) => fix(l, { [NAME_FIELD[l.kind]]: v.trim() })} />
                      : l.title}
                  </div>
                  <div className="s flex flex-wrap items-center gap-x-1">
                    <span>{l.meta} ·</span>
                    <InlineValue testid={`${l.key}-project`} label="Project" kind="select" value={cur} options={projectOptions(projects.rows ?? [], cur)} canEdit={canEdit} error={error}
                      onSave={(v) => fix(l, { projectId: v })} />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <InlineValue testid={`${l.key}-amount`} label="Amount" kind="text" value={(l.amount / 100).toFixed(2)} display={`${l.sign > 0 ? "+" : "−"}${formatCents(l.amount)}`}
                    inputMode="decimal" className="font-mono font-bold" canEdit={canEdit} error={error}
                    validate={(v) => ((parseDollars(v) ?? 0) > 0 ? null : "Needs a dollar amount.")} onSave={(v) => fix(l, { amount: parseDollars(v) })} />
                  <span className={statusClass(l.status)}>{l.status}</span>
                </div>
              </div>
            );
          })}
        </div>
        <HBars title="Spent by category" testid="project-by-category" spent rows={cats.map((r) => ({ ...r, label: CATEGORY_LABEL[r.key] ?? r.key }))} />
      </div>

      <MoneyInModal open={modal === "in"} onClose={() => setModal(null)} defaults={defaults} />
      <MoneyOutModal open={modal === "out"} onClose={() => setModal(null)} defaults={defaults} />
    </div>
  );
}
