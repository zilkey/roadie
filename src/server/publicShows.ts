/**
 * The band's upcoming shows for its own website (the JSON endpoint, the iframe page and the script all read this).
 * Same rule as Bandsintown: published and confirmed (bandsintownEligible), so holds, private, canceled and dropped shows
 * never appear. Only public fields leave: no deal, notes, personnel, host name or street address.
 */
import { db, type Doc } from "./db";
import { AppError } from "./errors";
import { bandsintownEligible } from "./showSync";
import { publicShowName, showCity, type ShowPlaceLike } from "@/lib/shows";
import { BAND_TIME_ZONE, dateInBandZone } from "@/lib/timezone";

export interface PublicShow {
  id: string;
  /** YYYY-MM-DD, the venue's calendar day. */
  date: string;
  /** Local start time at the venue ("20:00"): showStart, else set, else doors. Null when none is set. */
  time: string | null;
  timeZone: string;
  venue: string;
  city: string | null;
  /** The billing name for the lineup playing ("Ingrid Avison Duo"); the artist's name when no lineup is set. */
  billedAs: string;
  ticketUrl: string | null;
}
export interface PublicShows {
  artist: { name: string; slug: string };
  shows: PublicShow[];
  /** The fan signup page for the empty state; null when the band's list is off. */
  joinUrl: string | null;
}

/** An https link only: the ticket link goes into an href on someone else's site. */
const safeUrl = (u: unknown) => (typeof u === "string" && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

/** Pure: the public shape of an artist's shows. `config` keeps only shows billed as that lineup (a configuration id). */
export function publicShowList(
  artist: Doc, shows: Doc[], opts: { today: string; config?: string; zones?: Map<string, string>; cities?: Map<string, string>; limit?: number },
): PublicShow[] {
  const configs = (artist.configurations as { id: string; billingName: string }[] | undefined) ?? [];
  return shows
    .filter((s) => !s.deletedAt && bandsintownEligible(s) && (s.date as string) >= opts.today && (!opts.config || s.billedAs === opts.config))
    .sort((a, b) => (a.date as string).localeCompare(b.date as string) || ((a.times?.set as string) ?? "").localeCompare((b.times?.set as string) ?? ""))
    .slice(0, opts.limit ?? 50)
    .map((s) => {
      const t = (s.times ?? {}) as { showStart?: string; set?: string; doors?: string };
      return {
        id: s.id as string, date: s.date as string, time: t.showStart ?? t.set ?? t.doors ?? null,
        timeZone: opts.zones?.get(s.venue?.id) ?? BAND_TIME_ZONE,
        venue: publicShowName(s as unknown as ShowPlaceLike),
        city: showCity(s as unknown as ShowPlaceLike) ?? opts.cities?.get(s.venue?.id) ?? null,
        billedAs: configs.find((c) => c.id === s.billedAs)?.billingName ?? (artist.name as string),
        ticketUrl: safeUrl(s.ticketUrl),
      };
    });
}

/** By URL slug. The same 404 for no such band. */
export async function publicShows(slug: string, opts: { config?: string; now?: Date } = {}): Promise<PublicShows> {
  const [artist] = await db.list("artists", (q) => q.where("slug", "==", slug).limit(1));
  if (!artist || artist.deletedAt) throw new AppError("not_found", "Not found", 404);
  const docs = await db.list("shows", (q) => q.where("artistId", "==", artist.id));
  const venues = await Promise.all([...new Set(docs.map((s) => s.venue?.id as string | undefined).filter((x): x is string => !!x))].map((id) => db.get("venues", id)));
  const zones = new Map<string, string>(), cities = new Map<string, string>();
  for (const v of venues) {
    if (!v) continue;
    if (typeof v.timeZone === "string" && v.timeZone) zones.set(v.id, v.timeZone);
    if (v.address?.city) cities.set(v.id, v.address.city as string);
  }
  const today = dateInBandZone(opts.now);
  const shows = publicShowList(artist, docs, { today, config: opts.config, zones, cities });
  const features = artist.features as { fans?: boolean } | undefined;
  return { artist: { name: artist.name as string, slug }, shows, joinUrl: features?.fans === true ? `/f/${encodeURIComponent(slug)}` : null };
}
