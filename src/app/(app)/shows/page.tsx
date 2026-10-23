"use client";
import Link from "next/link";
import { useProfile } from "@/lib/auth";
import { PageTitle } from "@/components/ui";
import { todayStr } from "@/lib/booking";
import { ShowRowLink, useBand } from "@/components/shows/common";

export default function Shows() {
  const p = useProfile();
  const b = useBand();
  const today = todayStr();
  const live = b.shows.filter((s) => s.status !== "canceled");
  const upcoming = live.filter((s) => s.date >= today && s.status !== "played").sort((a, c) => a.date.localeCompare(c.date));
  const past = b.shows.filter((s) => !upcoming.includes(s)).sort((a, c) => c.date.localeCompare(a.date));
  const note = (s: { personnel: string[] }) => (p.musicianId ? <span className={`chip ${s.personnel.includes(p.musicianId) ? "m" : ""}`}>{s.personnel.includes(p.musicianId) ? "Playing" : "Not playing"}</span> : null);
  return (
    <div className="grid gap-3" data-testid="shows-page">
      <PageTitle title="Shows" sub={p.role === "admin" ? "Upcoming and past." : "Your upcoming shows."} />
      {p.role === "admin" && <Link href="/shows/new" className="btn acc justify-self-start" data-testid="new-show-btn">New show</Link>}
      <span className="lbl">Upcoming</span>
      <div className="grid gap-2" data-testid="shows-upcoming">
        {!b.loading && upcoming.length === 0 && <span className="s">No shows coming up.</span>}
        {upcoming.map((s) => <ShowRowLink key={s.id} show={s} artist={b.artist} note={note(s)} />)}
      </div>
      <span className="lbl">Past</span>
      <div className="grid gap-2" data-testid="shows-past">
        {!b.loading && past.length === 0 && <span className="s">Nothing yet.</span>}
        {past.map((s) => <ShowRowLink key={s.id} show={s} artist={b.artist} note={note(s)} />)}
      </div>
    </div>
  );
}
