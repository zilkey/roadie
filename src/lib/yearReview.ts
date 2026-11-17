/**
 * Year in Review: one year of the band in numbers, for the story slides at /review (admins only: it has money in it).
 * Pure: the page loads the records and this adds them up. Every configuration counts; `lineups` splits the shows by it.
 *
 * What counts:
 * - A show: played (or confirmed with its date passed), dated in the year, this artist's.
 * - Songs: the song items on those shows' setlists. A show with no setlist adds none.
 * - Stage time: a show's set length when it has one, else its setlist's length with transitions.
 * - Money: what actually moved in the year (moneyRows: received income, paid expenses, paid payouts; no reimbursements).
 * - Miles: every gas trip's miles (each driver counts) plus tour drives that have no gas expense of their own.
 */
import { isPlayed, showCity, showName } from "./shows";
import { setlistTotal, transitionOf } from "./music";
import { CATEGORY_LABEL, incomeSoFar, moneyRows, type ExpenseLike, type IncomeLike, type PayoutLike } from "./money";

type Dated = { deletedAt?: unknown };
export interface ReviewShow extends Dated {
  id: string; date: string; status: "hold" | "confirmed" | "played" | "canceled" | "dropped"; artistId?: string;
  kind?: "venue" | "house" | "festival" | "radio" | "other"; venue?: { id: string; name: string; city?: string }; place?: { city: string };
  hostName?: string; editionName?: string; billedAs?: string; personnel: string[]; tourId?: string;
  times?: { setLengthSec?: number }; transitionSec?: number;
}
export interface ReviewSetlist { id: string; items: { type: string; songId?: string; title: string; lengthSec?: number }[] }
export interface ReviewDeal { id: string; crowd?: number; paidAttendance?: number; rating?: { show?: number; venue?: number } }
export interface ReviewRehearsal extends Dated { date: string; startTime?: string; endTime?: string; songs: { songId: string; title: string }[] }
export interface ReviewSong extends Dated { id: string; title: string; status: string; createdMs?: number }
export interface ReviewGas { miles: number }
export interface ReviewExpense extends ExpenseLike { gas?: ReviewGas; tourEntryId?: string }
export interface ReviewTourEntry extends Dated { id: string; tourId: string; kind: string; date?: string; miles?: number; roundTrip?: boolean }
export interface ReviewRelease extends Dated { id: string; artistId?: string; title: string; kind: string; releaseDate?: string }
export interface ReviewStat { date: string; followers?: number; monthlyListeners?: number; streams?: number }
export interface ReviewFan extends Dated { artistId?: string; createdMs?: number; cities: { city: string; state?: string }[] }
export interface ReviewPitch extends Dated { artistId?: string; status: string; createdMs?: number }
export interface ReviewPost extends Dated { artistId?: string; postedAt?: string }

export interface ReviewInput {
  /** "2026" */
  year: string;
  /** Today in the artist's zone (YYYY-MM-DD). */
  today: string;
  artistId: string;
  /** Count nothing dated after this day (YYYY-MM-DD). Missing = today. Comparisons use it: "this point last year". */
  until?: string;
  shows: readonly ReviewShow[]; setlists: readonly ReviewSetlist[]; deals: readonly ReviewDeal[];
  rehearsals: readonly ReviewRehearsal[]; songs: readonly ReviewSong[];
  income: readonly (IncomeLike & { artistId?: string })[]; expenses: readonly ReviewExpense[]; payouts: readonly (PayoutLike & { artistId?: string })[];
  tours: readonly { id: string; artistId?: string; name: string }[]; tourEntries: readonly ReviewTourEntry[];
  releases: readonly ReviewRelease[]; tracks: readonly { releaseId: string; deletedAt?: unknown }[];
  stats: readonly ReviewStat[]; fans: readonly ReviewFan[]; pitches: readonly ReviewPitch[]; posts: readonly ReviewPost[];
  musicians: readonly { id: string; name: string }[]; configurations: readonly { id: string; name: string }[];
}

export interface Ranked { name: string; count: number }
export interface YearReview {
  year: string;
  /** The year is still going (it is `today`'s year). */
  soFar: boolean;
  shows: {
    count: number; cities: number; venues: number; first?: { name: string; date: string }; last?: { name: string; date: string };
    /** Shows per month, January first (12 numbers). */
    byMonth: number[]; busiestMonth?: { month: number; count: number };
    topVenues: Ranked[]; topCities: Ranked[]; byKind: Ranked[];
    /** Confirmed shows still ahead in this year. */
    ahead: number; canceled: number; onTour: number;
  };
  songs: {
    /** Song performances: every song item on every played show's setlist. */
    played: number; unique: number; top: Ranked[]; setlists: number;
    /** Seconds on stage. */
    stageSec: number;
    /** Songs whose first show ever was in this year (only when an earlier year has a setlist to compare with). */
    debuts: string[]; opener?: Ranked; closer?: Ranked;
    /** Songs added to the songbook in the year. */
    added: number;
  };
  rehearsals: { count: number; sec: number; songs: number; top?: Ranked };
  miles: { total: number; gasTrips: number; tourDrives: number; gasCents: number; trips: number };
  crowd: { total: number; counted: number; biggest?: { name: string; date: string; count: number }; avgStars?: number; fiveStar: number; rated: number };
  money: {
    in: number; out: number; net: number; perShow: number; tips: number; merch: number; paidToPlayers: number;
    /** Money in by category, biggest first. */
    sources: { name: string; cents: number }[];
    bestShow?: { name: string; date: string; cents: number }; bestMonth?: { month: number; cents: number };
  };
  lineups: { byConfig: Ranked[]; players: Ranked[]; mvp?: Ranked };
  releases: { out: { title: string; kind: string; date: string; tracks: number }[]; tracks: number; coming: number };
  reach: {
    newFans: number; fanCities: number; followers?: { from: number; to: number }; monthlyListeners?: number; streams?: number;
    posts: number; pitches: number; booked: number;
  };
}

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The review the Calendar's banner offers on `today`, or null out of season. November and December offer the current year;
 * January offers the year that just ended.
 */
export function reviewSeason(today: string): string | null {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  if (m >= 11) return String(y);
  if (m === 1) return String(y - 1);
  return null;
}
/** The year the page opens on with no ?y=: last year through January, else this year. */
export const defaultReviewYear = (today: string) => reviewSeason(today) ?? today.slice(0, 4);

const live = <T extends Dated>(xs: readonly T[]) => xs.filter((x) => !x.deletedAt);
const mine = <T extends { artistId?: string }>(xs: readonly T[], artistId: string) => xs.filter((x) => !x.artistId || x.artistId === artistId);
const inYear = (date: string | undefined, year: string) => !!date && date.startsWith(year + "-");
const msYear = (ms: number | undefined) => (ms === undefined ? "" : String(new Date(ms).getUTCFullYear()));
function rank(names: Iterable<string>): Ranked[] {
  const m = new Map<string, number>();
  for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
const mins = (t?: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const songKey = (i: { songId?: string; title: string }) => i.songId ?? `t:${i.title.trim().toLowerCase()}`;

/** Every year that has something in it (a show, a rehearsal or money), newest first; `today`'s year is always there. */
export function reviewYears(i: Pick<ReviewInput, "today" | "artistId" | "shows" | "rehearsals" | "income" | "expenses">): string[] {
  const ys = new Set<string>([i.today.slice(0, 4)]);
  for (const s of mine(live(i.shows), i.artistId)) if (isPlayed(s, i.today)) ys.add(s.date.slice(0, 4));
  for (const r of live(i.rehearsals)) if (r.date <= i.today) ys.add(r.date.slice(0, 4));
  for (const x of [...live(i.income), ...live(i.expenses)]) if (x.date <= i.today) ys.add(x.date.slice(0, 4));
  return [...ys].filter((y) => /^\d{4}$/.test(y)).sort().reverse();
}

export function yearReview(i: ReviewInput): YearReview {
  const { year, today, artistId } = i;
  const cap = i.until ?? today;
  const capMs = Date.parse(cap + "T23:59:59.999Z");
  const madeIn = (ms: number | undefined) => msYear(ms) === year && ms! <= capMs;
  const allShows = mine(live(i.shows), artistId);
  const playedEver = allShows.filter((s) => isPlayed(s, today) && s.date <= cap).sort((a, b) => a.date.localeCompare(b.date));
  const played = playedEver.filter((s) => inYear(s.date, year));
  const showById = new Map(allShows.map((s) => [s.id, s]));
  const at = (s: ReviewShow) => ({ name: showName(s), date: s.date });

  // ---- shows ----
  const byMonth = Array.from({ length: 12 }, () => 0);
  for (const s of played) byMonth[Number(s.date.slice(5, 7)) - 1]++;
  const busiest = byMonth.reduce((best, n, m) => (n > byMonth[best] ? m : best), 0);
  const cities = rank(played.map((s) => showCity(s)).filter((c): c is string => !!c));
  const venues = rank(played.filter((s) => s.venue).map((s) => s.venue!.name));
  const KIND: Record<string, string> = { venue: "Venues", house: "House concerts", festival: "Festivals", radio: "Radio", other: "Other" };
  const kind = (s: ReviewShow) => s.kind ?? (s.venue ? "venue" : s.hostName ? "house" : "other");

  // ---- songs ----
  const setlistOf = new Map(i.setlists.map((l) => [l.id, l]));
  const songItems = (s: ReviewShow) => (setlistOf.get(s.id)?.items ?? []).filter((x) => x.type === "song");
  const titleOf = new Map<string, string>();
  for (const s of i.songs) titleOf.set(s.id, s.title);
  const plays: string[] = [], openers: string[] = [], closers: string[] = [];
  let setlists = 0, stageSec = 0;
  for (const s of played) {
    const items = songItems(s);
    for (const x of items) { const k = songKey(x); if (!titleOf.has(k)) titleOf.set(k, x.title); plays.push(k); }
    if (items.length) { setlists++; openers.push(songKey(items[0])); closers.push(songKey(items[items.length - 1])); }
    stageSec += s.times?.setLengthSec ?? (items.length ? setlistTotal(setlistOf.get(s.id)!.items, transitionOf(s)) : 0);
  }
  const named = (r: Ranked[]) => r.map((x) => ({ name: titleOf.get(x.name) ?? x.name, count: x.count }));
  const top = named(rank(plays));
  const before = new Set<string>();
  let earlierSetlists = 0;
  for (const s of playedEver) {
    if (s.date >= `${year}-01-01`) break;
    const items = songItems(s);
    if (items.length) earlierSetlists++;
    for (const x of items) before.add(songKey(x));
  }
  const debuts = earlierSetlists ? [...new Set(plays)].filter((k) => !before.has(k)).map((k) => titleOf.get(k) ?? k) : [];

  // ---- rehearsals ----
  const rehearsals = live(i.rehearsals).filter((r) => inYear(r.date, year) && r.date <= cap);
  let rehearsalSec = 0;
  for (const r of rehearsals) {
    const a = mins(r.startTime), b = mins(r.endTime);
    if (a !== null && b !== null) rehearsalSec += ((b > a ? b - a : b + 1440 - a)) * 60;
  }
  const rehearsed = named(rank(rehearsals.flatMap((r) => (r.songs ?? []).map((x) => { if (!titleOf.has(x.songId)) titleOf.set(x.songId, x.title); return x.songId; }))));

  // ---- miles ----
  const expenses = live(i.expenses).filter((x) => inYear(x.date, year) && x.date <= cap);
  const gas = expenses.filter((x) => x.gas);
  const gasTrips = gas.reduce((n, x) => n + x.gas!.miles, 0);
  const withGas = new Set(live(i.expenses).filter((x) => x.gas && x.tourEntryId).map((x) => x.tourEntryId!));
  const tourIds = new Set(mine(i.tours, artistId).map((t) => t.id));
  const drives = live(i.tourEntries).filter((e) => e.kind === "drive" && tourIds.has(e.tourId) && inYear(e.date, year) && e.date! <= cap && !withGas.has(e.id) && e.miles);
  const tourDrives = drives.reduce((n, e) => n + e.miles! * (e.roundTrip ? 2 : 1), 0);

  // ---- crowd and stars ----
  const dealOf = new Map(i.deals.map((d) => [d.id, d]));
  const crowds = played.map((s) => ({ s, n: dealOf.get(s.id)?.crowd ?? dealOf.get(s.id)?.paidAttendance ?? 0 })).filter((x) => x.n > 0);
  const biggest = crowds.reduce<typeof crowds[number] | undefined>((b, x) => (!b || x.n > b.n ? x : b), undefined);
  const stars = played.map((s) => dealOf.get(s.id)?.rating?.show).filter((n): n is number => typeof n === "number");

  // ---- money ----
  const income = incomeSoFar(mine(i.income, artistId), today);
  const rows = moneyRows({ income, expenses: i.expenses, payouts: mine(i.payouts, artistId) }).filter((r) => inYear(r.date, year) && r.date <= cap);
  const sum = (xs: readonly { in: number; out: number }[], k: "in" | "out") => xs.reduce((n, r) => n + r[k], 0);
  const moneyIn = sum(rows, "in"), moneyOut = sum(rows, "out");
  const cat = new Map<string, number>(), perShow = new Map<string, number>(), perMonth = Array.from({ length: 12 }, () => 0);
  for (const r of rows) {
    if (!r.in) continue;
    cat.set(r.category, (cat.get(r.category) ?? 0) + r.in);
    if (r.showId) perShow.set(r.showId, (perShow.get(r.showId) ?? 0) + r.in);
    perMonth[Number(r.date.slice(5, 7)) - 1] += r.in;
  }
  const best = [...perShow].filter(([id]) => showById.has(id)).sort((a, b) => b[1] - a[1])[0];
  const bestMonth = perMonth.reduce((b, n, m) => (n > perMonth[b] ? m : b), 0);
  const showIncome = [...perShow.values()].reduce((n, c) => n + c, 0);
  const paidToPlayers = live(mine(i.payouts, artistId)).filter((p) => p.kind === "pay" && inYear(p.paidAt, year) && p.paidAt! <= cap).reduce((n, p) => n + p.amount, 0);

  // ---- lineups ----
  const cfgName = new Map(i.configurations.map((c) => [c.id, c.name]));
  const musicianName = new Map(i.musicians.map((m) => [m.id, m.name]));
  const byConfig = rank(played.filter((s) => s.billedAs && cfgName.has(s.billedAs)).map((s) => cfgName.get(s.billedAs!)!));
  const players = rank(played.flatMap((s) => s.personnel ?? []).filter((id) => musicianName.has(id)).map((id) => musicianName.get(id)!));

  // ---- releases ----
  const releases = mine(live(i.releases), artistId).filter((r) => inYear(r.releaseDate, year));
  const trackCount = (id: string) => live(i.tracks).filter((t) => t.releaseId === id).length;
  const out = releases.filter((r) => r.releaseDate! <= cap).sort((a, b) => a.releaseDate!.localeCompare(b.releaseDate!))
    .map((r) => ({ title: r.title, kind: r.kind, date: r.releaseDate!, tracks: trackCount(r.id) }));

  // ---- reach ----
  const fans = mine(live(i.fans), artistId).filter((f) => madeIn(f.createdMs));
  const snaps = i.stats.filter((s) => inYear(s.date, year) && s.date <= cap).sort((a, b) => a.date.localeCompare(b.date));
  const followers = snaps.filter((s) => typeof s.followers === "number");
  const lastOf = (f: "monthlyListeners" | "streams") => [...snaps].reverse().find((s) => typeof s[f] === "number")?.[f];
  const pitches = mine(live(i.pitches), artistId).filter((p) => madeIn(p.createdMs) && p.status !== "idea" && p.status !== "toPitch");

  return {
    year, soFar: today.startsWith(year + "-"),
    shows: {
      count: played.length, cities: cities.length, venues: venues.length,
      first: played[0] && at(played[0]), last: played.length > 1 ? at(played[played.length - 1]) : undefined,
      byMonth, busiestMonth: played.length ? { month: busiest, count: byMonth[busiest] } : undefined,
      topVenues: venues.slice(0, 5), topCities: cities.slice(0, 5), byKind: rank(played.map((s) => KIND[kind(s)])),
      ahead: allShows.filter((s) => s.status === "confirmed" && inYear(s.date, year) && s.date >= today).length,
      canceled: allShows.filter((s) => s.status === "canceled" && inYear(s.date, year)).length,
      onTour: played.filter((s) => s.tourId).length,
    },
    songs: {
      played: plays.length, unique: new Set(plays).size, top: top.slice(0, 5), setlists, stageSec, debuts,
      opener: named(rank(openers))[0], closer: named(rank(closers))[0],
      added: live(i.songs).filter((s) => madeIn(s.createdMs)).length,
    },
    rehearsals: { count: rehearsals.length, sec: rehearsalSec, songs: new Set(rehearsals.flatMap((r) => (r.songs ?? []).map((x) => x.songId))).size, top: rehearsed[0] },
    miles: {
      total: Math.round(gasTrips + tourDrives), gasTrips: Math.round(gasTrips), tourDrives: Math.round(tourDrives),
      gasCents: expenses.filter((x) => x.category === "gas" && !x.owed).reduce((n, x) => n + x.amount, 0), trips: gas.length + drives.length,
    },
    crowd: {
      total: crowds.reduce((n, x) => n + x.n, 0), counted: crowds.length,
      biggest: biggest && { ...at(biggest.s), count: biggest.n },
      avgStars: stars.length ? Math.round((stars.reduce((n, x) => n + x, 0) / stars.length) * 10) / 10 : undefined,
      fiveStar: stars.filter((n) => n === 5).length, rated: stars.length,
    },
    money: {
      in: moneyIn, out: moneyOut, net: moneyIn - moneyOut, perShow: played.length ? Math.round(showIncome / played.length) : 0,
      tips: cat.get("tips") ?? 0, merch: cat.get("merch") ?? 0, paidToPlayers,
      sources: [...cat].map(([k, cents]) => ({ name: CATEGORY_LABEL[k] ?? k, cents })).sort((a, b) => b.cents - a.cents),
      bestShow: best && { ...at(showById.get(best[0])!), cents: best[1] },
      bestMonth: moneyIn ? { month: bestMonth, cents: perMonth[bestMonth] } : undefined,
    },
    lineups: { byConfig, players: players.slice(0, 6), mvp: players[0] },
    releases: { out, tracks: out.reduce((n, r) => n + r.tracks, 0), coming: releases.length - out.length },
    reach: {
      newFans: fans.length, fanCities: new Set(fans.flatMap((f) => (f.cities ?? []).map((c) => `${c.city}|${c.state ?? ""}`.toLowerCase()))).size,
      followers: followers.length ? { from: followers[0].followers!, to: followers[followers.length - 1].followers! } : undefined,
      monthlyListeners: lastOf("monthlyListeners"), streams: lastOf("streams"),
      posts: mine(live(i.posts), artistId).filter((p) => inYear(p.postedAt?.slice(0, 10), year) && p.postedAt!.slice(0, 10) <= cap).length,
      pitches: pitches.length, booked: pitches.filter((p) => p.status === "booked").length,
    },
  };
}

// ---------- the year before ----------

export interface PreviousReview {
  year: string; review: YearReview;
  /** True when `review` stops at the same day of its year as today (the year in view is still going), so both cover the same stretch. */
  samePoint: boolean;
  /** The last day counted when samePoint (YYYY-MM-DD). */
  through?: string;
}
/**
 * The year before the one in view, to compare with. While the year in view is still going, the year before is cut at the
 * same day, so "23 shows so far" is set against the shows played by this day last year, not all of last year's.
 * Null when that stretch has nothing in it (the band's first year in Roadie).
 */
export function previousReview(i: ReviewInput): PreviousReview | null {
  const year = String(Number(i.year) - 1);
  const samePoint = i.today.startsWith(i.year + "-");
  const through = samePoint ? year + i.today.slice(4) : undefined;
  const review = yearReview({ ...i, year, until: through });
  const any = review.shows.count || review.songs.played || review.rehearsals.count || review.miles.total || review.money.in || review.money.out;
  return any ? { year, review, samePoint, through } : null;
}

/** How a number moved against the year before: "Up 5 (+28%)", "Down $1,200 (-12%)", "Same". The percent is left off when there was nothing before. */
export function versus(now: number, before: number, fmt: (n: number) => string = num): { dir: "up" | "down" | "same"; text: string } {
  const diff = now - before;
  if (fmt(Math.abs(diff)) === fmt(0)) return { dir: "same", text: "Same" };
  const pct = before > 0 ? Math.round((Math.abs(diff) / before) * 100) : 0;
  const tail = pct >= 1 ? ` (${diff > 0 ? "+" : "-"}${num(pct)}%)` : "";
  return diff > 0 ? { dir: "up", text: `Up ${fmt(diff)}${tail}` } : { dir: "down", text: `Down ${fmt(-diff)}${tail}` };
}

// ---------- words for the slides ----------

/** "1,234" */
export const num = (n: number) => Math.round(n).toLocaleString("en-US");
/** Whole dollars for a headline: "$12,340". */
export const bucks = (cents: number) => `${cents < 0 ? "-" : ""}$${num(Math.abs(cents) / 100)}`;
/** Seconds as hours for a headline: "47.5" under 100 hours (one decimal, none when whole), "312" over. */
export function hours(sec: number): string {
  const h = sec / 3600;
  return h >= 100 ? num(h) : String(Math.round(h * 10) / 10);
}
/** A road-trip comparison for the miles slide, the biggest one the miles cover. */
export function milesLine(miles: number): string {
  const times = (n: number) => (n >= 10 ? num(n) : String(Math.round(n * 10) / 10));
  if (miles >= 24_901) return `That's ${times(miles / 24_901)} times around the Earth.`;
  if (miles >= 5_600) return `That's ${times(miles / 2_800)} trips from New York to Los Angeles.`;
  if (miles >= 2_800) return "That's farther than New York to Los Angeles.";
  if (miles >= 800) return `That's ${Math.round((miles / 24_901) * 100)}% of the way around the Earth.`;
  if (miles >= 26.2) return `That's ${num(miles / 26.2)} marathons, in a car.`;
  return "Every mile counts.";
}
/** A comparison for the stage-time slide. */
export function stageLine(sec: number): string {
  const h = sec / 3600;
  if (h >= 48) return `That's ${Math.round((h / 24) * 10) / 10} days straight under the lights.`;
  if (h >= 4) return `That's ${num(h / 2)} feature films' worth of music.`;
  return "Short and sweet.";
}
