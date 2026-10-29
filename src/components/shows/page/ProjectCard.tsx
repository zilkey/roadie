"use client";
import { useCollection } from "@/lib/firestore-hooks";
import { useArtist } from "@/lib/artist";
import { ErrorBox, useCommand } from "@/components/ui";
import { defaultProject, type ProjectLike } from "@/lib/money";
import type { ShowRow } from "../common";
import { AdminOnlyBadge } from "./kit";

/** The show's project (admins only): where its money lands. Changing it saves at once. */
export function ProjectCard({ show }: { show: ShowRow }) {
  const projects = useCollection<ProjectLike>("projects").rows ?? [];
  const { doc: artist } = useArtist();
  const { call, error, busy } = useCommand();
  const current = show.projectId ?? defaultProject(projects)?.id ?? "";
  const cur = projects.find((p) => p.id === current);
  const config = artist?.configurations?.find((c) => c.id === show.billedAs);
  const bySet = !!config && !!config.defaultProjectId && config.defaultProjectId === current;
  const options = projects.filter((p) => p.status === "open" || p.id === current).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section className="card admin" data-testid="project-card">
      <div className="card-head"><div className="flex flex-wrap items-center gap-2.5"><h2>Project</h2><AdminOnlyBadge /></div></div>
      <div className="flex flex-wrap items-center gap-3">
        <select className="select" style={{ maxWidth: 280 }} aria-label="Project" value={current} disabled={busy || projects.length === 0}
          onChange={(e) => void call("shows.update", { id: show.id, patch: { projectId: e.target.value } })} data-testid="show-project">
          {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {bySet && <span className="s" data-testid="project-set-by">{cur?.name} · set by the {config!.name} configuration</span>}
      </div>
      <ErrorBox error={error} />
    </section>
  );
}
