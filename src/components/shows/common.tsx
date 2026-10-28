"use client";
import Link, { useArtist } from "@/lib/artist";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { useProfile } from "@/lib/auth";
import { fmtDuration, setLengthOf } from "@/lib/duration";
import { fmtLong, fmtTime, showName, showCity } from "@/lib/shows";
import type { Show, Artist, Musician, Setlist, Availability } from "@/schema";

export type ShowRow = Row<Show>;

/** Everything a show screen needs that the whole band can read. */
export function useBand() {
  const p = useProfile();
  const shows = useCollection<Show>("shows");
  const musicians = useCollection<Musician>("musicians");
  const { doc: artist } = useArtist();
  const setlists = useCollection<Setlist>("setlists");
  // Rules only let a member read asks they are on, so a member's query must say so.
  const asks = useCollection<Availability>("availability", {
    where: p.role === "member" ? [["askedMusicianIds", "array-contains", p.musicianId ?? "none"]] : [],
  });
  return {
    shows: shows.rows ?? [], musicians: musicians.rows ?? [], artist: artist ?? undefined, setlists: setlists.rows ?? [], asks: asks.rows ?? [],
    loading: [shows, musicians, setlists, asks].some((c) => c.loading) || !artist,
  };
}

export const STATUS_CHIP: Record<string, [string, string]> = {
  hold: ["Hold", "a"], confirmed: ["Confirmed", "g"], played: ["Played", ""], canceled: ["Canceled", ""], dropped: ["Dropped", ""],
};
export function ShowStatusChip({ status }: { status: string }) {
  const [l, c] = STATUS_CHIP[status] ?? [status, ""];
  return <span className={`chip ${c}`} data-testid="show-status">{l}</span>;
}

/** The status pill beside a show's title: green for confirmed, plain otherwise. */
export function ShowStatusPill({ status }: { status: string }) {
  const [l] = STATUS_CHIP[status] ?? [status];
  return <span className={`pill${status === "confirmed" ? " ok" : ""}`} data-testid="show-status">{l}</span>;
}

export function Times({ times }: { times: Show["times"] }) {
  const items = [["Load in", times.loadIn], ["Check", times.soundcheck], ["Doors", times.doors], ["Show", times.showStart], ["Set", times.set]].filter(([, t]) => t) as [string, string][];
  const len = setLengthOf(times);
  if (!items.length) return <span className="s">Times not set yet.</span>;
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1" data-testid="times">
      {items.map(([l, t]) => <span key={l} className="grid"><b className="font-mono text-[0.9375rem]">{fmtTime(t)}</b><span className="s">{l}</span></span>)}
      {len ? <span className="grid"><b className="font-mono text-[0.9375rem]">{fmtDuration(len)}</b><span className="s">Length</span></span> : null}
    </div>
  );
}

export const configName = (a: Row<Artist> | undefined, id?: string) => a?.configurations.find((c) => c.id === id)?.name;
export const billingName = (a: Row<Artist> | undefined, id?: string) => a?.configurations.find((c) => c.id === id)?.billingName ?? a?.name;
export const nameOf = (ms: Row<Musician>[], id?: string) => ms.find((m) => m.id === id)?.name ?? "Someone";

/** Shows matching one Firestore filter (a venue's, a festival year's, a host's), newest first, as links. */
export function ShowLinks({ where, empty, testid }: { where: [string, "==" | "array-contains", string]; empty: string; testid?: string }) {
  const shows = useCollection<Show>("shows", { where: [where] });
  const rows = [...(shows.rows ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  if (shows.loading) return null;
  if (!rows.length) return <span className="s">{empty}</span>;
  return (
    <div className="grid gap-2" data-testid={testid}>
      {rows.map((s) => (
        <Link key={s.id} href={`/shows/${s.id}`} className="card">
          <b>{fmtLong(s.date)} {s.date.slice(0, 4)} · {showName(s)}</b><span className="s">{[showCity(s), STATUS_CHIP[s.status]?.[0]].filter(Boolean).join(" · ")}</span>
        </Link>
      ))}
    </div>
  );
}
