/**
 * The rehearsal and show history import (the Songs tab's columns M..X). The fixture is a small grid shaped like the
 * real sheet: the same twelve history columns in the same positions, with ✅ counts matching the real ones for the
 * columns the tests exercise, so the importer's column table is checked against a sheet of the right shape.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { importRehearsalHistory, rehearsalHistorySurvey } from "../../scripts/import-rehearsal-history";
import type { SongListSnapshot } from "../../scripts/snapshot-song-list";
import { group } from "../../scripts/survey";
import { resetEmulators, makeArtist, TEST_ARTIST } from "./helpers";

const WIDTH = 32;
/** The header row, with the twelve history columns exactly where the real sheet has them (M..X = 12..23). */
const HEADER: Record<number, string> = {
  0: "Songs", 1: "Key", 2: "Tempo", 11: "Rehearsed",
  12: "Doghouse", 13: "7/26/26", 14: "8/11/26", 15: "9/15/26", 16: "9/22/26", 17: "9/28/26", 18: "9/29/26",
  19: "10/3/26", 20: "10/4/26", 21: "10/13/26", 22: "10/16/26 Show", 23: "10/17/26 Show",
  28: "Genre",
};
const line = (cells: Record<number, string>) => Array.from({ length: WIDTH }, (_, c) => cells[c] ?? "");

const TICK = "✅";

/**
 * Seven songs, with marks arranged so the counts the importer asserts against (7 for Doghouse, 14 for 10/3) are
 * what a correct read of this grid produces. Every song is marked in both, with the remainder of each count made up
 * by the repeated rows below.
 */
const SONG_TITLES = ["California", "Digging for the Diamond", "Great Migration", "High Road", "Little Rabbit", "The IUD Song", "You and Me"];

/** The Doghouse column wants 7 ✅ and 10/3 wants 14, so 10/3 is marked twice per song across two blocks of rows. */
const fixture = (): SongListSnapshot => ({
  source: "test", sheet: "Songs", fetchedAt: "2026-10-25",
  values: [
    line(HEADER),
    // Seven real songs: all seven in Doghouse (7) and in 10/3.
    ...SONG_TITLES.map((t) => line({ 0: t, 1: "D", 2: "100", 12: TICK, 19: TICK })),
    // Seven more marked only in 10/3, bringing it to 14. They are songs too, so they resolve.
    ...SONG_TITLES.map((t) => line({ 0: `${t} II`, 1: "E", 2: "110", 19: TICK })),
    // 7/26 has four; 8/11 has two; 10/4 has five -- enough to cover the other branches.
    line({ 0: "Take It Easy", 1: "G", 2: "95", 13: TICK, 14: TICK, 20: TICK }),
    line({ 0: "Time Traveling Cowboy", 1: "A", 2: "88", 13: TICK, 14: TICK, 20: TICK }),
    line({ 0: "Run Down and Ragged", 1: "C", 2: "92", 13: TICK, 20: TICK }),
    line({ 0: "Low Gravity Day", 1: "F", 2: "101", 13: TICK, 20: TICK }),
    line({ 0: "Pace of Trust", 1: "B", 2: "99", 20: TICK }),
  ],
  links: [],
  numericTitleRows: [],
});

const slugOf = (t: string) => `song-${t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

/** A made-up band, shaped like the roster (src/lib/band.ts, which this test never reads): one person per role. */
const BAND = [
  { email: "vera@example.com", name: "Vera Lindqvist", instruments: ["vocals", "guitar"] },
  { email: "kai@example.com", name: "Kai Moreno", instruments: ["keys"] },
  { email: "sam@example.com", name: "Sam Okafor", instruments: ["bass"] },
  { email: "nico@example.com", name: "Nico Alvarez", instruments: ["drums"] },
  { email: "rae@example.com", name: "Rae Whitfield", instruments: ["lead guitar"] },
];
const PLACES = { "Dog House": { name: "Dog House", address: "1 Example Way, Testville, CO" } };
const showBase = {
  status: "confirmed", personnel: [], sound: { provider: "venueProvided" },
  needs: { poster: false, backline: false, merch: false }, docs: [], listings: {}, times: {}, checklists: [],
};

/** The world the import reads: the artist, the five musicians, the songs the sheet names, and the Porchfest show. */
async function world(opts: { songs?: boolean; people?: boolean; porchfest?: boolean } = {}) {
  const { songs = true, people = true, porchfest = true } = opts;
  await makeArtist("Test Band", "test-band");
  if (people) {
    for (const p of BAND) {
      await db.create(importCtx(), "musicians", { name: p.name, email: p.email, instruments: p.instruments, active: true });
    }
  }
  if (songs) {
    for (const t of [...SONG_TITLES, ...SONG_TITLES.map((x) => `${x} II`),
      "Take It Easy", "Time Traveling Cowboy", "Run Down and Ragged", "Low Gravity Day", "Pace of Trust"]) {
      await db.create(importCtx(), "songs", { title: t, status: "active", fields: [] }, { id: slugOf(t) });
    }
  }
  if (porchfest) {
    await db.create(importCtx(), "shows", {
      ...showBase, date: "2026-10-03", artistId: TEST_ARTIST, place: { city: "Denver" },
    }, { id: "vb-porchfest-denver-2026-10-03" });
  }
}

const runImport = (snapshot = fixture(), extra: { dryRun?: boolean } = {}) =>
  importRehearsalHistory({ artist: "test-band", snapshot, roster: BAND, places: PLACES, ...extra });
const colOf = (r: Awaited<ReturnType<typeof runImport>>, col: string) => r.columns.find((c) => c.col === col)!;

beforeEach(resetEmulators);

// ---------- the per-column counts, which are story 18's acceptance test ----------

test("every dated column lands as a rehearsal, with the ✅ count the song list reported", async () => {
  await world();
  const r = await runImport();
  // The nine rehearsal columns in the sheet, by the counts story 18 wrote down.
  for (const [col, date, n] of [["M", "2026-06-28", 7], ["N", "2026-07-26", 4], ["O", "2026-08-11", 2],
    ["U", "2026-10-04", 5], ["V", "2026-10-13", 0]] as const) {
    const c = colOf(r, col);
    assert.equal(c.date, date, `${col} date`);
    assert.equal(c.songs.length, n, `${col} song count`);
    assert.equal(c.ticks, c.expected, `${col} ticks match the expected count`);
    const doc = (await db.get("rehearsals", `rehearsal-${date}`))!;
    assert.equal(doc.date, date);
    assert.equal((doc.songs as unknown[]).length, n);
  }
});

test("Doghouse imports under 2026-06-28 with its location, since the header is a place not a date", async () => {
  await world();
  const r = await runImport();
  const c = colOf(r, "M");
  assert.equal(c.date, "2026-06-28");
  assert.equal(c.action, "created");
  const doc = (await db.get("rehearsals", "rehearsal-2026-06-28"))!;
  assert.deepEqual(doc.location, PLACES["Dog House"]);
  assert.deepEqual((doc.songs as { title: string }[]).map((s) => s.title).sort(), [...SONG_TITLES].sort());
  // No other rehearsal gets a location: the sheet never says where the dated ones happened.
  assert.equal((await db.get("rehearsals", "rehearsal-2026-07-26"))!.location, undefined);
});

test("every rehearsal gets its personnel, and 10/20 is the only one with Emma", async () => {
  await world();
  const r = await runImport();
  assert.deepEqual(r.unknownPeople, []);
  const quartet = ["Kai Moreno", "Nico Alvarez", "Sam Okafor", "Vera Lindqvist"];
  for (const date of ["2026-06-28", "2026-07-26", "2026-10-13"]) {
    const doc = (await db.get("rehearsals", `rehearsal-${date}`))!;
    const names = await Promise.all((doc.personnel as string[]).map(async (id) => (await db.get("musicians", id))!.name));
    assert.deepEqual(names.sort(), quartet, date);
  }
  const extra = (await db.get("rehearsals", "rehearsal-2026-10-20"))!;
  const names = await Promise.all((extra.personnel as string[]).map(async (id) => (await db.get("musicians", id))!.name));
  assert.deepEqual(names.sort(), [...quartet, "Rae Whitfield"].sort());
});

test("10/20 is created from Jeff's list even though the sheet has no such column", async () => {
  await world();
  const r = await runImport();
  const c = r.columns.find((x) => x.date === "2026-10-20")!;
  assert.equal(c.col, "--");
  assert.equal(c.action, "created");
  assert.deepEqual(c.songs, []);
  const doc = (await db.get("rehearsals", "rehearsal-2026-10-20"))!;
  assert.deepEqual(doc.songs, []);
  assert.equal((doc.personnel as string[]).length, 5);
});

// ---------- the show columns ----------

test("10/3 becomes a setlist on the Porchfest show, not a rehearsal", async () => {
  await world();
  const r = await runImport();
  const c = colOf(r, "T");
  assert.equal(c.kind, "show");
  assert.equal(c.songs.length, 14);
  assert.equal(c.action, "created");
  assert.equal(c.id, "vb-porchfest-denver-2026-10-03"); // a show's setlist lives at its show id
  // The rehearsal collection must not have picked it up.
  assert.equal(await db.get("rehearsals", "rehearsal-2026-10-03"), null);
  const sl = (await db.get("setlists", "vb-porchfest-denver-2026-10-03"))!;
  assert.equal(sl.name, undefined);
  assert.equal(sl.showId, undefined);
  assert.equal((sl.items as unknown[]).length, 14);
  assert.deepEqual((sl.items as { type: string }[]).map((i) => i.type), Array(14).fill("song"));
  // Sheet order is alphabetical, not a running order, and the report has to say so.
  assert.ok(c.issues.some((i) => /not the order they were played/.test(i)));
});

test("the two empty show columns are skipped, and say why", async () => {
  await world();
  const r = await runImport();
  for (const col of ["W", "X"]) {
    const c = colOf(r, col);
    assert.equal(c.action, "skipped");
    assert.equal(c.songs.length, 0);
    assert.ok(c.issues.some((i) => /would claim nothing was played/.test(i)), `${col} says why`);
  }
  assert.equal((await db.list("setlists")).length, 1);
});

test("a show column with no show on that date is reported, not guessed at", async () => {
  await world({ porchfest: false });
  const r = await runImport();
  const c = colOf(r, "T");
  assert.equal(c.action, "skipped");
  assert.ok(c.issues.some((i) => /no show found on 2026-10-03/.test(i)));
  assert.equal((await db.list("setlists")).length, 0);
});

test("two shows on the date is ambiguous, so nothing is written", async () => {
  await world();
  await db.create(importCtx(), "shows", {
    ...showBase, date: "2026-10-03", artistId: TEST_ARTIST, place: { city: "Boulder" },
  }, { id: "vb-other-2026-10-03" });
  const r = await runImport();
  const c = colOf(r, "T");
  assert.equal(c.action, "skipped");
  assert.ok(c.issues.some((i) => /2 shows on 2026-10-03/.test(i)));
  assert.equal((await db.list("setlists")).length, 0);
});

// ---------- things that must be reported rather than lost ----------

test("a ✅ on a row whose song is missing is reported, not dropped", async () => {
  await world({ songs: false });
  const r = await runImport();
  const c = colOf(r, "M");
  assert.equal(c.songs.length, 0);
  assert.equal(c.issues.filter((i) => /no song matches/.test(i)).length, 7);
  // The count still reports what the sheet says, so the mismatch against the import is visible.
  assert.equal(c.ticks, 7);
  const survey = rehearsalHistorySurvey(r);
  assert.ok(group(survey.notes, "unclean").length > 0);
});

test("a '(cover)' title cell still finds the song, which the song list stored without the marker", async () => {
  await world();
  await db.create(importCtx(), "songs", { title: "Luckiest Man", status: "active", fields: [] }, { id: "song-luckiest-man" });
  const snap = fixture();
  // The sheet writes "Luckiest Man (cover)"; the song list imports it as "Luckiest Man".
  snap.values.push(line({ 0: "Luckiest Man (cover)", 1: "D", 2: "80", 20: TICK }));
  const r = await runImport(snap);
  const c = colOf(r, "U");
  assert.deepEqual(c.issues.filter((i) => /no song matches/.test(i)), []);
  assert.ok(c.songs.some((s) => s.songId === "song-luckiest-man" && s.title === "Luckiest Man"));
});

test("a person with no musician record is reported and left out of the personnel", async () => {
  await world({ people: false });
  await db.create(importCtx(), "musicians", { name: "Kai Moreno", email: "kai@example.com", instruments: ["keys"], active: true });
  const r = await runImport();
  assert.deepEqual(r.unknownPeople, [
    "nico@example.com", "rae@example.com", "sam@example.com", "vera@example.com",
  ]);
  const doc = (await db.get("rehearsals", "rehearsal-2026-07-26"))!;
  assert.equal((doc.personnel as string[]).length, 1);
  assert.ok(group(rehearsalHistorySurvey(r).notes, "unclean").some((n) => /has no musician record/.test(n.reason)));
});

test("a moved column is skipped rather than imported under the wrong date", async () => {
  await world();
  const snap = fixture();
  // The sheet gains a column before the history block, so every header shifts one to the right.
  snap.values = snap.values.map((row) => { const r = [...row]; r[13] = "SOMETHING ELSE"; return r; });
  const r = await runImport(snap);
  const c = colOf(r, "N");
  assert.equal(c.action, "skipped");
  assert.ok(c.issues.some((i) => /the sheet has changed since this importer was written/.test(i)));
  assert.equal(await db.get("rehearsals", "rehearsal-2026-07-26"), null);
  // The columns that did not move still import.
  assert.equal(colOf(r, "M").action, "created");
});

test("a tick count that has drifted from the snapshot is reported", async () => {
  await world();
  const snap = fixture();
  // One more ✅ in the Doghouse column than story 18 counted.
  snap.values[8][12] = TICK;
  const r = await runImport(snap);
  const c = colOf(r, "M");
  assert.equal(c.ticks, 8);
  assert.equal(c.expected, 7);
  assert.ok(c.issues.some((i) => /story 18 counted 7/.test(i)));
});

// ---------- re-running ----------

test("a second run over the same snapshot changes nothing", async () => {
  await world();
  await runImport();
  const r = await runImport();
  const written = r.columns.filter((c) => c.action !== "skipped");
  assert.ok(written.length > 0);
  for (const c of written) assert.equal(c.action, "unchanged", `${c.col} ${c.header}`);
  assert.equal((await db.list("rehearsals")).length, 10);
  assert.equal((await db.list("setlists")).length, 1);
});

test("a dry run writes nothing", async () => {
  await world();
  const r = await runImport(fixture(), { dryRun: true });
  assert.ok(r.columns.some((c) => c.action === "created"));
  assert.equal((await db.list("rehearsals")).length, 0);
  assert.equal((await db.list("setlists")).length, 0);
  assert.equal(rehearsalHistorySurvey(r).dryRun, true);
});

test("a roster with nobody on an instrument, or two people on it, fails loudly", async () => {
  const noBass = BAND.filter((p) => !p.instruments.includes("bass"));
  await assert.rejects(importRehearsalHistory({ artist: "test-band", snapshot: fixture(), roster: noBass, places: PLACES }), /"bass"/);
  const twoDrummers = [...BAND, { email: "x@example.com", name: "X", instruments: ["drums"] }];
  await assert.rejects(importRehearsalHistory({ artist: "test-band", snapshot: fixture(), roster: twoDrummers, places: PLACES }), /"drums"/);
});

test("no artist means nothing is imported", async () => {
  const r = await importRehearsalHistory({ artist: "nope", snapshot: fixture(), roster: BAND, places: PLACES });
  assert.equal(r.artist, undefined);
  assert.deepEqual(r.columns, []);
  assert.ok(group(rehearsalHistorySurvey(r).notes, "unclean").some((n) => /NO ARTIST/.test(n.reason)));
});
