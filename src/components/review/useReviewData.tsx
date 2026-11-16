"use client";
import { useEffect, useMemo, useState } from "react";
import { useArtist } from "@/lib/artist";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { todayStr } from "@/lib/booking";
import { reviewYears, yearReview, type ReviewInput } from "@/lib/yearReview";
import type { Expense, Fan, Income, Musician, Payout, Pitch, Rehearsal, Release, ReleaseTrack, Setlist, Show, ShowDeal, Song, StatSnapshot, Tour, TourEntry } from "@/schema";
import type { Post } from "@/schema/posts";

const ms = (t: unknown) => (t && typeof (t as { toMillis?: unknown }).toMillis === "function" ? (t as { toMillis(): number }).toMillis() : undefined);

/** One tour's entries, handed up to the page (a hook can't loop over tours). Renders nothing. */
function TourEntriesFeed({ tourId, onRows }: { tourId: string; onRows(tourId: string, rows: Row<TourEntry>[]): void }) {
  const { rows } = useCollection<TourEntry>(`tours/${tourId}/entries`);
  useEffect(() => { if (rows) onRows(tourId, rows); }, [rows, tourId]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * Everything the Year in Review adds up, read live like the rest of the app. Admins only: income, deals, fans and pitches
 * are admin-only collections. `feeds` must be rendered (it holds the per-tour listeners).
 */
export function useReviewData(year: string) {
  const { artistId, doc: artist } = useArtist();
  const own = { where: [["artistId", "==", artistId] as [string, "==", string]] };
  const shows = useCollection<Show>("shows");
  const setlists = useCollection<Setlist>("setlists");
  const deals = useCollection<ShowDeal>("showDeals");
  const rehearsals = useCollection<Rehearsal>("rehearsals");
  const songs = useCollection<Song>("songs");
  const income = useCollection<Income>("income");
  const expenses = useCollection<Expense>("expenses");
  const payouts = useCollection<Payout>("payouts");
  const tours = useCollection<Tour>("tours", own);
  const releases = useCollection<Release>("releases", own);
  const tracks = useCollection<ReleaseTrack>("tracks", { group: true });
  const stats = useCollection<StatSnapshot>("statSnapshots");
  const fans = useCollection<Fan>("fans", own);
  const pitches = useCollection<Pitch>("pitches", own);
  const posts = useCollection<Post>("posts", own);
  const musicians = useCollection<Musician>("musicians");

  const [entries, setEntries] = useState<Record<string, Row<TourEntry>[]>>({});
  const onRows = (tourId: string, rows: Row<TourEntry>[]) => setEntries((m) => ({ ...m, [tourId]: rows }));
  const tourIds = (tours.rows ?? []).map((t) => t.id);
  const feeds = <>{tourIds.map((id) => <TourEntriesFeed key={id} tourId={id} onRows={onRows} />)}</>;

  // Fans, posts, releases and stats are extras: if one can't be read, the review still plays without it.
  const need = [shows, setlists, deals, rehearsals, songs, income, expenses, payouts, tours, musicians];
  const extra = [releases, tracks, stats, fans, pitches, posts];
  const error = need.find((c) => c.error)?.error ?? null;
  const loading = !artist || need.some((c) => c.rows === null) || extra.some((c) => c.rows === null && !c.error) || tourIds.some((id) => !entries[id]);

  const today = todayStr();
  const input = useMemo<Omit<ReviewInput, "year"> | null>(() => {
    if (loading || !artist) return null;
    return {
      today, artistId,
      shows: shows.rows!, setlists: setlists.rows!, deals: deals.rows!, rehearsals: rehearsals.rows!,
      songs: songs.rows!.map((s) => ({ id: s.id, title: s.title, status: s.status, createdMs: ms(s.createdAt) })),
      income: income.rows!, expenses: expenses.rows!, payouts: payouts.rows!,
      tours: tours.rows!, tourEntries: Object.values(entries).flat(),
      releases: releases.rows ?? [], tracks: tracks.rows ?? [], stats: stats.rows ?? [],
      fans: (fans.rows ?? []).map((f) => ({ artistId: f.artistId, cities: f.cities, createdMs: ms(f.createdAt) })),
      pitches: (pitches.rows ?? []).map((p) => ({ artistId: p.artistId, status: p.status, createdMs: ms(p.createdAt) })),
      posts: posts.rows ?? [], musicians: musicians.rows!, configurations: artist.configurations ?? [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, artist, today, artistId, entries, ...need.map((c) => c.rows), ...extra.map((c) => c.rows)]);

  const review = useMemo(() => (input ? yearReview({ ...input, year }) : null), [input, year]);
  const years = useMemo(() => (input ? reviewYears(input) : [today.slice(0, 4)]), [input, today]);
  return { review, years, loading, error, feeds };
}
