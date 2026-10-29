"use client";
import Link from "@/lib/artist";
import { useMemo } from "react";
import { PageTitle } from "@/components/ui";
import { useProfile } from "@/lib/auth";
import { AdminOnly } from "@/components/Guard";
import { useCollection } from "@/lib/firestore-hooks";
import { fmtLen } from "@/lib/music";
import { RELEASE_KIND_LONG, isReleased, totalLength, trackProgress } from "@/lib/releases";
import { defaultProject, formatCents, projectTotals } from "@/lib/money";
import { useReleases } from "@/components/releases/common";
import { WelcomeEmpty } from "@/components/WelcomeEmpty";
import type { Expense, Income, Payout, Project } from "@/schema";

/** "Mar 6, 2027". */
const fmtRelease = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Releases is admins-only for now: members are sent back to the Calendar. */
export default function ReleasesPage() { return <AdminOnly><Releases /></AdminOnly>; }

function Releases() {
  const admin = useProfile().role === "admin";
  const { releases, tracks, loading } = useReleases();
  // Money is admins-only: members never read it.
  const income = useCollection<Income>("income", { skip: !admin });
  const expenses = useCollection<Expense>("expenses", { skip: !admin });
  const payouts = useCollection<Payout>("payouts", { skip: !admin });
  const projects = useCollection<Project>("projects", { skip: !admin });

  const rows = useMemo(() => {
    const def = defaultProject(projects.rows ?? [])?.id;
    return releases.map((a) => {
      const mine = tracks.filter((t) => t.releaseId === a.id);
      const t = admin ? projectTotals({ projectId: a.projectId, defaultProjectId: def, income: income.rows ?? [], expenses: expenses.rows ?? [], payouts: payouts.rows ?? [] }) : null;
      return { a, count: mine.length, len: totalLength(mine), p: trackProgress(mine), spent: t ? t.outPaid + t.outOwed : 0, earned: t ? t.inReceived + t.inOwed : 0 };
    }).sort((x, y) => {
      // Unreleased first, by release date (no date last), then title.
      const rx = isReleased(x.a) ? 1 : 0, ry = isReleased(y.a) ? 1 : 0;
      if (rx !== ry) return rx - ry;
      const dx = x.a.releaseDate ?? "￿", dy = y.a.releaseDate ?? "￿";
      return dx < dy ? -1 : dx > dy ? 1 : x.a.title.localeCompare(y.a.title);
    });
  }, [releases, tracks, admin, income.rows, expenses.rows, payouts.rows, projects.rows]);

  if (!loading && releases.length === 0) {
    return (
      <div data-testid="releases-empty">
        <WelcomeEmpty section="releases" title="No releases yet" hideable={false}
          body="Keep a record's tracks, mixes, artwork, costs and sales in one place. Start from a setlist you already have, or pick songs."
          actions={admin ? <Link href="/releases/new" className="btn acc" data-testid="start-release-btn">Start a release</Link> : undefined} />
      </div>
    );
  }

  return (
    <div className="grid gap-5" data-testid="releases-page">
      <PageTitle title="Releases" center actions={admin ? <Link href="/releases/new" className="btn acc" data-testid="add-release-btn">+ Add</Link> : undefined} />
      <div className="song-tw" data-testid="releases-list">
        <table className="song-table">
          <thead>
            <tr>
              <th scope="col">Release</th>
              <th scope="col">Progress</th>
              <th scope="col" className="len">Tracks</th>
              <th scope="col">Release</th>
              {admin && <th scope="col" className="len">Spent</th>}
              {admin && <th scope="col" className="len">Earned</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ a, count, len, p, spent, earned }) => (
              <tr key={a.id} data-testid={`release-row-${a.id}`}>
                <td>
                  <div className="flex items-center gap-3 py-2">
                    {a.cover?.url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={a.cover.url} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
                      : <span aria-hidden className="h-10 w-10 shrink-0 rounded-md border border-dashed bg-[var(--empty)]" />}
                    <span className="grid min-w-0">
                      <Link href={`/releases/${a.id}`} className="nm" data-testid="release-title">{a.title}</Link>
                      <span className="s">{RELEASE_KIND_LONG[a.kind]}</span>
                    </span>
                  </div>
                </td>
                <td className="whitespace-nowrap" data-testid="release-progress">{isReleased(a) ? <span className="pill ok">Released</span> : p.total ? `Tracked ${p.tracked}/${p.total} · Mixed ${p.mixed}/${p.total} · Mastered ${p.mastered}/${p.total}` : <span className="dash">No tracks yet</span>}</td>
                <td className="len whitespace-nowrap">{count}{len ? ` · ${fmtLen(len)}` : ""}</td>
                <td className="whitespace-nowrap">{a.releaseDate ? fmtRelease(a.releaseDate) : <span className="dash">Not set</span>}</td>
                {admin && <td className="len">{formatCents(spent)}</td>}
                {admin && <td className="len">{formatCents(earned)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {admin && <p className="s">Spent and Earned show for admins only.</p>}
    </div>
  );
}
