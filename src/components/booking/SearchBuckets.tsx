"use client";
import Link from "@/lib/artist";
import { useMemo } from "react";
import { ErrorBox } from "@/components/ui";
import { useBooking } from "@/components/booking/common";
import { BookingTable, type Seg } from "@/components/booking/BookingIndex";
import { listRows } from "@/components/booking/listRows";
import type { PitchTarget } from "@/components/booking/PitchModal";
import { ActsTable, useActChoices, useActsData } from "@/components/booking/ActsTab";
import { buildSearchItems, searchItems } from "@/lib/booking";

/** An act matches when every word of the search is in its name or hometown, as the other kinds match their haystacks. */
const actHit = (a: { name: string; hometown?: string }, q: string) => {
  const h = `${a.name} ${a.hometown ?? ""}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => h.includes(w));
};

const BUCKETS: { seg: Exclude<Seg, "pitches">; title: string; all: string }[] = [
  { seg: "venues", title: "Venues", all: "All venues" },
  { seg: "festivals", title: "Festivals & series", all: "All festivals" },
  { seg: "promoters", title: "Promoters", all: "All promoters" },
  { seg: "contacts", title: "Contacts", all: "All contacts" },
];

/**
 * What a search shows in place of the tab: a section per kind that matched, a plain heading over its table. Acts come after
 * promoters, with their own table (Watch, Not a fit and the take dropdown work here too; a Not a fit act stays, as it was searched for).
 */
export function SearchBuckets({ q, ours, onFlag, onLeave }: { q: string; ours: Set<string>; onFlag(t: PitchTarget): void; onLeave(): void }) {
  const b = useBooking();
  const buckets = useMemo(() => {
    const hit = new Set(searchItems(buildSearchItems(b), q).map((i) => `${i.kind}:${i.id}`));
    return BUCKETS.map((k) => ({ ...k, rows: listRows(b, k.seg, ours, hit) })).filter((k) => k.rows.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.venues, b.promoters, b.festivals, b.editions, b.contacts, b.pitches, ours, q]);
  const acts = useActsData();
  const choices = useActChoices(acts.takes);
  const actRows = useMemo(() => acts.acts.filter((a) => actHit(a, q)).sort((x, y) => x.name.localeCompare(y.name)), [acts.acts, q]);
  if (b.loading) return <span className="s">Loading…</span>;
  const shownActs = actRows; // the rows show as soon as the acts load; Seen at and Next show fill in when acts.find answers
  const total = buckets.reduce((n, k) => n + k.rows.length, 0) + shownActs.length;
  const before = buckets.filter((k) => k.seg !== "contacts"), after = buckets.filter((k) => k.seg === "contacts");
  const section = (k: (typeof buckets)[number]) => (
    // No card around a bucket (Jeff, 2026-11-12: no box inside a box): the heading sits on the page, the table is the only container.
    <section key={k.seg} className="grid min-w-0 gap-2" data-testid={`bucket-${k.seg}`}>
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-bold">{k.title}</h2>
        <span className="chip a" data-testid={`bucket-count-${k.seg}`}>{k.rows.length}</span>
        <Link href={k.seg === "contacts" ? "/contacts" : `/booking/${k.seg}`} onClick={onLeave} className="s ml-auto" data-testid={`bucket-all-${k.seg}`}>{k.all}</Link>
      </header>
      <div className="book-tw"><BookingTable seg={k.seg} rows={k.rows} onFlag={onFlag} q={q} compact /></div>
    </section>
  );
  if (!total && acts.loading) return <span className="s">Loading…</span>;
  if (!total) return <div className="empty" data-testid="no-results"><span>Nothing matches.</span></div>;
  return (
    <div className="grid min-w-0 gap-4" data-testid="search-buckets">
      <p className="s" data-testid="search-summary">{total} {total === 1 ? "result" : "results"} for &ldquo;{q.trim()}&rdquo; · flag anything to add it to the Pitch List</p>
      {before.map(section)}
      {shownActs.length > 0 && (
        <section className="grid min-w-0 gap-2" data-testid="bucket-acts">
          <header className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold">Acts</h2>
            <span className="chip a" data-testid="bucket-count-acts">{shownActs.length}</span>
            <Link href={`/booking/acts?show=all&find=${encodeURIComponent(q.trim())}`} onClick={onLeave} className="s ml-auto" data-testid="bucket-all-acts">All acts</Link>
          </header>
          <ErrorBox error={acts.error ?? choices.error} />
          <ActsTable rows={shownActs} found={acts.found} takes={acts.takes} choices={choices} compact />
        </section>
      )}
      {after.map(section)}
    </div>
  );
}
