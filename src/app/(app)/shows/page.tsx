"use client";
import Link from "next/link";
import { useState } from "react";
import { useProfile } from "@/lib/auth";
import { PageTitle } from "@/components/ui";
import { todayStr } from "@/lib/booking";
import { SHOW_FILTERS, SHOW_FILTER_LABEL, showFilter, type ShowFilter } from "@/lib/shows";
import { Seg } from "@/components/booking/common";
import { ShowRowLink, useBand } from "@/components/shows/common";
import { WelcomeEmpty } from "@/components/WelcomeEmpty";

const EMPTY: Record<ShowFilter, string> = { upcoming: "No shows coming up.", played: "Nothing yet.", canceled: "No canceled shows.", dropped: "No dropped holds." };

export default function Shows() {
  const p = useProfile();
  const b = useBand();
  const [filter, setFilter] = useState<ShowFilter>("upcoming");
  const today = todayStr();
  const count = (f: ShowFilter) => b.shows.filter((s) => showFilter(s, today) === f).length;
  // Upcoming soonest first; the rest most recent first.
  const shown = b.shows.filter((s) => showFilter(s, today) === filter)
    .sort((a, c) => (filter === "upcoming" ? a.date.localeCompare(c.date) : c.date.localeCompare(a.date)));
  const note = (s: { personnel: string[] }) => (p.musicianId ? <span className={`chip ${s.personnel.includes(p.musicianId) ? "m" : ""}`}>{s.personnel.includes(p.musicianId) ? "Playing" : "Not playing"}</span> : null);
  // No shows at all: only the welcome card, no filter or list.
  if (!b.loading && b.shows.length === 0) {
    return (
      <WelcomeEmpty section="shows" variant={1} title="Welcome to Shows!"
        body={p.role === "admin"
          ? "Every gig lives here: dates, venues, who's playing, set times and what you got paid. Add your next show and it can go straight onto the band calendar."
          : "Every gig lives here: dates, venues, who's playing and set times. Once the band books one, it'll show up here."}
        actions={p.role === "admin" ? <Link href="/shows/new" className="btn acc" data-testid="new-show-btn">New show</Link> : undefined} />
    );
  }
  return (
    <div className="grid gap-3" data-testid="shows-page">
      <PageTitle title="Shows" sub={p.role === "admin" ? "Upcoming, played, canceled and dropped." : "The band's shows."} />
      {p.role === "admin" && <Link href="/shows/new" className="btn acc justify-self-start" data-testid="new-show-btn">New show</Link>}
      <Seg<ShowFilter> testid="shows-filter" value={filter} onChange={setFilter}
        options={SHOW_FILTERS.map((f) => [f, b.loading ? SHOW_FILTER_LABEL[f] : `${SHOW_FILTER_LABEL[f]} · ${count(f)}`])} />
      <div className="grid gap-2" data-testid={`shows-${filter}`}>
        {!b.loading && shown.length === 0 && <span className="s">{EMPTY[filter]}</span>}
        {shown.map((s) => <ShowRowLink key={s.id} show={s} artist={b.artist} note={filter === "upcoming" ? note(s) : undefined} />)}
      </div>
    </div>
  );
}
