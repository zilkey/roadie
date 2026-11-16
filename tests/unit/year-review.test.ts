/** Year in Review: what counts toward a year, and the words on the slides. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bucks, defaultReviewYear, hours, milesLine, previousReview, reviewSeason, reviewYears, versus, yearReview, type ReviewInput, type ReviewShow } from "@/lib/yearReview";

const A = "artist1";
const show = (id: string, date: string, extra: Partial<ReviewShow> = {}): ReviewShow => ({
  id, date, status: "played", artistId: A, personnel: ["m1", "m2"], billedAs: "full",
  venue: { id: "v-" + (extra.venue?.name ?? "Deep End"), name: "Deep End", city: "Denver" }, ...extra,
});
const song = (songId: string, title: string, lengthSec = 240) => ({ type: "song", songId, title, lengthSec });
const ms = (d: string) => Date.parse(d + "T12:00:00Z");
const base = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  year: "2026", today: "2026-11-16", artistId: A,
  shows: [], setlists: [], deals: [], rehearsals: [], songs: [], income: [], expenses: [], payouts: [], tours: [], tourEntries: [],
  releases: [], tracks: [], stats: [], fans: [], pitches: [], posts: [],
  musicians: [{ id: "m1", name: "Nora" }, { id: "m2", name: "Rudy" }], configurations: [{ id: "full", name: "Full band" }, { id: "duo", name: "Duo" }],
  ...over,
});

test("reviewSeason: November and December offer this year, January last year, the rest nothing", () => {
  assert.equal(reviewSeason("2026-11-01"), "2026");
  assert.equal(reviewSeason("2026-12-31"), "2026");
  assert.equal(reviewSeason("2027-01-31"), "2026");
  assert.equal(reviewSeason("2027-02-01"), null);
  assert.equal(reviewSeason("2026-10-31"), null);
  assert.equal(defaultReviewYear("2027-01-10"), "2026");
  assert.equal(defaultReviewYear("2026-06-10"), "2026");
});

test("shows: played ones in the year, this artist's, with a confirmed show whose date passed", () => {
  const r = yearReview(base({
    shows: [
      show("a", "2026-03-05"), show("b", "2026-10-10", { venue: { id: "v2", name: "Creamery", city: "Boulder" }, billedAs: "duo", personnel: ["m1"] }),
      show("c", "2026-10-20", { status: "confirmed", tourId: "t1" }),
      show("ahead", "2026-12-05", { status: "confirmed" }), show("hold", "2026-10-02", { status: "hold" }), show("off", "2026-10-03", { status: "canceled" }),
      show("old", "2025-10-10"), show("theirs", "2026-10-11", { artistId: "other" }), show("gone", "2026-10-12", { deletedAt: new Date() }),
    ],
  }));
  assert.equal(r.shows.count, 3);
  assert.equal(r.shows.cities, 2);
  assert.equal(r.shows.venues, 2);
  assert.deepEqual(r.shows.busiestMonth, { month: 9, count: 2 });
  assert.equal(r.shows.byMonth[2], 1);
  assert.deepEqual(r.shows.topVenues[0], { name: "Deep End", count: 2 });
  assert.equal(r.shows.first?.date, "2026-03-05");
  assert.equal(r.shows.last?.date, "2026-10-20");
  assert.equal(r.shows.ahead, 1);
  assert.equal(r.shows.canceled, 1);
  assert.equal(r.shows.onTour, 1);
  assert.equal(r.soFar, true);
  assert.deepEqual(r.lineups.byConfig, [{ name: "Full band", count: 2 }, { name: "Duo", count: 1 }]);
  assert.deepEqual(r.lineups.mvp, { name: "Nora", count: 3 });
});

test("songs: every song item on played shows' setlists, unique by song, with debuts, opener, closer and stage time", () => {
  const r = yearReview(base({
    shows: [show("old", "2025-06-01"), show("a", "2026-03-05", { times: { setLengthSec: 3600 } }), show("b", "2026-04-05"), show("future", "2026-12-05", { status: "confirmed" })],
    setlists: [
      { id: "old", items: [song("s1", "Glass Coast")] },
      { id: "a", items: [song("s1", "Glass Coast"), { type: "break", title: "Break", lengthSec: 600 }, song("s2", "Weathervane"), song("s3", "Low Light")] },
      { id: "b", items: [song("s1", "Glass Coast"), song("s3", "Low Light")] },
      { id: "future", items: [song("s9", "Not yet")] },
    ],
    songs: [{ id: "s1", title: "Glass Coast (renamed)", status: "active", createdMs: ms("2024-01-01") }, { id: "s4", title: "New one", status: "writing", createdMs: ms("2026-02-01") }],
  }));
  assert.equal(r.songs.played, 5);
  assert.equal(r.songs.unique, 3);
  assert.equal(r.songs.setlists, 2);
  assert.deepEqual(r.songs.top[0], { name: "Glass Coast (renamed)", count: 2 });
  assert.deepEqual(r.songs.debuts.sort(), ["Low Light", "Weathervane"]);
  assert.equal(r.songs.opener?.name, "Glass Coast (renamed)");
  assert.equal(r.songs.closer?.name, "Low Light");
  // show a: its set length (3600); show b: two 4-minute songs and one 30-second transition
  assert.equal(r.songs.stageSec, 3600 + 480 + 30);
  assert.equal(r.songs.added, 1);
});

test("no debuts when no earlier year has a setlist to compare with", () => {
  const r = yearReview(base({ shows: [show("a", "2026-03-05")], setlists: [{ id: "a", items: [song("s1", "Glass Coast")] }] }));
  assert.deepEqual(r.songs.debuts, []);
});

test("miles: gas trips plus tour drives, a drive with its own gas expense counted once", () => {
  const exp = (id: string, extra: object) => ({ id, userId: "u1", date: "2026-05-01", amount: 2000, category: "gas", what: "Gas", ...extra });
  const r = yearReview(base({
    expenses: [
      exp("e1", { gas: { miles: 120 } }), exp("e2", { gas: { miles: 80.4 }, tourEntryId: "d1" }), exp("e3", { category: "food" }),
      exp("e4", { gas: { miles: 999 }, date: "2025-05-01" }), exp("e5", { gas: { miles: 999 }, deletedAt: new Date() }),
    ],
    tours: [{ id: "t1", artistId: A, name: "Fall run" }, { id: "t2", artistId: "other", name: "Theirs" }],
    tourEntries: [
      { id: "d1", tourId: "t1", kind: "drive", date: "2026-05-01", miles: 80 },
      { id: "d2", tourId: "t1", kind: "drive", date: "2026-05-02", miles: 200, roundTrip: true },
      { id: "d3", tourId: "t1", kind: "stay", date: "2026-05-02" },
      { id: "d4", tourId: "t1", kind: "drive", date: "2026-12-20", miles: 300 },
      { id: "d5", tourId: "t2", kind: "drive", date: "2026-05-02", miles: 500 },
    ],
  }));
  assert.equal(r.miles.gasTrips, 200);
  assert.equal(r.miles.tourDrives, 400);
  assert.equal(r.miles.total, 600);
  assert.equal(r.miles.trips, 3);
  assert.equal(r.miles.gasCents, 4000);
});

test("money: what moved in the year, by source, with the best show; owed and next year's stay out", () => {
  const inc = (id: string, extra: object) => ({ id, artistId: A, date: "2026-10-10", amount: 45000, category: "guarantee", from: "Venue", projectId: "p", receivedAt: "2026-10-10", ...extra });
  const r = yearReview(base({
    shows: [show("a", "2026-10-10"), show("b", "2026-10-17")],
    income: [
      inc("i1", { showId: "a" }), inc("i2", { showId: "a", category: "tips", amount: 5000 }), inc("i3", { showId: "b", amount: 20000 }),
      inc("i4", { amount: 99999, receivedAt: undefined }), inc("i5", { date: "2025-12-31", amount: 77777 }),
    ],
    expenses: [{ id: "e1", userId: "u1", date: "2026-10-10", amount: 3000, category: "gear", what: "Strings" }, { id: "e2", userId: "u1", date: "2026-10-11", amount: 9000, category: "space", what: "Room", owed: true }],
    payouts: [
      { id: "p1", artistId: A, to: { name: "Hugo" }, kind: "pay", amount: 7500, projectId: "p", paidAt: "2026-10-12" },
      { id: "p2", artistId: A, to: { name: "Hugo" }, kind: "reimbursement", amount: 3000, projectId: "p", paidAt: "2026-10-12" },
      { id: "p3", artistId: A, to: { name: "Felix" }, kind: "pay", amount: 6000, projectId: "p" },
    ],
  }));
  assert.equal(r.money.in, 70000);
  assert.equal(r.money.out, 10500);
  assert.equal(r.money.net, 59500);
  assert.equal(r.money.tips, 5000);
  assert.equal(r.money.paidToPlayers, 7500);
  assert.deepEqual(r.money.sources, [{ name: "Guarantee", cents: 65000 }, { name: "Tips", cents: 5000 }]);
  assert.deepEqual(r.money.bestShow, { name: "Deep End", date: "2026-10-10", cents: 50000 });
  assert.equal(r.money.perShow, 35000);
  assert.deepEqual(r.money.bestMonth, { month: 9, cents: 70000 });
});

test("crowd, rehearsals, releases and reach", () => {
  const r = yearReview(base({
    shows: [show("a", "2026-10-10"), show("b", "2026-10-17")],
    deals: [{ id: "a", crowd: 150, paidAttendance: 112, rating: { show: 5 } }, { id: "b", paidAttendance: 40, rating: { show: 4 } }],
    rehearsals: [
      { date: "2026-10-01", startTime: "19:00", endTime: "22:00", songs: [{ songId: "s1", title: "Glass Coast" }] },
      { date: "2026-10-08", songs: [{ songId: "s1", title: "Glass Coast" }, { songId: "s2", title: "Weathervane" }] },
      { date: "2026-12-08", songs: [] },
    ],
    releases: [
      { id: "r1", artistId: A, title: "Wild Hearts", kind: "album", releaseDate: "2026-03-06" },
      { id: "r2", artistId: A, title: "Later", kind: "single", releaseDate: "2026-12-20" },
      { id: "r3", artistId: A, title: "Next year", kind: "ep", releaseDate: "2027-03-06" },
    ],
    tracks: [{ releaseId: "r1" }, { releaseId: "r1" }, { releaseId: "r2" }],
    stats: [{ date: "2026-01-05", followers: 1500 }, { date: "2026-10-22", followers: 1852, monthlyListeners: 900 }, { date: "2025-10-22", followers: 1 }],
    fans: [{ artistId: A, createdMs: ms("2026-10-10"), cities: [{ city: "Boulder", state: "CO" }] }, { artistId: A, createdMs: ms("2025-10-10"), cities: [] }],
    pitches: [{ artistId: A, status: "booked", createdMs: ms("2026-02-01") }, { artistId: A, status: "pitched", createdMs: ms("2026-02-01") }, { artistId: A, status: "idea", createdMs: ms("2026-02-01") }],
    posts: [{ artistId: A, postedAt: "2026-10-01T18:00:00.000Z" }, { artistId: A }],
  }));
  assert.equal(r.crowd.total, 190);
  assert.deepEqual(r.crowd.biggest, { name: "Deep End", date: "2026-10-10", count: 150 });
  assert.equal(r.crowd.avgStars, 4.5);
  assert.equal(r.crowd.fiveStar, 1);
  assert.deepEqual(r.rehearsals, { count: 2, sec: 3 * 3600, songs: 2, top: { name: "Glass Coast", count: 2 } });
  assert.deepEqual(r.releases.out, [{ title: "Wild Hearts", kind: "album", date: "2026-03-06", tracks: 2 }]);
  assert.equal(r.releases.coming, 1);
  assert.deepEqual(r.reach.followers, { from: 1500, to: 1852 });
  assert.equal(r.reach.monthlyListeners, 900);
  assert.equal(r.reach.newFans, 1);
  assert.equal(r.reach.pitches, 2);
  assert.equal(r.reach.booked, 1);
  assert.equal(r.reach.posts, 1);
});

test("reviewYears: years with a played show, a rehearsal or money, newest first, always with this year", () => {
  assert.deepEqual(reviewYears(base({
    shows: [show("a", "2024-10-10"), show("future", "2027-01-05", { status: "confirmed" })],
    rehearsals: [{ date: "2025-03-01", songs: [] }],
    expenses: [{ id: "e", userId: "u", date: "2023-03-01", amount: 100, category: "gear", what: "x" }],
  })), ["2026", "2025", "2024", "2023"]);
});

test("a past year is not 'so far', and an empty year is all zeros", () => {
  const r = yearReview(base({ year: "2024" }));
  assert.equal(r.soFar, false);
  assert.equal(r.shows.count, 0);
  assert.equal(r.shows.busiestMonth, undefined);
  assert.equal(r.money.in, 0);
  assert.equal(r.miles.total, 0);
});

test("the words: dollars, hours and the miles comparison", () => {
  assert.equal(bucks(1234050), "$12,341");
  assert.equal(bucks(-5000), "-$50");
  assert.equal(hours(3600), "1");
  assert.equal(hours(5400), "1.5");
  assert.equal(hours(3600 * 312.4), "312");
  assert.match(milesLine(30000), /1\.2 times around the Earth/);
  assert.match(milesLine(6000), /2\.1 trips from New York to Los Angeles/);
  assert.match(milesLine(1000), /4% of the way around the Earth/);
  assert.match(milesLine(262), /10 marathons/);
});

test("previousReview: a year still going is set against the year before cut at the same day", () => {
  const inc = (id: string, date: string, amount: number) => ({ id, artistId: A, date, amount, category: "guarantee", from: "Venue", projectId: "p", receivedAt: date });
  const i = base({
    shows: [show("n1", "2026-03-05"), show("n2", "2026-10-10"), show("p1", "2025-03-05"), show("p2", "2025-11-16"), show("p3", "2025-11-17"), show("p4", "2025-12-20")],
    income: [inc("i1", "2026-10-10", 50000), inc("i2", "2025-03-05", 20000), inc("i3", "2025-12-20", 99999)],
    rehearsals: [{ date: "2025-06-01", songs: [] }, { date: "2025-12-01", songs: [] }],
    songs: [{ id: "s1", title: "Early", status: "active", createdMs: ms("2025-02-01") }, { id: "s2", title: "Late", status: "active", createdMs: ms("2025-12-01") }],
  });
  const prev = previousReview(i)!;
  assert.equal(prev.year, "2025");
  assert.equal(prev.samePoint, true);
  assert.equal(prev.through, "2025-11-16");
  assert.equal(prev.review.shows.count, 2);
  assert.equal(prev.review.money.in, 20000);
  assert.equal(prev.review.rehearsals.count, 1);
  assert.equal(prev.review.songs.added, 1);
  assert.equal(prev.review.soFar, false);

  // A finished year is set against all of the year before.
  const full = previousReview({ ...i, today: "2027-02-01" })!;
  assert.equal(full.samePoint, false);
  assert.equal(full.review.shows.count, 4);
  assert.equal(full.review.money.in, 119999);
});

test("previousReview: null when the year before has nothing by then", () => {
  assert.equal(previousReview(base({ shows: [show("n1", "2026-03-05"), show("late", "2025-12-20")] })), null);
  assert.equal(previousReview(base({ year: "2024" })), null);
});

test("versus: up, down and same, with the percent when there was something before", () => {
  assert.deepEqual(versus(23, 18), { dir: "up", text: "Up 5 (+28%)" });
  assert.deepEqual(versus(10, 40), { dir: "down", text: "Down 30 (-75%)" });
  assert.deepEqual(versus(7, 7), { dir: "same", text: "Same" });
  assert.deepEqual(versus(5, 0), { dir: "up", text: "Up 5" });
  assert.deepEqual(versus(1692100, 1500000, bucks), { dir: "up", text: "Up $1,921 (+13%)" });
  assert.deepEqual(versus(100020, 100000, bucks), { dir: "same", text: "Same" });
});
