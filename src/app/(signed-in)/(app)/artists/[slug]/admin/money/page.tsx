"use client";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, Select, useCommand } from "@/components/ui";
import { useArtist } from "@/lib/artist";
import { useCollection } from "@/lib/firestore-hooks";
import { defaultProject } from "@/lib/money";
import { roleIn, type Project, type User } from "@/schema";

export default function MoneySettingsPage() { return <AdminOnly><MoneySettings /></AdminOnly>; }

/** Settings › Money: each person's default project for their own expenses. Saves on change. */
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

  async function set(userId: string, projectId: string) {
    const rest = current.filter((x) => x.userId !== userId);
    await call("artists.update", { id: artistId, patch: { expenseProjects: projectId ? [...rest, { userId, projectId }] : rest } });
  }

  return (
    <div className="grid gap-5">
      <PageTitle title="Money" sub="Where each person's own expenses go when they aren't added from a show, rehearsal or tour. They can still pick another project on the expense." />
      {users.rows !== null && projects.rows !== null && doc && (
        <div className="card" data-testid="expense-projects">
          <span className="lbl">Default project for expenses</span>
          {team.map((u) => {
            const cur = of(u.id);
            // A person whose project has since been closed keeps it in the list, so the row says what is saved.
            const options = [...open, ...all.filter((p) => p.id === cur && !open.some((o) => o.id === p.id) && !p.isDefault)].map((p) => [p.id, p.name] as [string, string]);
            return (
              <label key={u.id} className="money-row items-center" data-testid={`expense-project-row-${u.id}`}>
                <span>{u.name}</span>
                <Select className="!w-auto" label={`Default project for ${u.name}`} testid={`expense-project-for-${u.id}`} value={cur} disabled={busy}
                  placeholder={def ? `${def.name} (the default)` : "The default project"} options={options} onChange={(v) => void set(u.id, v)} />
              </label>
            );
          })}
        </div>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
