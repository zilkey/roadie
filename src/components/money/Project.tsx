"use client";
import Link, { useArtistRouter } from "@/lib/artist";
import { Suspense, useState } from "react";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { InlineValue } from "@/components/InlineValue";
import { Menu } from "@/components/Menu";
import { Tabs } from "@/components/booking/common";
import { todayStr } from "@/lib/booking";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import { CATEGORY_LABEL, INCOME_LABEL, METHOD_LABEL, PAYOUT_KIND_LABEL, PROJECT_KIND_LABEL, byCategory, byPayer, countsAsPaidOut, defaultProject, formatCents, incomeSoFar, isOwedBill, moneyRows, owesBack, parseDollars, projectOf, projectTotals, weOwe } from "@/lib/money";
import { HBars } from "./charts";
import { MoneyInModal } from "./MoneyInModal";
import { MoneyOutModal } from "./MoneyOutModal";
import type { MoneyDefaults } from "./modals";
import type { Release, Expense, Income, Musician, Payout, Project as ProjectDoc, User } from "@/schema";

const shortDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * One line of the money feed: any income, expense or payout, newest first. `name` is the editable title (who paid us / what
 * was bought); a payout's title is its person, so it has none. `editable` is false once an expense was paid back (the server
 * refuses changes to it). A line with a `showId` came from a show (a booked guarantee, a show's expense): its title links
 * there instead of editing in place, since the show page owns it. A line still owed carries `markPaid`, what the Mark paid
 * form needs. A reimbursement payout is never a line: it is folded into the expense it paid back ("Ingrid paid Jeff back").
 */
export interface LedgerLine {
  key: string; id: string; kind: "income" | "expense" | "payout"; date: string; title: string; name?: string; meta: string; amount: number; sign: 1 | -1; status: string; projectId?: string; showId?: string; editable: boolean;
  markPaid?: MoneyDefaults["markPaid"];
}

/** `personName(uid)` names payers (expenses carry a userId, payouts a paidBy); without it the line just says "paid". */
export function ledger(i: { income: readonly Income[]; expenses: readonly Expense[]; payouts: readonly Payout[]; personName?(uid: string): string }): LedgerLine[] {
  const out: LedgerLine[] = [];
  const who = (uid: string | undefined) => (uid && i.personName ? i.personName(uid) : "");
  const paidBy = (uid: string | undefined) => (who(uid) ? `paid by ${who(uid)}` : "");
  const reimb = new Map((i.payouts.filter((p) => p.kind === "reimbursement")).map((p) => [p.id, p]));
  for (const x of i.income) {
    out.push({
      key: `income-${x.id}`, id: x.id, kind: "income", date: x.date, projectId: x.projectId, showId: x.showId, amount: x.amount, sign: 1, editable: true,
      title: x.from, name: x.from, meta: [INCOME_LABEL[x.category] ?? x.category, x.method && METHOD_LABEL[x.method], shortDate(x.date)].filter(Boolean).join(" · "),
      status: x.receivedAt ? "Received" : "Owed to us",
    });
  }
  for (const x of i.expenses) {
    const bill = isOwedBill(x);
    // What happened to the pay-back: who paid the member back and when, or that they are still waiting.
    const back = bill || x.payBack === false ? "" : x.paidBackAt ? `${who(x.paidBackBy ?? reimb.get(x.reimbursedBy ?? "")?.paidBy) || "the band"} paid ${who(x.userId) || "them"} back ${shortDate(x.paidBackAt)}` : `${who(x.userId) || "they"} ${who(x.userId) ? "is" : "are"} owed back`;
    out.push({
      key: `expense-${x.id}`, id: x.id, kind: "expense", date: x.date, projectId: x.projectId, showId: x.showId, amount: x.amount, sign: -1, editable: !x.paidBackAt,
      title: x.what, name: x.what, meta: [x.to?.name, EXP(x.category), shortDate(x.date), bill ? "" : paidBy(x.userId), back].filter(Boolean).join(" · "),
      status: bill ? "We owe" : "Paid", ...(bill ? { markPaid: { kind: "expense" as const, id: x.id } } : {}),
    });
  }
  for (const p of i.payouts.filter(countsAsPaidOut)) {
    const date = p.paidAt ?? p.dueDate ?? "";
    out.push({
      key: `payout-${p.id}`, id: p.id, kind: "payout", date, projectId: p.projectId, showId: p.showId, amount: p.amount, sign: -1, editable: true,
      title: p.to.name,
      meta: [PAYOUT_KIND_LABEL[p.kind] ?? p.kind, p.what, p.method && METHOD_LABEL[p.method], p.paidAt ? shortDate(p.paidAt) : p.dueDate ? `due ${shortDate(p.dueDate)}` : "", p.paidAt ? paidBy(p.paidBy) : ""].filter(Boolean).join(" · "),
      status: p.paidAt ? "Paid" : "We owe", ...(p.paidAt ? {} : { markPaid: { kind: "payout" as const, id: p.id } }),
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

/** The status chip on a ledger line: a button that opens Mark paid while the line is still owed and may be settled. */
export function StatusChip({ line, canEdit, onMarkPaid }: { line: LedgerLine; canEdit: boolean; onMarkPaid(target: NonNullable<MoneyDefaults["markPaid"]>): void }) {
  if (line.markPaid && canEdit) {
    const t = line.markPaid;
    return <button type="button" className={statusClass(line.status)} title="Mark paid" data-testid={`${line.key}-mark-paid`} onClick={() => onMarkPaid(t)}>{line.status} ›</button>;
  }
  return <span className={statusClass(line.status)}>{line.status}</span>;
}

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
  const releases = useCollection<Release>("releases", { where: [["projectId", "==", project.id]] });
  const release = releases.rows?.[0];
  const { call, error, busy } = useCommand();
  const [modal, setModal] = useState<{ kind: "in" | "out"; defaults?: MoneyDefaults } | null>(null);
  const [flow, setFlow] = useState<Flow>("in");

  const def = defaultProject(projects.rows ?? []);
  const mine = <T extends { projectId?: string }>(xs: readonly T[] | null) => (xs ?? []).filter((x) => projectOf(x, def?.id) === project.id);
  // A show that hasn't happened yet stays out of Money in and the tiles: its guarantee is dated on the show.
  const inc = incomeSoFar(mine(income.rows), todayStr()), exp = mine(expenses.rows), pay = mine(payouts.rows);
  const t = projectTotals({ projectId: project.id, defaultProjectId: def?.id, income: inc, expenses: exp, payouts: pay });
  const personName = (uid: string) => users.rows?.find((u) => u.id === uid)?.name ?? musicians.rows?.find((m) => m.userId === uid)?.name ?? "Someone";
  const owe = weOwe({ payouts: pay, expenses: exp, musicianUserId: (mid) => musicians.rows?.find((m) => m.id === mid)?.userId, personName });
  const lines = flow === "in" ? ledger({ income: inc, expenses: [], payouts: [] }) : ledger({ income: [], expenses: exp, payouts: pay, personName });
  const rows = moneyRows({ income: [], expenses: exp, payouts: pay });
  const cats = byCategory(rows);
  const payers = byPayer(rows);
  const closed = project.status === "closed";
  const router = useArtistRouter();
  // Delete is only for a project with nothing on it; the default project is deleted by making another the default first.
  const hasRecords = (income.rows ?? []).some((x) => x.projectId === project.id) || exp.length > 0 || pay.length > 0;
  const loadedAll = income.rows !== null && expenses.rows !== null && payouts.rows !== null && releases.rows !== null;
  const cantDelete = !loadedAll ? "Loading…" : project.isDefault ? "This is the default project: make another the default first" : hasRecords ? "It has money on it: close it instead" : release ? "A release is on it" : undefined;
  async function remove() {
    if (!window.confirm(`Delete the project ${project.name}? Nothing is on it.`)) return;
    if (await call("projects.remove", { id: project.id })) router.push("/money/projects");
  }

  const update = async (patch: Record<string, unknown>) => !!(await call("projects.update", { id: project.id, patch }));
  const fix = async (l: LedgerLine, patch: Record<string, unknown>) => !!(await call(UPDATE_COMMAND[l.kind], { id: l.id, patch }));
  const defaults = { projectId: project.id };
  const markPaid = (target: NonNullable<MoneyDefaults["markPaid"]>) => setModal({ kind: "out", defaults: { ...defaults, markPaid: target } });

  return (
    <div className="grid gap-5" data-testid="project-page">
      <PageTitle
        back={<Link href="/money/projects" className="back-link" data-testid="back">‹ Projects</Link>}
        title={<InlineValue testid="project-name" label="Project name" kind="text" value={project.name} canEdit onSave={(v) => update({ name: v })} error={error} validate={(v) => (v ? null : "A project needs a name.")} />}
        sub={<>{PROJECT_KIND_LABEL[project.kind] ?? project.kind} · <span data-testid="project-status">{closed ? "closed" : "open"}</span>{release && <> · <Link href={`/releases/${release.id}`} className="font-semibold" data-testid="project-release-link">Open release</Link></>}</>}
        actions={
          <>
            <button className="btn acc" disabled={closed} data-testid="money-in-open" onClick={() => setModal({ kind: "in" })}>+ Money in</button>
            <button className="btn acc" disabled={closed} data-testid="money-out-open" onClick={() => setModal({ kind: "out" })}>+ Money out</button>
            <Menu label="More actions" testid="project" items={[
              { key: "default", label: project.isDefault ? "This is the default project" : "Make default", testid: "project-make-default", disabled: busy || closed || !!project.isDefault, hint: closed ? "Reopen it first" : undefined, onSelect: () => void update({ isDefault: true }) },
              closed
                ? { key: "reopen", label: "Reopen project", testid: "project-reopen", disabled: busy, onSelect: () => void call("projects.reopen", { id: project.id }) }
                : { key: "close", label: "Close project", testid: "project-close", danger: true, disabled: busy, onSelect: () => void call("projects.close", { id: project.id }) },
              { key: "remove", label: "Delete project", testid: "project-remove", danger: true, disabled: busy || !!cantDelete, hint: cantDelete, onSelect: () => void remove() },
            ]} />
          </>
        }
      />
      <ErrorBox error={error} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="project-totals">
        <div className="card" data-testid="tile-in">
          <span className="lbl">In</span>
          <b className="font-mono text-xl" data-testid="project-in">{formatCents(t.inReceived)}</b>
          <span className="s">{t.inOwed > 0 ? `${formatCents(t.inOwed)} owed to us` : "Nothing owed to us"}</span>
        </div>
        <div className="card" data-testid="tile-spent">
          <span className="lbl">Out</span>
          <b className="font-mono text-xl" data-testid="project-spent">{formatCents(t.outPaid)}</b>
          <span className="s">{t.outOwed > 0 ? `${formatCents(t.outOwed)} still owed` : "Nothing still owed"}</span>
        </div>
        <div className="card" data-testid="tile-net">
          <span className="lbl">Net</span>
          <b className="font-mono text-xl" data-testid="project-net">{t.net < 0 ? "" : "+"}{formatCents(t.net)}</b>
          <span className="s" data-testid="project-net-settled">{t.netIfSettled === t.net ? "nothing owed either way" : `${t.netIfSettled < 0 ? "" : "+"}${formatCents(t.netIfSettled)} once everything settles`}</span>
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
                    {l.showId
                      ? <Link href={`/shows/${l.showId}`} data-testid={`${l.key}-show`} title="Open the show">{l.title} ›</Link>
                      : l.name !== undefined
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
                  <StatusChip line={l} canEdit={!closed} onMarkPaid={markPaid} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid content-start gap-5">
          <HBars title="Spent by category" testid="project-by-category" spent rows={cats.map((r) => ({ ...r, label: CATEGORY_LABEL[r.key] ?? r.key }))} />
          <HBars title="Who paid" testid="project-by-payer" spent rows={payers.map((r) => ({ ...r, label: personName(r.key) }))} />
        </div>
      </div>

      <MoneyInModal open={modal?.kind === "in"} onClose={() => setModal(null)} defaults={defaults} />
      <MoneyOutModal open={modal?.kind === "out"} onClose={() => setModal(null)} defaults={modal?.defaults ?? defaults} />
    </div>
  );
}
