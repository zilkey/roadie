"use client";
import Link from "@/lib/artist";
import { useMemo } from "react";
import { PageTitle } from "@/components/ui";
import { useProfile } from "@/lib/auth";
import { useCollection } from "@/lib/firestore-hooks";
import { fmtLen } from "@/lib/music";
import { ALBUM_KIND_LONG, totalLength } from "@/lib/albums";
import { defaultProject, formatCents, projectTotals } from "@/lib/money";
import { StatusPill, useAlbums } from "@/components/albums/common";
import { WelcomeEmpty } from "@/components/WelcomeEmpty";
import type { Expense, Income, Payout, Project } from "@/schema";

/** "Mar 6, 2027". */
const fmtRelease = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function AlbumsPage() {
  const admin = useProfile().role === "admin";
  const { albums, tracks, loading } = useAlbums();
  // Money is admins-only: members never read it.
  const income = useCollection<Income>("income", { skip: !admin });
  const expenses = useCollection<Expense>("expenses", { skip: !admin });
  const payouts = useCollection<Payout>("payouts", { skip: !admin });
  const projects = useCollection<Project>("projects", { skip: !admin });

  const rows = useMemo(() => {
    const def = defaultProject(projects.rows ?? [])?.id;
    return albums.map((a) => {
      const mine = tracks.filter((t) => t.albumId === a.id);
      const t = admin ? projectTotals({ projectId: a.projectId, defaultProjectId: def, income: income.rows ?? [], expenses: expenses.rows ?? [], payouts: payouts.rows ?? [] }) : null;
      return { a, count: mine.length, len: totalLength(mine), spent: t ? t.outPaid + t.outOwed : 0, earned: t ? t.inReceived + t.inOwed : 0 };
    }).sort((x, y) => {
      // Unreleased first, by release date (no date last), then title.
      const rx = x.a.status === "released" ? 1 : 0, ry = y.a.status === "released" ? 1 : 0;
      if (rx !== ry) return rx - ry;
      const dx = x.a.releaseDate ?? "￿", dy = y.a.releaseDate ?? "￿";
      return dx < dy ? -1 : dx > dy ? 1 : x.a.title.localeCompare(y.a.title);
    });
  }, [albums, tracks, admin, income.rows, expenses.rows, payouts.rows, projects.rows]);

  if (!loading && albums.length === 0) {
    return (
      <div data-testid="albums-empty">
        <WelcomeEmpty section="albums" title="No albums yet" hideable={false}
          body="Keep a record's tracks, mixes, artwork, costs and sales in one place. Start from a setlist you already have, or pick songs."
          actions={admin ? <Link href="/albums/new" className="btn acc" data-testid="start-album-btn">Start an album</Link> : undefined} />
      </div>
    );
  }

  return (
    <div className="grid gap-5" data-testid="albums-page">
      <PageTitle title="Albums" center actions={admin ? <Link href="/albums/new" className="btn acc" data-testid="add-album-btn">+ Add</Link> : undefined} />
      <div className="song-tw" data-testid="albums-list">
        <table className="song-table">
          <thead>
            <tr>
              <th scope="col">Album</th>
              <th scope="col">Status</th>
              <th scope="col" className="len">Tracks</th>
              <th scope="col">Release</th>
              {admin && <th scope="col" className="len">Spent</th>}
              {admin && <th scope="col" className="len">Earned</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ a, count, len, spent, earned }) => (
              <tr key={a.id} data-testid={`album-row-${a.id}`}>
                <td>
                  <div className="flex items-center gap-3 py-2">
                    {a.cover?.url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={a.cover.url} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
                      : <span aria-hidden className="h-10 w-10 shrink-0 rounded-md border border-dashed bg-[var(--empty)]" />}
                    <span className="grid min-w-0">
                      <Link href={`/albums/${a.id}`} className="nm" data-testid="album-title">{a.title}</Link>
                      <span className="s">{ALBUM_KIND_LONG[a.kind]}</span>
                    </span>
                  </div>
                </td>
                <td><StatusPill status={a.status} testid="album-status" /></td>
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
