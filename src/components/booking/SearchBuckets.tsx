"use client";
import Link from "@/lib/artist";
import { useMemo } from "react";
import { useBooking } from "@/components/booking/common";
import { BookingTable, type Seg } from "@/components/booking/BookingIndex";
import { listRows } from "@/components/booking/listRows";
import type { PitchTarget } from "@/components/booking/PitchModal";
import { buildSearchItems, searchItems } from "@/lib/booking";

const BUCKETS: { seg: Exclude<Seg, "pitches">; title: string; all: string }[] = [
  { seg: "venues", title: "Venues", all: "All venues" },
  { seg: "festivals", title: "Festivals & series", all: "All festivals" },
  { seg: "promoters", title: "Promoters", all: "All promoters" },
  { seg: "contacts", title: "Contacts", all: "All contacts" },
];

/** What a search shows in place of the tab: one card per kind that matched. */
export function SearchBuckets({ q, ours, onFlag, onLeave }: { q: string; ours: Set<string>; onFlag(t: PitchTarget): void; onLeave(): void }) {
  const b = useBooking();
  const buckets = useMemo(() => {
    const hit = new Set(searchItems(buildSearchItems(b), q).map((i) => `${i.kind}:${i.id}`));
    return BUCKETS.map((k) => ({ ...k, rows: listRows(b, k.seg, ours, hit) })).filter((k) => k.rows.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.venues, b.promoters, b.festivals, b.editions, b.contacts, b.pitches, ours, q]);
  if (b.loading) return <span className="s">Loading…</span>;
  const total = buckets.reduce((n, k) => n + k.rows.length, 0);
  if (!total) return <div className="empty" data-testid="no-results"><span>Nothing matches.</span></div>;
  return (
    <div className="grid min-w-0 gap-4" data-testid="search-buckets">
      <p className="s" data-testid="search-summary">{total} {total === 1 ? "result" : "results"} for &ldquo;{q.trim()}&rdquo; · flag anything to add it to the Pitch List</p>
      {buckets.map((k) => (
        <section key={k.seg} className="card grid min-w-0 gap-2" data-testid={`bucket-${k.seg}`}>
          <header className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{k.title}</h2>
            <span className="chip a" data-testid={`bucket-count-${k.seg}`}>{k.rows.length}</span>
            <Link href={`/booking/${k.seg}`} onClick={onLeave} className="s ml-auto" data-testid={`bucket-all-${k.seg}`}>{k.all}</Link>
          </header>
          <div className="book-tw"><BookingTable seg={k.seg} rows={k.rows} onFlag={onFlag} q={q} compact /></div>
        </section>
      ))}
    </div>
  );
}
