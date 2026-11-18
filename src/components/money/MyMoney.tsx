"use client";
import Link, { useArtist } from "@/lib/artist";
import { useEffect, useState } from "react";
import { useProfile } from "@/lib/auth";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { Dialog, ErrorBox, PageTitle, Select, useCommand } from "@/components/ui";
import { WelcomeEmpty } from "@/components/WelcomeEmpty";
import { CATEGORY_LABEL, defaultProject, fileableProjects, formatCents, memberProjectsOf, owesBack, parseDollars, PAYOUT_KIND_LABEL, projectOf, sumExpenses } from "@/lib/money";
import { showName as nameOfShow } from "@/lib/shows";
import { expenseCategory, type Expense, type Payout, type Project, type Show } from "@/schema";

const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** One line of the table: an expense of theirs, or a paid payout to them (never a reimbursement). */
interface Line {
  key: string; id: string; kind: "expense" | "payout"; date: string; what: string; category: string; show: string; project: string; amount: number;
  status: string; tone: "owed" | "g" | ""; expense?: Row<Expense>;
}
type SortKey = "date" | "what" | "amount";
const SORTS: [SortKey, string][] = [["date", "Date"], ["what", "What"], ["amount", "Amount"]];

/** Members: what the band owes them, and one table of their expenses and what they've been paid. Rules allow only their own rows. */
export function MyMoney() {
  const p = useProfile();
  const { musicianId, doc: artistDoc } = useArtist();
  const expenses = useCollection<Expense>("expenses", { where: [["userId", "==", p.uid]] });
  const shows = useCollection<Show>("shows");
  const projects = useCollection<Project>("projects");
  // A member may list payouts only with a where on `to`: one query for payouts to their user, one for payouts to their musician.
  const toUser = useCollection<Payout>("payouts", { where: [["to.userId", "==", p.uid]] });
  const toMusician = useCollection<Payout>("payouts", { where: [["to.musicianId", "==", musicianId ?? ""]], skip: !musicianId });
  const [sort, setSort] = useState<{ by: SortKey; dir: 1 | -1 }>({ by: "date", dir: -1 });
  const [openId, setOpenId] = useState<string | null>(null);
  const mine = expenses.rows ?? [];
  const owed = mine.filter(owesBack);
  // Only PAID payouts show here, and a reimbursement is never a row (its expenses say "Paid back"). An unpaid payout is the band's bookkeeping.
  const seen = new Set<string>();
  const paid = [...(toUser.rows ?? []), ...(toMusician.rows ?? [])]
    .filter((x) => !!x.paidAt && x.kind !== "reimbursement" && !seen.has(x.id) && !!seen.add(x.id));
  const defaultId = defaultProject(projects.rows ?? [])?.id;
  const projectName = (id?: string) => projects.rows?.find((pr) => pr.id === id)?.name ?? "";
  const showName = (id?: string) => { const s = shows.rows?.find((s) => s.id === id); return s ? nameOfShow(s) : ""; };
  // A member picks only from the projects an admin lets them file to (plus the one the expense is already on).
  const pickable = fileableProjects(projects.rows ?? [], memberProjectsOf(artistDoc?.expenseProjects, p.uid));
  const optionsFor = (x: Expense) => [...pickable, ...(projects.rows ?? []).filter((pr) => pr.id === x.projectId && !pickable.some((o) => o.id === pr.id))];

  const lines: Line[] = [
    ...mine.map((x): Line => ({
      key: `e:${x.id}`, id: x.id, kind: "expense", date: x.date, what: x.what, category: CATEGORY_LABEL[x.category] ?? x.category, show: showName(x.showId),
      project: projectName(projectOf(x, defaultId)), amount: x.amount, expense: x,
      ...(x.payBack === false ? { status: "Your own money", tone: "" as const } : x.paidBackAt ? { status: `Paid back ${shortDate(x.paidBackAt)}`, tone: "g" as const } : { status: "Owed to you", tone: "owed" as const }),
    })),
    ...paid.map((x): Line => ({
      key: `p:${x.id}`, id: x.id, kind: "payout", date: x.paidAt!, what: x.what || PAYOUT_KIND_LABEL[x.kind] || x.kind, category: PAYOUT_KIND_LABEL[x.kind] ?? x.kind,
      show: showName(x.showId), project: projectName(x.projectId), amount: x.amount, status: `Paid ${shortDate(x.paidAt!)}`, tone: "g",
    })),
  ].sort((a, b) => {
    const c = sort.by === "amount" ? a.amount - b.amount : sort.by === "what" ? a.what.localeCompare(b.what) : a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    return (c || (a.key < b.key ? -1 : 1)) * sort.dir;
  });
  // The Project column shows when it says something: rows on more than one project, or on one that isn't the band's default.
  const defaultName = projectName(defaultId);
  const named = new Set(lines.map((l) => l.project).filter(Boolean));
  const showProject = named.size > 1 || (named.size === 1 && !named.has(defaultName));

  // Nothing to show until their expenses and payouts are in: the owed count must never read 0 while loading.
  if (expenses.rows === null || toUser.rows === null) return null;
  // Nothing of theirs yet: a welcome card with no hide button, since Money is how they get paid back.
  if (mine.length === 0 && paid.length === 0) {
    return (
      <WelcomeEmpty section="money" variant={0} hideable={false} title="Welcome to your money page!"
        body="Anything you spend for the band, like gas, strings or a rental, goes here so you get paid back."
        actions={<Link href="/money/expense" className="btn acc" data-testid="add-expense-link">+ New expense</Link>} />
    );
  }
  const clickSort = (by: SortKey) => setSort((s) => s.by === by ? { by, dir: (-s.dir) as 1 | -1 } : { by, dir: by === "what" ? 1 : -1 });
  const total = formatCents(sumExpenses(owed));
  const count = `${owed.length} ${owed.length === 1 ? "expense" : "expenses"}`;
  const open = (l: Line) => l.kind === "expense" && !l.expense!.paidBackAt ? setOpenId(l.id) : undefined;
  const editable = (l: Line) => l.kind === "expense" && !l.expense!.paidBackAt;
  const editing = mine.find((x) => x.id === openId && !x.paidBackAt);
  const cols = showProject ? 7 : 6;

  return (
    <div className="grid gap-5" data-testid="my-money">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTitle title="My money" />
        <Link href="/money/expense" className="btn acc" data-testid="add-expense-link">+ New expense</Link>
      </div>

      {/* Phones: the total card, a Sort select and stacked rows. */}
      <div className="my-money-list grid gap-3">
        <div className="card admin" data-testid="my-money-total-card">
          <span className="lbl">The band owes you</span>
          <b className="font-mono text-2xl">{total}</b>
          <span className="s">{count}</span>
        </div>
        <Select label="Sort" value={`${sort.by}:${sort.dir}`} testid="my-money-sort"
          options={SORTS.flatMap(([k, l]) => [[`${k}:-1`, `${l} ${k === "what" ? "Z–A" : "high to low"}`], [`${k}:1`, `${l} ${k === "what" ? "A–Z" : "low to high"}`]] as [string, string][]).map(([v, l]) => [v, k2l(v, l)] as [string, string])}
          onChange={(v) => { const [by, dir] = v.split(":"); setSort({ by: by as SortKey, dir: Number(dir) as 1 | -1 }); }} />
        {lines.map((l) => (
          <div key={`m:${l.key}`} className="card my-money-item" role={editable(l) ? "button" : undefined} tabIndex={editable(l) ? 0 : undefined}
            onClick={() => open(l)} onKeyDown={(e) => { if (e.key === "Enter") open(l); }}>
            <div className="flex justify-between gap-2"><b>{l.what}</b><span className="font-mono">{formatCents(l.amount)}</span></div>
            <span className="s">{[shortDate(l.date), l.category, l.show].filter(Boolean).join(" · ")}</span>
            <span className={`chip ${l.tone}`} style={{ width: "fit-content" }}>{l.status}</span>
          </div>
        ))}
      </div>

      <div className="card flush my-money-wide" style={{ overflowX: "auto" }}>
        <table className="book-table my-money-table" style={{ minWidth: 0 }} data-testid="my-money-table">
          <thead><tr>
            {([["date", "Date"], ["what", "What"], [null, "Category"], [null, "Show"], ...(showProject ? [[null, "Project"]] : []), ["amount", "Amount"], [null, "Status"]] as [SortKey | null, string][]).map(([k, h]) => (
              <th key={h} className={k === "amount" ? "text-right" : undefined} aria-sort={k && sort.by === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                {k ? (
                  <button type="button" className="th-sort" data-testid={`my-money-sort-${k}`} onClick={() => clickSort(k)}>
                    {h}{sort.by === k && <span aria-hidden> {sort.dir === 1 ? "▲" : "▼"}</span>}
                  </button>
                ) : h}
              </th>
            ))}
          </tr></thead>
          <tbody>
            <tr className="my-money-total" data-testid="my-money-total">
              <td colSpan={cols - 2}><b>The band owes you</b></td>
              <td className="text-right"><b className="font-mono" data-testid="my-money-total-amount">{total}</b></td>
              <td><span className="s" data-testid="my-money-total-count">{count}</span></td>
            </tr>
            {lines.map((l) => (
              <tr key={l.key} data-testid={`my-money-row-${l.id}`} className={editable(l) ? "my-money-click" : undefined} onClick={() => open(l)}>
                <td className="nw">{shortDate(l.date)}</td>
                <td><b>{l.what}</b>{l.expense?.notes && <><br /><span className="s" data-testid={`expense-notes-${l.id}`}>{l.expense.notes}</span></>}</td>
                <td>{l.category}</td>
                <td>{l.show}</td>
                {showProject && <td>{l.project}</td>}
                <td className="text-right font-mono">{formatCents(l.amount)}</td>
                <td><span className={`chip ${l.tone}`} data-testid={`my-money-status-${l.id}`}>{l.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="s">You can edit or remove an expense until it's been paid back. After that, ask an admin to fix mistakes.</span>

      {editing && (
        <Dialog open onClose={() => setOpenId(null)} title="Edit expense" testid="expense-editor">
          <ExpenseEditor key={editing.id} x={editing} projects={optionsFor(editing)} defaultId={defaultId} onClose={() => setOpenId(null)} />
        </Dialog>
      )}
    </div>
  );
}

const k2l = (v: string, l: string) => (v.startsWith("date") ? l.replace("high to low", "newest first").replace("low to high", "oldest first") : l);

/** The autosaving editor for an expense that hasn't been paid back: every field saves on blur/change; Done just closes. */
function ExpenseEditor({ x, projects, defaultId, onClose }: { x: Row<Expense>; projects: Project[]; defaultId?: string; onClose(): void }) {
  const { call, error } = useCommand();
  const [what, setWhat] = useState(x.what);
  const [amount, setAmount] = useState((x.amount / 100).toFixed(2));
  const [notes, setNotes] = useState(x.notes ?? "");
  const [date, setDate] = useState(x.date);
  useEffect(() => setWhat(x.what), [x.what]);
  const patch = (p: Record<string, unknown>) => void call("expenses.update", { id: x.id, patch: p });
  return (
    <div className="grid gap-3">
      <label className="grid gap-1"><span className="lbl">What</span>
        <input className="input" value={what} onChange={(e) => setWhat(e.target.value)} data-testid="expense-edit-what"
          onBlur={() => { if (what.trim() && what.trim() !== x.what) patch({ what: what.trim() }); else setWhat(x.what); }} /></label>
      <label className="grid gap-1"><span className="lbl">Amount</span>
        <input className="input font-mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="expense-edit-amount"
          onBlur={() => { const c = parseDollars(amount); if (c && c !== x.amount) patch({ amount: c }); else setAmount((x.amount / 100).toFixed(2)); }} /></label>
      <label className="grid gap-1"><span className="lbl">Category</span>
        <Select value={x.category} testid="expense-edit-category" options={expenseCategory.options.map((c) => [c, CATEGORY_LABEL[c] ?? c] as [string, string])}
          onChange={(v) => patch({ category: v })} /></label>
      <label className="grid gap-1"><span className="lbl">Date</span>
        <input className="input" type="date" value={date} onChange={(e) => { setDate(e.target.value); if (e.target.value) patch({ date: e.target.value }); }} data-testid="expense-edit-date" /></label>
      <label className="grid gap-1"><span className="lbl">Notes</span>
        <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="expense-edit-notes"
          onBlur={() => { if (notes.trim() !== (x.notes ?? "")) patch({ notes: notes.trim() || null }); }} /></label>
      {projects.length > 1 && (
        <label className="grid gap-1"><span className="lbl">Project</span>
          <Select value={x.projectId ?? defaultId ?? ""} testid="expense-edit-project" options={projects.map((pr) => [pr.id, pr.name] as [string, string])}
            onChange={(v) => patch({ projectId: v })} /></label>
      )}
      <ErrorBox error={error} />
      <div className="flex justify-between gap-2">
        <button type="button" className="btn ghost sm" data-testid="expense-edit-remove"
          onClick={async () => { if (confirm("Remove this expense?") && await call("expenses.remove", { id: x.id })) onClose(); }}>Remove</button>
        <button type="button" className="btn acc sm" data-testid="expense-edit-done" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
