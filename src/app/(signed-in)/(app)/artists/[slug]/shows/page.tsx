"use client";
import Link, { useArtist } from "@/lib/artist";
import { useEffect, useRef, useState } from "react";
import { useProfile } from "@/lib/auth";
import { PageTitle } from "@/components/ui";
import { todayStr } from "@/lib/booking";
import { MEMBER_SHOW_FILTERS, SHOW_FILTERS, SHOW_FILTER_LABEL, showTabFor, type ShowFilter } from "@/lib/shows";
import { Tabs } from "@/components/booking/common";
import { useBand } from "@/components/shows/common";
import { ShowTable } from "@/components/shows/ShowTables";
import { WelcomeEmpty } from "@/components/WelcomeEmpty";

const fromHash = (filters: readonly ShowFilter[]): ShowFilter => {
  const h = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  return (filters as readonly string[]).includes(h) ? (h as ShowFilter) : "upcoming";
};

export default function Shows() {
  const p = useProfile();
  const b = useBand();
  const showFields = useArtist().doc?.showFields;
  const member = p.role === "member";
  const filters = member ? MEMBER_SHOW_FILTERS : SHOW_FILTERS;
  // The tab lives in the URL hash (#played...) so it survives a reload; each tab keeps its own scroll position.
  const [filter, setFilter] = useState<ShowFilter>("upcoming");
  const scrolls = useRef<Partial<Record<ShowFilter, number>>>({});
  useEffect(() => {
    const sync = () => setFilter(fromHash(filters));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [filters]);
  useEffect(() => { window.scrollTo(0, scrolls.current[filter] ?? 0); }, [filter]);
  function pick(f: ShowFilter) {
    scrolls.current[filter] = window.scrollY;
    window.history.replaceState(null, "", `#${f}`);
    setFilter(f);
  }
  const today = todayStr();
  const inTab = (s: (typeof b.shows)[number], f: ShowFilter) => showTabFor(s, today, member ? p : null) === f;
  const count = (f: ShowFilter) => b.shows.filter((s) => inTab(s, f)).length;
  // Upcoming soonest first; the rest most recent first.
  const shown = b.shows.filter((s) => inTab(s, filter))
    .sort((a, c) => (filter === "upcoming" ? a.date.localeCompare(c.date) : c.date.localeCompare(a.date)));
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
    <div className="grid gap-5" data-testid="shows-page">
      <PageTitle title="Shows" center
        actions={p.role === "admin" ? <Link href="/shows/new" className="btn acc" data-testid="new-show-btn">New show</Link> : undefined} />
      <Tabs<ShowFilter> testid="shows-filter" value={filter} onChange={pick}
        options={filters.map((f) => [f, b.loading ? SHOW_FILTER_LABEL[f] : `${SHOW_FILTER_LABEL[f]} · ${count(f)}`])} />
      {!b.loading && <ShowTable tab={filter} shows={shown} setlists={b.setlists} admin={p.role === "admin"} fields={showFields ?? []} />}
    </div>
  );
}
