"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { useFanCounts, useFanList, useFansOn } from "@/lib/fans-client";
import { PageTitle } from "@/components/ui";
import { AddFan } from "./AddFan";
import { BandzoogleDialog } from "./BandzoogleDialog";
import { FanList } from "./FanList";

function Tile({ label, value, testid, note }: { label: string; value: number | string; testid: string; note?: string }) {
  return (
    <div className="card" style={{ gap: 2 }}>
      <span className="lbl">{label}</span>
      <b className="text-3xl" data-testid={testid}>{value}</b>
      {note && <span className="s">{note}</span>}
    </div>
  );
}

/** A label, a bar scaled to the biggest row, and the count. */
function Bars({ rows, testid, empty }: { rows: { key: string; label: string; count: number }[]; testid: string; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="card flush m-0 list-none p-0" data-testid={testid}>
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-3 border-b border-divider px-5 py-2.5 last:border-b-0" data-testid={`${testid}-row`}>
          <span className="min-w-0 flex-1 truncate" data-testid={`${testid}-label`}>{r.label}</span>
          <span className="hidden h-2 w-40 overflow-hidden rounded-full bg-divider sm:block" aria-hidden><span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${(r.count / max) * 100}%` }} /></span>
          <b className="w-10 text-right" data-testid={`${testid}-count`}>{r.count}</b>
        </li>
      ))}
      {!rows.length && <li className="s px-5 py-3">{empty}</li>}
    </ul>
  );
}

/** Fans (story 31): counts for everyone in the band; for admins also the list, "Add a fan" and "Send to Bandzoogle". */
export function FansPage() {
  const artist = useArtist();
  const admin = artist.role === "admin";
  const on = useFansOn();
  const router = useRouter();
  const sp = useSearchParams();
  const counts = useFanCounts();
  const fans = useFanList(admin);
  const [adding, setAdding] = useState(false);
  const openAdd = useCallback(() => setAdding(true), []);
  const [bz, setBz] = useState(false);
  // The show page's banner links here with ?bandzoogle=1.
  useEffect(() => { if (admin && sp.get("bandzoogle") === "1") setBz(true); }, [admin, sp]);
  const closeBz = () => { setBz(false); if (sp.get("bandzoogle")) router.replace("/fans"); };

  const showLabels = useMemo(() => new Map((counts?.byShow ?? []).map((s) => [s.showId, s.label])), [counts]);
  if (!artist.doc) return null;
  if (!on) {
    return (
      <div className="grid gap-5">
        <PageTitle title="Fans" />
        <div className="card" data-testid="fans-off"><span className="s">Fans is turned off for this band.{admin ? " An admin can turn it on in Artist settings." : ""}</span></div>
      </div>
    );
  }
  const cities = Object.entries(counts?.byCity ?? {}).map(([c, n]) => ({ key: c, label: c, count: n }));
  const perShow = counts?.byShow.length ? Math.round((counts.byShow.reduce((n, s) => n + s.count, 0) / counts.byShow.length) * 10) / 10 : 0;
  return (
    <div className="grid gap-5" data-testid="fans-page">
      <PageTitle title="Fans" sub={admin ? undefined : "Counts only. Admins see the addresses."} actions={admin && (
        <>
          <button type="button" className="btn outline" onClick={() => setAdding((a) => !a)} data-testid="fan-add">Add a fan</button>
          <button type="button" className="btn acc" onClick={() => setBz(true)} data-testid="bandzoogle-open">Send to Bandzoogle{counts ? ` · ${counts.notInBandzoogle}` : ""}</button>
        </>
      )} />
      {admin && <AddFan open={adding} onOpen={openAdd} onClose={() => setAdding(false)} />}
      {!counts ? <span className="s">Loading…</span> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Fans" value={counts.total} testid="fans-total" />
            <Tile label="Cities" value={cities.filter((c) => c.key !== "No city").length} testid="fans-cities" />
            <Tile label="Signups per show" value={perShow} testid="fans-per-show" />
            <Tile label="Not in Bandzoogle yet" value={counts.notInBandzoogle} testid="fans-not-synced" />
          </div>
          <section className="grid gap-2"><h2 className="text-lg font-bold">By city</h2>
            <Bars rows={cities} testid="fans-by-city" empty="No fans yet." /></section>
          <section className="grid gap-2"><h2 className="text-lg font-bold">By show</h2>
            <Bars rows={counts.byShow.map((s) => ({ key: s.showId, label: s.label, count: s.count }))} testid="fans-by-show" empty="No fans have signed up at a show yet." /></section>
        </>
      )}
      {admin && fans && <section className="grid gap-2"><h2 className="text-lg font-bold">Everyone on the list</h2><FanList fans={fans} showLabels={showLabels} /></section>}
      {admin && <BandzoogleDialog open={bz} onClose={closeBz} />}
    </div>
  );
}
