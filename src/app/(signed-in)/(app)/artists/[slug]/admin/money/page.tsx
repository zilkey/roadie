"use client";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, PickChip, Select, useCommand } from "@/components/ui";
import { useArtist } from "@/lib/artist";
import { useCollection } from "@/lib/firestore-hooks";
import { defaultProject } from "@/lib/money";
import { roleIn, type Project, type User } from "@/schema";

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

  async function set(userId: string, projectId: string) {
    await call("artists.setMemberProjects", { userId, projectId: projectId || null });
  }
  /** Ticking chips limits the person to those projects; clearing them all (or "All projects") lifts the limit. */
  async function setVisible(userId: string, ids: string[]) {
    await call("artists.setMemberProjects", { userId, visibleProjectIds: ids.length ? ids : null });
  }

  return (
    <div className="grid gap-5">
      <PageTitle title="Money" sub="Pick where each person's own expenses go when they aren't added from a show, rehearsal or tour, and which projects they can file expenses to (everyone starts with all open projects)." />
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
      <ErrorBox error={error} />
    </div>
  );
}
