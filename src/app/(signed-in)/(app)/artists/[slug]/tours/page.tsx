"use client";
import Link, { useArtist } from "@/lib/artist";
import { useMemo, useState } from "react";
import { PageTitle } from "@/components/ui";
import { useProfile } from "@/lib/auth";
import { useCollection } from "@/lib/firestore-hooks";
import { todayStr } from "@/lib/booking";
import { formatCents } from "@/lib/money";
import { attentionText, fmtTourDates, tourFilterOf, type TourFilter } from "@/lib/tours";
import { actName, useTourSummaries, type TourRow, type TourSummary } from "@/components/tours/common";
import type { Tour } from "@/schema";

const FILTERS: [TourFilter, string][] = [["upcoming", "Upcoming"], ["ideas", "Ideas"], ["past", "Past"], ["all", "All"]];

/**
 * The band's tours: Upcoming / Ideas / Past / All and the act, then a row per tour with its counts from tours.summary.
 * Members read it too, without the admin-only columns (pitches, open dates and Net come from options and money they never see).
 */
export default function ToursPage() {
  const admin = useProfile().role === "admin";
  const { doc: artist, artistId } = useArtist();
  const tours = useCollection<Tour>("tours", { where: [["artistId", "==", artistId]] });
  const [filter, setFilter] = useState<TourFilter>("upcoming");
  const [act, setAct] = useState("");
  const today = todayStr();
  const rows = useMemo(() => {
    const list = (tours.rows ?? []) as TourRow[];
    const shown = list.filter((t) => (filter === "all" || tourFilterOf(t, today) === filter) && (!act || t.billedAs === act));
    // Soonest first, undated last; Past the other way round.
    const at = (t: TourRow) => t.startDate ?? t.endDate ?? "9999";
    return shown.sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : a.name.localeCompare(b.name)) * (filter === "past" ? -1 : 1));
  }, [tours.rows, filter, act, today]);
  const summaries = useTourSummaries(rows);

  return (
    <div className="grid gap-5" data-testid="tours-page">
      <PageTitle title="Tours" center actions={admin ? <Link href="/tours/new" className="btn acc" data-testid="new-tour">+ New tour</Link> : undefined} />
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="seg" role="radiogroup" aria-label="Which tours">
          {FILTERS.map(([k, l]) => <label key={k}><input type="radio" name="tours-filter" checked={filter === k} onChange={() => setFilter(k)} data-testid={`tours-filter-${k}`} />{l}</label>)}
        </div>
        <select className="select !w-auto" aria-label="Act" value={act} onChange={(e) => setAct(e.target.value)} data-testid="tours-act">
          <option value="">All acts</option>
          {artist?.configurations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="song-tw" data-testid="tours-list">
        <table className="song-table">
          <thead>
            <tr>
              <th scope="col">Tour</th>
              <th scope="col">Dates</th>
              <th scope="col" className="len">Shows</th>
              {admin && <th scope="col" className="len">Open dates</th>}
              {admin && <th scope="col" className="len">Pitches</th>}
              <th scope="col">Needs attention</th>
              {admin && <th scope="col" className="len">Net</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => <TourLine key={t.id} t={t} s={summaries[t.id]} admin={admin} act={actName(artist, t.billedAs)} />)}
            {!tours.loading && rows.length === 0 && (
              <tr><td colSpan={admin ? 7 : 4} className="d-muted" data-testid="tours-empty">No tours here.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TourLine({ t, s, admin, act }: { t: TourRow; s?: TourSummary; admin: boolean; act?: string }) {
  const entries = s ? [...s.days.flatMap((d) => d.entries), ...(s.bucket ?? [])] : [];
  const shows = entries.filter((e) => e.kind === "show").length;
  const pitches = new Set(entries.filter((e) => e.kind === "option").map((e) => e.pitchId)).size;
  const open = s?.warnings.filter((w) => w.kind === "openDate").length ?? 0;
  const attention = s ? attentionText(s.warnings) : "";
  const people = t.personnel.length ? `${t.personnel.length} ${t.personnel.length === 1 ? "person" : "people"}` : "party not set";
  const n = (v: number) => (s ? v : "");
  return (
    <tr data-testid={`tour-row-${t.id}`}>
      <td>
        <span className="grid py-2">
          <Link href={`/tours/${t.id}`} className="nm" data-testid="tour-name">{t.name}</Link>
          <span className="s">{[act, people].filter(Boolean).join(" · ")}</span>
        </span>
      </td>
      <td className={`whitespace-nowrap${t.startDate || t.endDate ? "" : " d-muted"}`}>{fmtTourDates(t.startDate, t.endDate)}</td>
      <td className="len" data-testid="tour-shows">{n(shows)}</td>
      {admin && <td className="len">{n(open)}</td>}
      {admin && <td className="len" data-testid="tour-pitches">{n(pitches)}</td>}
      <td className={attention ? "font-semibold text-[var(--warn)]" : "d-muted"} data-testid="tour-attention">
        {!s ? "" : attention || (s.days.length ? "All set" : "Bucket only")}
      </td>
      {admin && <td className="len" data-testid="tour-net">{s?.totals ? formatCents(s.totals.net) : ""}</td>}
    </tr>
  );
}
