/** Pure fan-list logic shared by the server and (later) the pages: city labels, merging, distance. No server or browser imports. */

export const DEFAULT_LIST_WORDING = "Email me about shows and new music. You can unsubscribe at any time.";
/** The group name for fans with no city (Bandzoogle, Answer 10). */
export const NO_CITY = "No city";

export interface CityLike { city: string; state?: string; lat?: number; lng?: number }

/** "Boise, ID", or just "Boise" with no state. */
export const cityLabel = (c: { city: string; state?: string }) => (c.state ? `${c.city}, ${c.state.toUpperCase()}` : c.city);

/** A city typed entirely in lowercase gets each word capitalised ("salt lake city" -> "Salt Lake City"); mixed case is left alone. */
export const titleCity = (c: string) => (c === c.toLowerCase() ? c.replace(/(^|\s)(\S)/g, (_, sp, ch) => sp + ch.toUpperCase()) : c);

/** "Boise, ID" typed in one box -> {city, state}; anything else stays a plain city. The city is title-cased if typed all lowercase, the state uppercased. */
export function parseCity(text: string): { city: string; state?: string } {
  const t = text.replace(/\s+/g, " ").trim();
  const m = /^(.+?)\s*,\s*([A-Za-z]{2})$/.exec(t);
  return m ? { city: titleCity(m[1].trim()), state: m[2].toUpperCase() } : { city: titleCity(t) };
}

const same = (a: string | undefined, b: string | undefined) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
/** The same place: equal city names (any case), and equal states unless one side has none. */
export const sameCity = (a: CityLike, b: CityLike) => same(a.city, b.city) && (!a.state || !b.state || same(a.state, b.state));

/**
 * Add `incoming` cities to `existing`, case-insensitively deduped. A place seen again fills the gaps (state, coordinates) and moves
 * to the end, because the last city is the fan's most recent one.
 */
export function mergeCities(existing: CityLike[], incoming: CityLike[]): CityLike[] {
  const out = existing.map((c) => ({ ...c }));
  for (const n of incoming) {
    const i = out.findIndex((c) => sameCity(c, n));
    if (i < 0) { out.push({ ...n }); continue; }
    const [old] = out.splice(i, 1);
    out.push({
      city: old.city, ...((old.state ?? n.state) ? { state: old.state ?? n.state } : {}),
      ...((old.lat ?? n.lat) !== undefined && (old.lng ?? n.lng) !== undefined ? { lat: old.lat ?? n.lat, lng: old.lng ?? n.lng } : {}),
    });
  }
  return out;
}

/** The Bandzoogle group of a fan: their most recent city as "City, ST", or "No city". */
export const groupOf = (cities: CityLike[]) => (cities.length ? cityLabel(cities[cities.length - 1]) : NO_CITY);

const R_MILES = 3958.8;
export function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}
