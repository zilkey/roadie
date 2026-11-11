import { defineFake, runIfMain, esc, type Route } from "../lib";

export interface SpotifyDay { date: string; followers: number; popularity: number }
/** A catalog artist in the Web API's Development Mode shape: id, name, images, external_urls (no genres, followers or popularity). */
export interface CatalogArtist { id: string; name: string; images: { url: string; width: number; height: number }[]; external_urls: { spotify: string } }
/** `catalog` is what /v1/search and /v1/artists/{id} answer from (acts' Look up, #78). Optional: state files from before it get the seed. */
export interface SpotifyState { artist: { id: string; name: string }; days: SpotifyDay[]; catalog?: CatalogArtist[] }

const img = (id: string) => [640, 320, 160].map((w) => ({ url: `https://i.scdn.example/${id}-${w}.jpg`, width: w, height: w }));
const artist = (id: string, name: string, images = true): CatalogArtist => ({ id, name, images: images ? img(id) : [], external_urls: { spotify: `https://open.spotify.com/artist/${id}` } });
/**
 * Two artists called "A Brother's Fountain" (so Look up asks "same band?"), one North Fork Crossing (picked straight away), and a
 * "Wheelwright Revival" that a search for Wheelwright finds but that isn't the same name (so it is not used).
 */
export const seedCatalog = (): CatalogArtist[] => [
  artist("4BrothersFountainCO01", "A Brother's Fountain"),
  artist("4BrothersFountainUK02", "A Brother's Fountain", false),
  artist("NorthForkCrossing0001", "North Fork Crossing"),
  artist("WheelwrightRevival001", "Wheelwright Revival"),
];
const catalogOf = (s: SpotifyState) => (s.catalog ??= seedCatalog());
const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
/** Deterministic pseudo-random in [0,1) from a string, so drift is stable per day. */
function rnd(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}
function nextDay(prev: SpotifyDay, date: string): SpotifyDay {
  const followers = Math.max(0, prev.followers + Math.round(rnd("f" + date) * 14 - 3));
  const pop = Math.min(100, Math.max(0, prev.popularity + (rnd("p" + date) < 0.2 ? (rnd("q" + date) < 0.5 ? -1 : 1) : 0)));
  return { date, followers, popularity: pop };
}
/** Extend the history up to today (state only grows; reset restores the seed). */
function fill(s: SpotifyState) {
  let last = s.days[s.days.length - 1];
  while (last.date < today()) { last = nextDay(last, addDays(last.date, 1)); s.days.push(last); }
}
function initial(): SpotifyState {
  const start = addDays(today(), -60);
  const days: SpotifyDay[] = [{ date: start, followers: 1840, popularity: 31 }];
  const s: SpotifyState = {
    artist: { id: "fake-artist-nora", name: "Nora Quill Band" }, days, catalog: seedCatalog(),
  };
  fill(s);
  return s;
}

const routes: Route<SpotifyState>[] = [
  // Client-credentials token (accounts.spotify.com/api/token): any client id and secret.
  ["POST", "/api/token", ({ body }) => (body?.grant_type === "client_credentials"
    ? { access_token: "fake-spotify-token", token_type: "Bearer", expires_in: 3600 }
    : { status: 400, json: { error: "unsupported_grant_type", error_description: "grant_type must be client_credentials" } })],
  // GET /v1/search?q=name&type=artist&limit=10: every artist whose name contains the words, at most `limit` (10 at most, as in Development Mode).
  ["GET", "/v1/search", ({ query }, s) => {
    const limit = Number(query.get("limit") ?? 10);
    if (query.get("type") !== "artist") return { status: 400, json: { error: { status: 400, message: "Only type=artist" } } };
    if (!(limit >= 1 && limit <= 10)) return { status: 400, json: { error: { status: 400, message: "Invalid limit" } } };
    const q = key((query.get("q") ?? "").replace(/^artist:/, "").replace(/"/g, ""));
    const items = q ? catalogOf(s).filter((a) => key(a.name).includes(q)).slice(0, limit) : [];
    return { artists: { href: "", limit, offset: 0, total: items.length, items } };
  }],
  ["GET", "/v1/artists/:id", ({ params }, s) => catalogOf(s).find((a) => a.id === params.id) ?? { status: 404, json: { error: { status: 404, message: "Resource not found" } } }],
  ["GET", "/artist", (_r, s) => { fill(s); return { ...s.artist, ...s.days[s.days.length - 1] }; }],
  ["GET", "/artist/history", ({ query }, s) => {
    fill(s);
    const from = query.get("from"), to = query.get("to");
    return s.days.filter((d) => (!from || d.date >= from) && (!to || d.date <= to));
  }],
];

export const fakeSpotify = defineFake<SpotifyState>({
  name: "fake-spotify", defaultPort: 3205, initial, routes, formApi: true,
  page: (s) => { fill(s); return `<p>${esc(s.artist.name)}</p>
<h2>Catalog (artist search)</h2><table><tr><th>Id</th><th>Name</th></tr>${catalogOf(s).map((a) => `<tr><td>${esc(a.id)}</td><td>${esc(a.name)}</td></tr>`).join("")}</table>
<h2>By day (latest 30)</h2><table><tr><th>Date</th><th>Followers</th><th>Popularity</th></tr>${s.days.slice(-30).reverse().map((d) => `<tr><td>${d.date}</td><td>${d.followers}</td><td>${d.popularity}</td></tr>`).join("")}</table>`; },
});
runIfMain(import.meta, fakeSpotify);
