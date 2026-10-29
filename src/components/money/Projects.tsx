"use client";
import { useState } from "react";
import Link, { useArtistRouter } from "@/lib/artist";
import { ErrorBox, Select, useCommand } from "@/components/ui";
import { useCollection } from "@/lib/firestore-hooks";
import { PROJECT_KIND_LABEL, defaultProject, formatCents, incomeSoFar, projectTotals } from "@/lib/money";
import { todayStr } from "@/lib/booking";
import type { Release, Expense, Income, Payout, Project } from "@/schema";

const KINDS = Object.entries(PROJECT_KIND_LABEL) as [Project["kind"], string][];

/**
 * The projects list. Admins see the money columns; members see names and kinds. The Projects page keeps the New project
 * button on its title line and passes `adding`; without it (the Money overview's tab) the list shows its own button.
 */
export function Projects({ admin, adding, onDoneAdding }: { admin: boolean; adding?: boolean; onDoneAdding?(): void }) {
  const [ownAdding, setOwnAdding] = useState(false);
  const isAdding = adding ?? ownAdding;
  const done = onDoneAdding ?? (() => setOwnAdding(false));
  const projects = useCollection<Project>("projects");
  const income = useCollection<Income>("income", { skip: !admin });
  const expenses = useCollection<Expense>("expenses", { skip: !admin });
  const payouts = useCollection<Payout>("payouts", { skip: !admin });
  const releases = useCollection<Release>("releases", { skip: !admin }); // releases are admins-only
  const router = useArtistRouter();
  const all = projects.rows ?? [];
  const def = defaultProject(all);
  const sorted = [...all].sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || a.name.localeCompare(b.name));
  const open = sorted.filter((p) => p.status !== "closed");
  const closed = sorted.filter((p) => p.status === "closed");
  // A show that hasn't happened yet stays out: its guarantee is dated on the show.
  const inc = incomeSoFar(income.rows ?? [], todayStr());

  const table = (rows: typeof all, testid?: string) => (
    <div className="book-tw" data-testid={testid}>
      <table className="book-table" style={{ minWidth: admin ? 900 : 420 }}>
        <thead>
          <tr>
            <th>Project</th><th>Kind</th>
            {admin && <><th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">Net</th><th className="text-right">Owed to us</th><th className="text-right">We owe</th></>}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const t = projectTotals({ projectId: p.id, defaultProjectId: def?.id, income: inc, expenses: expenses.rows ?? [], payouts: payouts.rows ?? [] });
            const release = releases.rows?.find((a) => a.projectId === p.id);
            return (
              <tr key={p.id} className="cursor-pointer" data-testid={`project-row-${p.id}`} onClick={() => router.push(`/money/projects/${p.id}`)}>
                <td className="nm">{p.name}{p.isDefault && <> <span className="chip m">default</span></>}</td>
                <td className="nw">{PROJECT_KIND_LABEL[p.kind] ?? p.kind}{release && <> · <Link href={`/releases/${release.id}`} className="font-semibold" onClick={(e) => e.stopPropagation()} data-testid={`project-release-${p.id}`}>Open release</Link></>}</td>
                {admin && (
                  <>
                    <td className="nw text-right font-mono">{formatCents(t.inReceived)}</td>
                    <td className="nw text-right font-mono">{formatCents(t.outPaid)}</td>
                    <td className="nw text-right font-mono">{formatCents(t.net)}</td>
                    <td className="nw text-right font-mono">{t.inOwed ? formatCents(t.inOwed) : "—"}</td>
                    <td className="nw text-right font-mono">{t.weOwe ? formatCents(t.weOwe) : "—"}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="grid gap-4" data-testid="projects">
      {!admin && <span className="s">Pick a project when you add an expense.</span>}
      {admin && adding === undefined && !isAdding && <div className="flex justify-end"><button className="btn acc" data-testid="new-project" onClick={() => setOwnAdding(true)}>New project</button></div>}
      {admin && isAdding && <NewProject onDone={done} />}
      {open.length === 0 && projects.rows && <div className="empty"><span>No open projects.</span></div>}
      {open.length > 0 && table(open, "projects-table")}
      {closed.length > 0 && (
        <details data-testid="closed-projects">
          <summary className="cursor-pointer font-bold">Closed projects ({closed.length})</summary>
          <div className="mt-3">{table(closed, "closed-projects-table")}</div>
        </details>
      )}
    </div>
  );
}

/** Inline form: nothing exists until Add; Cancel throws the draft away. */
function NewProject({ onDone }: { onDone(): void }) {
  const { call, error, busy } = useCommand();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Project["kind"]>("other");
  const [msg, setMsg] = useState<string | null>(null);
  async function add() {
    if (!name.trim()) return setMsg("Give the project a name.");
    setMsg(null);
    const r = await call("projects.create", { kind, name: name.trim() });
    if (r) onDone();
  }
  return (
    <form className="card grid gap-3" data-testid="new-project-form" onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1"><span className="lbl">Name</span><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} data-testid="np-name" /></label>
        <label className="grid gap-1"><span className="lbl">Kind</span><Select<Project["kind"]> value={kind} options={KINDS} onChange={setKind} testid="np-kind" label="Kind" /></label>
      </div>
      <ErrorBox error={msg ?? error} />
      <div className="flex gap-2">
        <button type="submit" className="btn acc" disabled={busy} data-testid="np-add">Add</button>
        <button type="button" className="btn outline" data-testid="np-cancel" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
