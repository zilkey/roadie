"use client";
import Link from "@/lib/artist";
import { useState } from "react";
import { useProfile } from "@/lib/auth";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { ErrorBox, PageTitle, Select, useCommand } from "@/components/ui";
import { WelcomeEmpty } from "@/components/WelcomeEmpty";
import { CATEGORY_LABEL, defaultProject, formatCents, METHOD_LABEL, owesBack, parseDollars, PAYOUT_KIND_LABEL, projectOf, sumExpenses } from "@/lib/money";
import { showName as nameOfShow } from "@/lib/shows";
import type { Expense, Payout, Project, Show } from "@/schema";

const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Members: what the band owes them, their own expenses and what they've been paid. Rules allow only their own rows. */
export function MyMoney() {
  const p = useProfile();
  const expenses = useCollection<Expense>("expenses", { where: [["userId", "==", p.uid]] });
  const shows = useCollection<Show>("shows");
  const projects = useCollection<Project>("projects");
  // A member may list payouts only with a where on `to`: one query for payouts to their user, one for payouts to their musician.
  const toUser = useCollection<Payout>("payouts", { where: [["to.userId", "==", p.uid]] });
  const toMusician = useCollection<Payout>("payouts", { where: [["to.musicianId", "==", p.musicianId ?? ""]], skip: !p.musicianId });
  const mine = [...(expenses.rows ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));
  const owed = mine.filter(owesBack);
  // Only PAID payouts show here. An unpaid payout to you is the band's bookkeeping until it is paid.
  const seen = new Set<string>();
  const paid = [...(toUser.rows ?? []), ...(toMusician.rows ?? [])]
    .filter((x) => !!x.paidAt && !seen.has(x.id) && !!seen.add(x.id))
    .sort((a, b) => (a.paidAt! < b.paidAt! ? 1 : -1));
  const defaultId = defaultProject(projects.rows ?? [])?.id;
  const projectName = (x: Expense) => projects.rows?.find((pr) => pr.id === projectOf(x, defaultId))?.name;
  const showName = (id?: string) => ((x) => x && nameOfShow(x))(shows.rows?.find((s) => s.id === id));
  // Nothing to show until their expenses and payouts are in: the owed count must never read 0 while loading.
  if (expenses.rows === null || toUser.rows === null) return null;
  // Nothing of theirs yet: a welcome card with no hide button, since Money is how they get paid back.
  if (mine.length === 0 && paid.length === 0) {
    return (
      <WelcomeEmpty section="money" variant={0} hideable={false} title="Welcome to your money page!"
        body="Anything you spend for the band, like gas, strings or a rental, goes here so you get paid back."
        actions={<Link href="/money/expense" className="btn acc" data-testid="add-expense-link">Add an expense</Link>} />
    );
  }
  return (
    <div className="grid max-w-xl gap-5" data-testid="my-money">
      <PageTitle title="My money" />
      <div className="flex flex-wrap gap-2">
        <Link href="/money/expense" className="btn acc" data-testid="add-expense-link">Add an expense</Link>
        <Link href="/money/projects" className="btn ghost" data-testid="projects-link">Projects</Link>
      </div>
      <div className="card" data-testid="my-owed">
        <span className="lbl">The band owes you</span>
        <b className="font-mono text-2xl" data-testid="my-owed-total">{formatCents(sumExpenses(owed))}</b>
        <span className="s" data-testid="my-owed-count">for {owed.length} {owed.length === 1 ? "expense" : "expenses"}</span>
      </div>
      <div className="grid content-start gap-2" data-testid="my-expenses">
        <span className="lbl">My expenses</span>
        {mine.map((x) => <MyExpense key={x.id} x={x} project={projectName(x)} projects={(projects.rows ?? []).filter((pr) => pr.status === "open" || pr.id === x.projectId)} />)}
        <span className="s">You can edit or remove an expense until it's been paid back. After that, ask Jeff or Ingrid to fix mistakes.</span>
      </div>
      <div className="grid content-start gap-2" data-testid="paid-to-me">
        <span className="lbl">Paid to me</span>
        {paid.length === 0 && <span className="s">Nothing paid yet.</span>}
        {paid.map((x) => (
          <div key={x.id} className="money-row" data-testid={`paid-to-me-${x.id}`}>
            <span>{x.what || [PAYOUT_KIND_LABEL[x.kind] ?? x.kind, showName(x.showId)].filter(Boolean).join(" · ")}
              <br /><span className="s">{[x.method && (METHOD_LABEL[x.method] ?? x.method), shortDate(x.paidAt!)].filter(Boolean).join(" · ")}</span></span>
            <span className="font-mono">{formatCents(x.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MyExpense({ x, project, projects }: { x: Row<Expense>; project?: string; projects: Project[] }) {
  const { call, error, busy } = useCommand();
  const [editing, setEditing] = useState(false);
  const [what, setWhat] = useState(x.what);
  const [amount, setAmount] = useState((x.amount / 100).toFixed(2));
  const paid = !!x.paidBackAt;
  const status = x.payBack === false ? "no pay back" : paid ? `paid back ${shortDate(x.paidBackAt!)}` : "waiting";
  const cents = parseDollars(amount);
  async function save() {
    if (!cents || !what.trim()) return;
    const r = await call("expenses.update", { id: x.id, patch: { what: what.trim(), amount: cents } });
    if (r) setEditing(false);
  }
  return (
    <div className="card" data-testid={`expense-${x.id}`}>
      <div className="money-row" style={{ border: 0, padding: 0 }} data-testid={`my-expense-${x.id}`}>
        <span><b>{x.what}</b><br />{x.notes && <><span className="s" data-testid={`expense-notes-${x.id}`}>{x.notes}</span><br /></>}<span className="s">{[project, shortDate(x.date)].filter(Boolean).join(" · ")} · {CATEGORY_LABEL[x.category] ?? x.category}</span></span>
        <span className="grid justify-items-end gap-1"><span className="font-mono">{formatCents(x.amount)}</span>
          <span className={`chip ${paid && x.payBack !== false ? "g" : x.payBack === false ? "" : "owed"}`} data-testid={`expense-status-${x.id}`}>{status}</span></span>
      </div>
      {!paid && projects.length > 0 && (
        <Select label="Project" testid={`expense-project-${x.id}`} value={x.projectId ?? projects.find((pr) => pr.isDefault)?.id ?? ""} options={projects.map((pr) => [pr.id, pr.name] as [string, string])}
          onChange={(v) => void call("expenses.update", { id: x.id, patch: { projectId: v } })} />
      )}
      {editing && (
        <div className="grid gap-2">
          <input className="input" value={what} onChange={(e) => setWhat(e.target.value)} data-testid={`expense-edit-what-${x.id}`} />
          <input className="input font-mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid={`expense-edit-amount-${x.id}`} />
          <div className="flex gap-2">
            <button className="btn acc sm" disabled={busy || !cents || !what.trim()} onClick={save} data-testid={`expense-save-${x.id}`}>Save</button>
            <button className="btn ghost sm" onClick={() => { setEditing(false); setWhat(x.what); setAmount((x.amount / 100).toFixed(2)); }}>Cancel</button>
          </div>
        </div>
      )}
      <ErrorBox error={error} />
      {!paid && !editing && (
        <div className="flex gap-2">
          <button className="btn ghost sm" onClick={() => setEditing(true)} data-testid={`expense-edit-${x.id}`}>Edit</button>
          <button className="btn ghost sm" disabled={busy} data-testid={`expense-remove-${x.id}`}
            onClick={() => { if (confirm("Remove this expense?")) void call("expenses.remove", { id: x.id }); }}>Remove</button>
        </div>
      )}
    </div>
  );
}
