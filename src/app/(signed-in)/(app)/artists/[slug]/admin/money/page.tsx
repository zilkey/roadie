"use client";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, PickChip, Select, useCommand } from "@/components/ui";
import { useArtist } from "@/lib/artist";
import { useCollection } from "@/lib/firestore-hooks";
import { useEffect, useState } from "react";
import { INCOME_LABEL, METHOD_LABEL, defaultProject, paysBackByDefault } from "@/lib/money";
import { roleIn, type Project, type User } from "@/schema";
import type { QuickEntryRow } from "@/schema/artists";

export default function MoneySettingsPage() { return <AdminOnly><MoneySettings /></AdminOnly>; }

/** Settings › Money: each person's default project and the projects they may file expenses to. Saves on change. */
function MoneySettings() {
  const { artistId, doc } = useArtist();
  const users = useCollection<User>("users");
  const projects = useCollection<Project>("projects");
  const { call, error, busy } = useCommand();
  const team = (users.rows ?? []).filter((u) => { const r = roleIn(u, artistId); return r === "admin" || r === "member"; })
    .sort((a, b) => a.name.localeCompare(b.name));
  const all = projects.rows ?? [];
  const def = defaultProject(all);
  const open = all.filter((p) => p.status === "open" && !p.isDefault).sort((a, b) => a.name.localeCompare(b.name));
  const current = doc?.expenseProjects ?? [];
  const of = (uid: string) => current.find((x) => x.userId === uid)?.projectId ?? "";
  const listOf = (uid: string) => current.find((x) => x.userId === uid)?.visibleProjectIds;
  const fileable = all.filter((p) => p.status === "open" && !p.deletedAt).sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || a.name.localeCompare(b.name));

  const paysBack = (uid: string) => paysBackByDefault(current.find((x) => x.userId === uid));
  async function set(userId: string, projectId: string) {
    await call("artists.setMemberProjects", { userId, projectId: projectId || null });
  }
  /** Ticking chips limits the person to those projects; clearing them all (or "All projects") lifts the limit. */
  async function setVisible(userId: string, ids: string[]) {
    await call("artists.setMemberProjects", { userId, visibleProjectIds: ids.length ? ids : null });
  }

  return (
    <div className="grid gap-5">
      <PageTitle title="Money" sub="Pick where each person's own expenses go when they aren't added from a show, rehearsal or tour, which projects they can file expenses to (everyone starts with all open projects), and whether the band pays them back by default." />
      {users.rows !== null && projects.rows !== null && doc && (
        <div className="card" data-testid="expense-projects">
          <span className="lbl">Default project and projects they can file to</span>
          {team.map((u) => {
            const cur = of(u.id);
            const list = listOf(u.id);
            // A person whose project has since been closed keeps it in the list, so the row says what is saved.
            const options = [...open, ...all.filter((p) => p.id === cur && !open.some((o) => o.id === p.id) && !p.isDefault)].map((p) => [p.id, p.name] as [string, string]);
            return (
              <div key={u.id} className="money-row items-center flex-wrap" data-testid={`expense-project-row-${u.id}`}>
                <span>{u.name}</span>
                <Select className="!w-auto" label={`Default project for ${u.name}`} testid={`expense-project-for-${u.id}`} value={cur} disabled={busy}
                  placeholder={def ? `${def.name} (the default)` : "The default project"} options={options} onChange={(v) => void set(u.id, v)} />
                <label className="flex items-center gap-1.5 s">
                  <input type="checkbox" checked={paysBack(u.id)} disabled={busy} onChange={(e) => void call("artists.setMemberProjects", { userId: u.id, payBack: e.target.checked })} data-testid={`expense-payback-for-${u.id}`} /> Paid back by default
                </label>
                <div className="flex flex-wrap gap-1.5 basis-full" role="group" aria-label={`Projects ${u.name} can file to`} data-testid={`visible-projects-${u.id}`}>
                  <PickChip on={!list} onToggle={() => { if (list) void setVisible(u.id, []); }} testid={`visible-project-${u.id}-all`}>All projects</PickChip>
                  {fileable.map((p) => {
                    const locked = !!list && (p.id === cur || (!cur && !!p.isDefault));
                    const on = !!list && (list.includes(p.id) || locked);
                    return (
                      <PickChip key={p.id} on={on} testid={`visible-project-${u.id}-${p.id}`}
                        onToggle={() => {
                          if (busy || locked) return;
                          const base = list ?? [];
                          void setVisible(u.id, on ? base.filter((x) => x !== p.id) : [...base, p.id]);
                        }}>{p.name}</PickChip>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {doc && <QuickEntrySettings rows={doc.showQuickEntry?.rows ?? []} />}
      <ErrorBox error={error} />
    </div>
  );
}

const CATEGORIES = Object.entries(INCOME_LABEL) as [QuickEntryRow["category"], string][];
const METHODS = Object.entries(METHOD_LABEL) as [QuickEntryRow["method"], string][];
const newId = () => crypto.randomUUID().slice(0, 8);

/** The show Quick entry template: one line per row, in order. Every change saves the whole list; the From box saves on blur. */
function QuickEntrySettings({ rows: saved }: { rows: QuickEntryRow[] }) {
  const { call, error, busy } = useCommand();
  // What was just changed shows at once; the saved list takes over again when it arrives.
  const [local, setLocal] = useState<QuickEntryRow[] | null>(null);
  useEffect(() => setLocal(null), [saved]);
  const rows = local ?? saved;
  // The From boxes are typed into before they save, so they keep their own text until blur.
  const [from, setFrom] = useState<Record<string, string>>({});
  const save = (next: QuickEntryRow[]) => { setLocal(next); return call("artists.setShowQuickEntry", { rows: next }); };
  const patch = (id: string, p: Partial<QuickEntryRow>) => save(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const move = (i: number, d: number) => {
    const next = [...rows];
    const [r] = next.splice(i, 1);
    next.splice(i + d, 0, r!);
    return save(next);
  };
  const saveFrom = (r: QuickEntryRow) => {
    const text = (from[r.id] ?? r.from ?? "").trim();
    setFrom(({ [r.id]: _drop, ...rest }) => rest);
    if (text === (r.from ?? "")) return;
    const { from: _old, ...base } = r;
    return save(rows.map((x) => (x.id === r.id ? { ...base, ...(text ? { from: text } : {}) } : x)));
  };
  return (
    <div className="card" data-testid="quick-entry-settings">
      <span className="lbl">Show quick entry</span>
      <p className="s mb-2">The lines you fill in after every show. They show on each show&apos;s Finances tab, in this order. Changes save as you go.</p>
      {rows.map((r, i) => (
        <div key={r.id} className="money-row items-center flex-wrap gap-2" data-testid={`qe-row-${r.id}`}>
          <button type="button" className="btn ghost sm" aria-label="Move up" disabled={busy || i === 0} onClick={() => void move(i, -1)} data-testid={`qe-up-${r.id}`}>↑</button>
          <button type="button" className="btn ghost sm" aria-label="Move down" disabled={busy || i === rows.length - 1} onClick={() => void move(i, 1)} data-testid={`qe-down-${r.id}`}>↓</button>
          <Select className="!w-auto" label="Category" testid={`qe-cat-${r.id}`} value={r.category} options={CATEGORIES} disabled={busy} onChange={(v) => void patch(r.id, { category: v })} />
          <Select className="!w-auto" label="Method" testid={`qe-method-${r.id}`} value={r.method} options={METHODS} disabled={busy} onChange={(v) => void patch(r.id, { method: v })} />
          <input className="input !w-auto" aria-label="From" placeholder={r.category === "guarantee" || r.category === "door" ? "The venue" : INCOME_LABEL[r.category] ?? ""}
            value={from[r.id] ?? r.from ?? ""} onChange={(e) => setFrom((f) => ({ ...f, [r.id]: e.target.value }))} onBlur={() => void saveFrom(r)} data-testid={`qe-from-${r.id}`} />
          <label className="flex items-center gap-1.5 s">
            <input type="checkbox" checked={!!r.askWhatFor} disabled={busy} onChange={(e) => void patch(r.id, { askWhatFor: e.target.checked })} data-testid={`qe-ask-${r.id}`} /> What for
          </label>
          <button type="button" className="btn ghost sm" aria-label="Remove row" disabled={busy} onClick={() => void save(rows.filter((x) => x.id !== r.id))} data-testid={`qe-remove-${r.id}`}>✕</button>
        </div>
      ))}
      <div className="mt-2">
        <button type="button" className="btn ghost" disabled={busy || rows.length >= 20} onClick={() => void save([...rows, { id: newId(), category: "tips", method: "cash" }])} data-testid="qe-add-row">+ Add row</button>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}
