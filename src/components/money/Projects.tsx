"use client";
import { useState } from "react";
import Link, { useArtistRouter } from "@/lib/artist";
import { ErrorBox, Select, useCommand } from "@/components/ui";
import { useCollection } from "@/lib/firestore-hooks";
import { PROJECT_KIND_LABEL, defaultProject, formatCents, incomeSoFar, projectTotals } from "@/lib/money";
import { todayStr } from "@/lib/booking";
import type { Album, Expense, Income, Payout, Project } from "@/schema";

const KINDS = Object.entries(PROJECT_KIND_LABEL) as [Project["kind"], string][];
const shortDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "Sep 1 – Apr 30", "From Sep 1", "Until Apr 30" or "". */
export function projectWhen(p: { start?: string; end?: string }) {
  if (p.start && p.end) return `${shortDate(p.start)} – ${shortDate(p.end)}`;
  if (p.start) return `From ${shortDate(p.start)}`;
  if (p.end) return `Until ${shortDate(p.end)}`;
  return "";
}

/** The projects list. Admins see the money columns and can add a project; members see names, kinds and dates. */
export function Projects({ admin }: { admin: boolean }) {
  const projects = useCollection<Project>("projects");
  const income = useCollection<Income>("income", { skip: !admin });
  const expenses = useCollection<Expense>("expenses", { skip: !admin });
  const payouts = useCollection<Payout>("payouts", { skip: !admin });
  const albums = useCollection<Album>("albums", { skip: !admin }); // albums are admins-only
  const router = useArtistRouter();
  const [adding, setAdding] = useState(false);
  const all = projects.rows ?? [];
  const def = defaultProject(all);
  const sorted = [...all].sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || (a.start ?? "9999") .localeCompare(b.start ?? "9999") || a.name.localeCompare(b.name));
  const open = sorted.filter((p) => p.status !== "closed");
  const closed = sorted.filter((p) => p.status === "closed");
  // A show that hasn't happened yet stays out: its guarantee is dated on the show.
  const inc = incomeSoFar(income.rows ?? [], todayStr());

  const table = (rows: typeof all, testid?: string) => (
    <div className="book-tw" data-testid={testid}>
      <table className="book-table" style={{ minWidth: admin ? 900 : 420 }}>
        <thead>
          <tr>
            <th>Project</th><th>Kind</th><th>When</th>
            {admin && <><th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">Net</th><th className="text-right">Owed to us</th><th className="text-right">We owe</th></>}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const t = projectTotals({ projectId: p.id, defaultProjectId: def?.id, income: inc, expenses: expenses.rows ?? [], payouts: payouts.rows ?? [] });
            const album = albums.rows?.find((a) => a.projectId === p.id);
            return (
              <tr key={p.id} className="cursor-pointer" data-testid={`project-row-${p.id}`} onClick={() => router.push(`/money/projects/${p.id}`)}>
                <td className="nm">{p.name}{p.isDefault && <> <span className="chip m">default</span></>}</td>
                <td className="nw">{PROJECT_KIND_LABEL[p.kind] ?? p.kind}{album && <> · <Link href={`/albums/${album.id}`} className="font-semibold" onClick={(e) => e.stopPropagation()} data-testid={`project-album-${p.id}`}>Open album</Link></>}</td>
                <td className="nw">{projectWhen(p) || "—"}</td>
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="s">{admin ? "Every dollar in, out and owed lands on one project." : "Pick a project when you add an expense."}</span>
        {admin && !adding && <button className="btn acc" data-testid="new-project" onClick={() => setAdding(true)}>New project</button>}
      </div>
      {admin && adding && <NewProject onDone={() => setAdding(false)} />}
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
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  async function add() {
    if (!name.trim()) return setMsg("Give the project a name.");
    if (start && end && end < start) return setMsg("The end date is before the start.");
    setMsg(null);
    const r = await call("projects.create", { kind, name: name.trim(), ...(start ? { start } : {}), ...(end ? { end } : {}) });
    if (r) onDone();
  }
  return (
    <form className="card grid gap-3" data-testid="new-project-form" onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1"><span className="lbl">Name</span><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} data-testid="np-name" /></label>
        <label className="grid gap-1"><span className="lbl">Kind</span><Select<Project["kind"]> value={kind} options={KINDS} onChange={setKind} testid="np-kind" label="Kind" /></label>
        <label className="grid gap-1"><span className="lbl">Starts</span><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="np-start" /></label>
        <label className="grid gap-1"><span className="lbl">Ends</span><input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="np-end" /></label>
      </div>
      <ErrorBox error={msg ?? error} />
      <div className="flex gap-2">
        <button type="submit" className="btn acc" disabled={busy} data-testid="np-add">Add</button>
        <button type="button" className="btn outline" data-testid="np-cancel" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

export { DATE as DATE_RE };
