import { defineFake, runIfMain, esc, type Route } from "../lib";

export interface SpotifyDay { date: string; followers: number; popularity: number }
export interface SpotifyState { artist: { id: string; name: string }; days: SpotifyDay[]; topTracks: { rank: number; name: string; popularity: number; plays: number }[] }

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
    artist: { id: "fake-artist-ingrid", name: "Ingrid Avison Band" }, days,
    topTracks: [["Glass Coast", 41, 18400], ["Weathervane", 38, 12100], ["Ruby Hill", 35, 9800], ["Low Light", 33, 7600], ["Sundial", 30, 5200]]
      .map(([name, popularity, plays], i) => ({ rank: i + 1, name: name as string, popularity: popularity as number, plays: plays as number })),
  };
  fill(s);
  return s;
}

const routes: Route<SpotifyState>[] = [
  ["GET", "/artist", (_r, s) => { fill(s); return { ...s.artist, ...s.days[s.days.length - 1] }; }],
  ["GET", "/artist/history", ({ query }, s) => {
    fill(s);
    const from = query.get("from"), to = query.get("to");
    return s.days.filter((d) => (!from || d.date >= from) && (!to || d.date <= to));
  }],
  ["GET", "/artist/top-tracks", (_r, s) => s.topTracks],
];

export const fakeSpotify = defineFake<SpotifyState>({
  name: "fake-spotify", defaultPort: 3205, initial, routes,
  page: (s) => { fill(s); return `<p>${esc(s.artist.name)}</p><h2>Top tracks</h2><table>${s.topTracks.map((t) => `<tr><td>${t.rank}</td><td>${esc(t.name)}</td><td>${t.popularity}</td><td>${t.plays}</td></tr>`).join("")}</table>
<h2>By day (latest 30)</h2><table><tr><th>Date</th><th>Followers</th><th>Popularity</th></tr>${s.days.slice(-30).reverse().map((d) => `<tr><td>${d.date}</td><td>${d.followers}</td><td>${d.popularity}</td></tr>`).join("")}</table>`; },
});
runIfMain(import.meta, fakeSpotify);
