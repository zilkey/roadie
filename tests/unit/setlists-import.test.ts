/**
 * The setlists import (story 19). The fixture is a handful of tabs shaped like the real ones: the corrected dates, the two
 * Repeat Venues, the Twin Venue twins, a two-songs-per-row tab, a tab that is really two lists, and every excluded tab
 * carrying a song so that one slipping through would show up as a setlist.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { importSetlists, setlistsSurvey, parseTab, parseDecided, loadSetlistsMap, type SetlistsMap } from "../../scripts/import-setlists";
import type { SetlistsSnapshot } from "../../scripts/snapshot-setlists";
import { group } from "../../scripts/survey";
import { resetEmulators, makeArtist, TEST_ARTIST } from "./helpers";

const slugOf = (t: string) => `song-${t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
const SONGS = ["Low Gravity Day", "High Road", "Take It Easy", "Pace of Trust", "Happy We're Still Fighting", "The IUD Song", "Little Rabbit", "The Ride"];

const showBase = {
  status: "played", personnel: [], sound: { provider: "venueProvided" },
  needs: { poster: false, backline: false, merch: false }, docs: [], listings: {}, times: {}, checklists: [],
};

/** Every date the fixture's tabs map to, plus decoys on dates that Jeff overruled. Show ids are show-<date>. */
const SHOW_DATES = [
  "2025-12-12", "2025-12-05", "2025-04-05", "2025-04-06", "2024-06-27", "2024-06-24",
  "2026-03-19", "2025-03-19", "2025-03-07", "2024-12-15", "2024-10-18", "2024-12-13", "2026-06-26", "2026-05-24",
];

async function world() {
  await makeArtist("Test Band", "test-band");
  for (const t of SONGS) await db.create(importCtx(), "songs", { title: t, status: "active", fields: [] }, { id: slugOf(t) });
  for (const d of SHOW_DATES) {
    await db.create(importCtx(), "shows", { ...showBase, date: d, artistId: TEST_ARTIST, place: { city: "Boulder" } }, { id: `show-${d}` });
  }
  // Two Up and a sibling venue share 2026-10-11, so the date alone can't say which.
  for (const id of ["vb-twoup-2026-10-11", "vb-sibling-2026-10-11"]) {
    await db.create(importCtx(), "shows", { ...showBase, date: "2026-10-11", artistId: TEST_ARTIST, place: { city: "Denver" } }, { id });
  }
  // The Repeat Venue show the 3.19.26 tab is pinned to (Jeff, 2026-10-25), beside the show-2026-03-19 decoy on the very
  // same date that an unpinned date match would otherwise find: the pin must win over a same-date match.
  await db.create(importCtx(), "shows", { ...showBase, date: "2026-03-19", artistId: TEST_ARTIST, place: { city: "Fort Collins" } }, { id: "vb-repeat-2026-03-19" });
}

const col = (...titles: string[]) => titles.map((t) => [t]);
const EXCLUDED = [...Array.from({ length: 16 }, (_, i) => `Excluded ${i + 1}`), "Excluded Pair A", "Excluded Pair B"];
const FAKE_MAP: SetlistsMap = {
  mixtape: {
    venueId: "test-hall", showId: "sl-test-created-2024-10-24", date: "2024-10-24",
    billing: "Test Showcase at Test Hall, featuring Test Performer and Test Guest",
    venue: { name: "Test Hall", type: "other", region: "boulder", address: { street: "1 Example St", city: "Testville", state: "CO", zip: "80000" } },
    loadInNotes: "Load-in 5:15 PM, from the back door.",
    times: { loadIn: "17:15", soundcheck: "17:30", doors: "18:30", showStart: "19:00" },
    comment: "Test Showcase at Test Hall, featuring Test Performer and Test Guest.\nLoad-in 5:15 PM, show 7:00-9:15 PM.",
  },
  tabs: [
    { tab: "Date Fix A 12.5.25", date: "2025-12-12", show: "Test Host House Concert" },
    { tab: "Date Fix B 4.6.25", date: "2025-04-05", show: "Test Club A" },
    { tab: "Date Fix C 6.24.24", date: "2024-06-27", show: "Test Club B" },
    { tab: "Repeat Venue 3.19.26", date: "2026-03-19", show: "Repeat Venue", showId: "vb-repeat-2026-03-19" },
    { tab: "Repeat Venue", date: "2025-03-07", show: "Repeat Venue" },
    { tab: "Twin Venue 12.15.24", date: "2024-12-15", show: "Twin Venue" },
    {
      tab: "Twin Venue 10.15.24", date: "2024-12-15", show: "Twin Venue - same show",
      setAside: { by: "Twin Venue 12.15.24", why: "same show as the 12.15.24 tab; the 12.15.24 contents win" },
    },
    { tab: "twoup", date: "2026-10-11", show: "Two Up Benefit", showId: "vb-twoup-2026-10-11", layout: "twoUp" },
    { tab: "Sibling Venue", date: "2026-10-11", show: "Sibling Venue", showId: "vb-sibling-2026-10-11" },
    { tab: "Alias Tab", date: "2024-10-18", show: "Test Cider" },
    { tab: "Break Tab", date: "2024-12-13", show: "Test Trading Post" },
    { tab: "Multi Column 6.26.26", date: "2026-06-26", show: "Test Host House Show" },
    { tab: "Created Show 10.23", date: "2024-10-24", show: "Test Showcase at Test Hall", showId: "sl-test-created-2024-10-24" },
  ],
  excluded: EXCLUDED.map((tab) => ({ tab, why: "not a setlist" })),
  decided: [],
  aliases: { hwsf: "Happy We're Still Fighting", iud: "The IUD Song" },
};
FAKE_MAP.tabs.find((t) => t.tab === "Created Show 10.23")!.creates = FAKE_MAP.mixtape;

const fixture = (): SetlistsSnapshot => ({
  source: "test", fetchedAt: "2026-10-25",
  tabs: [
    // The three tabs whose title date lost to the booking sheet.
    { title: "Date Fix A 12.5.25", values: col("Low Gravity Day", "High Road") },
    { title: "Date Fix B 4.6.25", values: col("Take It Easy", "High Road") },
    { title: "Date Fix C 6.24.24", values: col("Pace of Trust") },
    // Two Repeat Venues, a year apart.
    { title: "Repeat Venue 3.19.26", values: col("Low Gravity Day", "Pace of Trust") },
    { title: "Repeat Venue", values: col("High Road", "Take It Easy", "Little Rabbit") },
    // Twin Venue: two tabs, one show, the 12.15 contents win.
    { title: "Twin Venue 12.15.24", values: [["Low Gravity Day"], ["High Road"], ["Take It Easy"], [""], ["Jeff Checklist"], ["capo"], ["tuner"]] },
    { title: "Twin Venue 10.15.24", values: col("Pace of Trust", "Little Rabbit") },
    // Two songs per row.
    { title: "twoup", values: [["Low Gravity Day", "High Road"], ["Take It Easy", "Pace of Trust"], ["Little Rabbit", ""]] },
    // An abbreviation Jeff has not reviewed, a lowercase alias, a trailing "?", a "(n)", and a title nothing matches.
    { title: "Alias Tab", values: col("hwsf", "iud", "mystery tune", "high road?", "little rabbit (80)") },
    // An explicit break row.
    { title: "Break Tab", values: col("Low Gravity Day", "---- Break ----", "High Road") },
    // Songs in several columns: several lists, not a running order.
    { title: "Multi Column 6.26.26", values: [["Set 1", "upbeat", "alternates"], ["Low Gravity Day", "High Road", "Take It Easy"], ["Pace of Trust"]] },
    // Created-show: a header with capos and notes, one block.
    {
      title: "Created Show 10.23", values: [
        ["Song", "Capo", "Notes"], ["Low Gravity Day", "3", ""], ["High Road", "", "bring the shaker"], ["Take It Easy", "Capo 2", "slow"],
      ],
    },
    ...EXCLUDED.map((title) => ({ title, values: col("Low Gravity Day", "High Road") })),
  ],
});

/**
 * These tests exercise parseTab's own layout guessing, on fixture tabs named after real ones that Jeff's triage
 * decisions now answer outright (Repeat Venue, Alias Tab, Multi Column...). So `decided: []` by default: a test that
 * silently picked up the production DECIDED table would be asserting against that data, not against this code. The
 * table itself is covered by its own test below and by parseDecided's.
 */
const runImport = (snapshot = fixture(), extra: NonNullable<Parameters<typeof importSetlists>[0]> = {}) =>
  importSetlists({ artist: "test-band", snapshot, decided: [], map: FAKE_MAP, ...extra });
const tabOf = (r: Awaited<ReturnType<typeof runImport>>, tab: string) => r.tabs.find((t) => t.tab === tab)!;
const titlesOf = async (id: string) => ((await db.get("setlists", id))!.items as { title: string }[]).map((i) => i.title);

beforeEach(resetEmulators);

test("a tab whose date is wrong lands on the booking sheet's date", async () => {
  await world();
  const r = await runImport();
  for (const [tab, date] of [["Date Fix A 12.5.25", "2025-12-12"], ["Date Fix B 4.6.25", "2025-04-05"], ["Date Fix C 6.24.24", "2024-06-27"]]) {
    assert.equal(tabOf(r, tab).id, `show-${date}`, tab);
    assert.ok(await db.get("setlists", `show-${date}`), `${tab} landed on ${date}`);
  }
  // The dates in the titles are decoys with shows of their own, and nothing may land there.
  for (const d of ["2025-12-05", "2025-04-06", "2024-06-24"]) assert.equal(await db.get("setlists", `show-${d}`), null, d);
});

test("the two Repeat Venue tabs land on the two different Repeat Venue shows, never one", async () => {
  await world();
  // Jeff's calendar (2026-10-25): the `Repeat Venue 3.19.26` tab belongs to the show on 2026-03-19, as the title says; the
  // booking sheet's 2025-03-19 was the typo. The other Repeat Venue show (2025-03-07) has its own tab, and the pair is
  // the case that must never collapse into one setlist. A decoy show-2026-03-19 shares the pinned show's date.
  const r = await runImport();
  assert.equal(tabOf(r, "Repeat Venue 3.19.26").id, "vb-repeat-2026-03-19");
  assert.equal(tabOf(r, "Repeat Venue").id, "show-2025-03-07");
  assert.deepEqual(await titlesOf("vb-repeat-2026-03-19"), ["Low Gravity Day", "Pace of Trust"]);
  assert.deepEqual(await titlesOf("show-2025-03-07"), ["High Road", "Take It Easy", "Little Rabbit"]);
  // Nothing lands on the same-date decoy, nor on the 2025-03-19 date the booking sheet wrongly claimed.
  assert.equal(await db.get("setlists", "show-2026-03-19"), null);
  assert.equal(await db.get("setlists", "show-2025-03-19"), null);
});

test("the two Twin Venue tabs make exactly one setlist, with the 12.15 contents", async () => {
  await world();
  const r = await runImport();
  assert.deepEqual(await titlesOf("show-2024-12-15"), ["Low Gravity Day", "High Road", "Take It Easy"]);
  assert.equal(tabOf(r, "Twin Venue 12.15.24").action, "created");
  const twin = tabOf(r, "Twin Venue 10.15.24");
  assert.equal(twin.action, "set aside");
  assert.equal(twin.songs, 2);
  assert.ok(twin.issues.some((i) => i.bucket === "deferred" && /2 song/.test(i.detail ?? "")));
  // The Checklist rows under the ten songs are not songs, and the report says they were left unread.
  assert.ok(tabOf(r, "Twin Venue 12.15.24").issues.some((i) => /Checklist/.test(i.reason)));
});

test("the 18 excluded tabs produce nothing, and are reported as read and skipped", async () => {
  await world();
  const r = await runImport();
  assert.equal(r.excluded.length, 18);
  assert.ok(r.excluded.every((e) => e.found && e.rows > 0));
  assert.equal(r.tabs.some((t) => EXCLUDED.includes(t.tab)), false);
  assert.equal(r.unknownTabs.length, 0);
  // Both Excluded Pair tabs are out, so that show (which exists) has no setlist, and nothing else was written from them.
  assert.equal(await db.get("setlists", "show-2026-05-24"), null);
  const ids = (await db.list("setlists")).map((s) => s.id).sort();
  assert.deepEqual(ids, [
    "show-2024-10-18", "show-2024-12-13", "show-2024-12-15", "show-2024-06-27", "show-2025-03-07", "show-2025-04-05",
    "show-2025-12-12", "vb-repeat-2026-03-19", "sl-test-created-2024-10-24", "vb-twoup-2026-10-11",
  ].sort());
  const deferred = group(setlistsSurvey(r).notes, "deferred").find((g) => /not a setlist/.test(g.reason))!;
  assert.equal(deferred.rows.length, 18);
});

test("Created-show creates its venue and show, and its setlist lands on 2024-10-24", async () => {
  await world();
  const r = await runImport();
  assert.deepEqual(r.mixtape, { venue: "created", show: "created", comment: "created" });
  const show = (await db.get("shows", "sl-test-created-2024-10-24"))!;
  assert.equal(show.date, "2024-10-24");
  assert.equal(show.status, "played");
  assert.equal((show.venue as { id: string }).id, "test-hall");
  assert.deepEqual(show.times, { loadIn: "17:15", soundcheck: "17:30", doors: "18:30", showStart: "19:00" });
  const venue = (await db.get("venues", "test-hall"))!;
  assert.deepEqual(venue.address, { street: "1 Example St", city: "Testville", state: "CO", zip: "80000" });
  const comments = await db.list("shows/sl-test-created-2024-10-24/comments");
  assert.ok(/Test Performer and Test Guest/.test(comments[0].body as string));
  assert.equal(tabOf(r, "Created Show 10.23").id, "sl-test-created-2024-10-24");
  // Capo is not a key: it goes in the note, with the tab's own notes.
  const items = (await db.get("setlists", "sl-test-created-2024-10-24"))!.items as { title: string; key?: string; note?: string }[];
  assert.deepEqual(items.map((i) => i.note), ["Capo 3", "bring the shaker", "Capo 2; slow"]);
  assert.ok(items.every((i) => i.key === undefined));
});

test("a Created-show tab holding two drafts still makes the show, but no setlist", async () => {
  await world();
  const snap = fixture();
  snap.tabs.find((t) => t.title === "Created Show 10.23")!.values = [
    ["Song", "Capo", "Notes"], ["Low Gravity Day", "3", ""], [""], [""], ["High Road", "", ""], ["The IUD Song", "", ""], ["The IUD Song", "", ""],
  ];
  const r = await runImport(snap);
  assert.equal(r.mixtape!.show, "created");
  assert.ok(await db.get("shows", "sl-test-created-2024-10-24"));
  assert.equal(await db.get("setlists", "sl-test-created-2024-10-24"), null);
  assert.equal(tabOf(r, "Created Show 10.23").action, "skipped");
  assert.ok(tabOf(r, "Created Show 10.23").issues.some((i) => i.bucket === "decide" && /second block/.test(i.reason)));
});

test("an unmatched title is reported and kept as an item with no songId", async () => {
  await world();
  const r = await runImport();
  const t = tabOf(r, "Alias Tab");
  assert.deepEqual(t.unmatched, [{ row: 3, title: "mystery tune" }]);
  const items = (await db.get("setlists", "show-2024-10-18"))!.items as { type: string; title: string; songId?: string; note?: string }[];
  assert.equal(items.length, 5); // nothing dropped
  assert.equal(items[2].title, "mystery tune");
  assert.equal(items[2].songId, undefined);
  // The reviewed aliases and the cleaned titles do find their songs.
  assert.equal(items[0].songId, slugOf("Happy We're Still Fighting"));
  assert.equal(items[1].songId, slugOf("The IUD Song"));
  assert.equal(items[3].songId, slugOf("High Road"));
  assert.equal(items[3].note, "maybe");
  assert.equal(items[4].note, "(80)");
  const decide = group(setlistsSurvey(r).notes, "decide");
  assert.ok(decide.some((g) => /matches no song/.test(g.reason) && g.rows.some((n) => /mystery tune/.test(n.detail ?? ""))));
});

test("two columns of songs read down the first, then down the second", async () => {
  await world();
  const r = await runImport();
  assert.equal(tabOf(r, "twoup").layout, "twoUp");
  // Jeff, 2026-10-25: column A is the first part of the set and column B carries on from its bottom. Reading across
  // the rows instead would give ["Low Gravity Day", "High Road", "Take It Easy", ...] -- every title right, order wrong.
  assert.deepEqual(await titlesOf("vb-twoup-2026-10-11"), ["Low Gravity Day", "Take It Easy", "Little Rabbit", "High Road", "Pace of Trust"]);
  // The Sibling show on the same date got nothing: the pin kept the two apart.
  assert.equal(await db.get("setlists", "vb-sibling-2026-10-11"), null);
});

test("row order is preserved, and an explicit break row becomes a break item", async () => {
  await world();
  await runImport();
  const items = (await db.get("setlists", "show-2024-12-13"))!.items as { type: string; title: string }[];
  assert.deepEqual(items.map((i) => [i.type, i.title]), [["song", "Low Gravity Day"], ["break", "Break"], ["song", "High Road"]]);
});

test("a tab with songs in several columns is handed back for a decision, with no setlist written", async () => {
  await world();
  const r = await runImport();
  const t = tabOf(r, "Multi Column 6.26.26");
  assert.equal(t.layout, "ambiguous");
  assert.equal(t.action, "skipped");
  assert.equal(await db.get("setlists", "show-2026-06-26"), null);
  const why = t.issues.find((i) => i.bucket === "decide")!;
  assert.match(why.detail!, /B: "upbeat"/);
  assert.match(why.detail!, /C: "alternates"/);
});

test("parseTab: a header row is a header, and blank rows between songs are spacing", () => {
  const p = parseTab([["Song", "Capo"], ["a", "2"], [""], ["b", ""]], {});
  assert.equal(p.layout, "headered");
  assert.deepEqual(p.lines.map((l) => [l.raw, l.note]), [["a", "Capo 2"], ["b", undefined]]);
});

test("parseDecided: picked columns are read in order, down each, and joined", () => {
  // Two sets side by side, as Jeff picked A then C on the two-set tabs.
  const grid = [["Set 1", "", "Set 2"], ["a", "", "d"], ["b", "", "e"], ["c", "", ""]];
  const p = parseDecided(grid, { tab: "x", cols: [{ col: 0, from: 2 }, { col: 2, from: 2 }] });
  assert.deepEqual(p.lines.map((l) => l.raw), ["a", "b", "c", "d", "e"]);
  assert.equal(p.passedOver, 2, "the two headings were not read");
});

test("parseDecided: a row range stops where Jeff said, and breakBetween separates the columns", () => {
  // "A 1:16 / C 18:27" -- a setlist with gear under it, and a second set in another column.
  const grid = [["a"], ["b"], ["TRUE"], ["junk"]];
  const p = parseDecided(grid, { tab: "x", cols: [{ col: 0, from: 1, to: 2 }] });
  assert.deepEqual(p.lines.map((l) => l.raw), ["a", "b"]);
  assert.equal(p.passedOver, 2);

  const two = parseDecided([["a", "c"], ["b", "d"]], { tab: "x", cols: [{ col: 0 }, { col: 1 }], breakBetween: true });
  assert.deepEqual(two.lines.map((l) => [l.kind, l.raw]), [
    ["song", "a"], ["song", "b"], ["break", "Set 2"], ["song", "c"], ["song", "d"],
  ]);
});

test("parseDecided: a heading caught at the top of a picked column is not imported as a song", () => {
  // Jeff's ranges start at row 1 where the songs look like they start; on these tabs row 1 is a heading, and reading it
  // literally put the word "Song" in six setlists.
  for (const head of ["Song", "Main", "Upbeat/faster Songs", "Order"]) {
    const p = parseDecided([[head], ["High Road"]], { tab: "x", cols: [{ col: 0, from: 1, to: 2 }] });
    assert.deepEqual(p.lines.map((l) => l.raw), ["High Road"], `"${head}" is a heading`);
    assert.ok(p.issues.some((i) => /heading, not a song/.test(i.reason)));
  }
  // Only the FIRST row of the range can be one: the same word deeper in a column is left alone.
  const deep = parseDecided([["High Road"], ["Song"]], { tab: "x", cols: [{ col: 0 }] });
  assert.deepEqual(deep.lines.map((l) => l.raw), ["High Road", "Song"]);
});

test("parseDecided: a picked column with nothing in the picked rows is reported, not silently empty", () => {
  const p = parseDecided([["a"], ["b"]], { tab: "x", cols: [{ col: 4 }] });
  assert.deepEqual(p.lines, []);
  assert.ok(p.issues.some((i) => i.bucket === "unclean" && /holds no songs/.test(i.reason)));
});

test("a trailing parenthetical that is a direction finds the song; one that names an artist stays a cover", async () => {
  await world();
  const snap = fixture();
  // "The Ride (stillness)" is The Ride with a direction; "Jolene (Dolly Parton)" is how the tabs write a cover, and
  // covers stay unlinked by Jeff's decision -- stripping the artist would make one look like a missing original.
  const i = snap.tabs.findIndex((t) => t.title === "Repeat Venue 3.19.26");
  snap.tabs[i] = { title: "Repeat Venue 3.19.26", values: [["The Ride (stillness)"], ["Jolene (Dolly Parton)"]] };
  const r = await runImport(snap);
  assert.equal(tabOf(r, "Repeat Venue 3.19.26").action, "created");
  const items = (await db.get("setlists", "vb-repeat-2026-03-19"))!.items as { songId?: string; title: string; note?: string }[];
  assert.equal(items[0].songId, "song-the-ride", "the direction was not part of the name");
  assert.equal(items[0].note, "stillness", "and it was kept");
  assert.equal(items[1].songId, undefined, "the cover stays unlinked");
  assert.equal(items[1].title, "Jolene (Dolly Parton)", "with the artist still on it");
});

test("a decided tab is read as Jeff picked it, and one he marked skip writes nothing", async () => {
  await world();
  const snap = fixture();
  // Two sets side by side and a pool of alternates in E: parseTab refuses this, a decision resolves it.
  snap.tabs[0] = {
    title: "Date Fix A 12.5.25",
    values: [["Set 1", "", "Set 2", "", "alternates"], ["Low Gravity Day", "", "Take It Easy", "", "High Road"], ["Pace of Trust", "", "", "", "Little Rabbit"]],
  };
  const r = await runImport(snap, {
    decided: [
      { tab: "Date Fix A 12.5.25", cols: [{ col: 0, from: 2 }, { col: 2, from: 2 }], breakBetween: true },
      { tab: "Repeat Venue", skip: true },
    ],
  });
  const t = tabOf(r, "Date Fix A 12.5.25");
  assert.equal(t.action, "created");
  assert.equal(t.layout, "decided");
  assert.deepEqual(await titlesOf("show-2025-12-12"), ["Low Gravity Day", "Pace of Trust", "Set 2", "Take It Easy"]);
  // The alternates column was left behind, and the report says how much.
  assert.ok(t.issues.some((i) => /as Jeff picked it/.test(i.reason) && /not read/.test(i.detail ?? "")));
  // A skipped tab is reported as Jeff's decision and writes nothing.
  assert.equal(tabOf(r, "Repeat Venue").action, "skipped");
  assert.equal(await db.get("setlists", "show-2025-03-07"), null);
  assert.ok(tabOf(r, "Repeat Venue").issues.some((i) => /no single running order/.test(i.reason)));
});

test("a mapped tab missing from the snapshot, and a tab nobody has decided about, are both reported", async () => {
  await world();
  const snap = fixture();
  snap.tabs = snap.tabs.filter((t) => t.title !== "Repeat Venue");
  snap.tabs.push({ title: "Brand New Tab", values: col("High Road") });
  const r = await runImport(snap);
  assert.equal(tabOf(r, "Repeat Venue").action, "skipped");
  assert.deepEqual(r.unknownTabs, ["Brand New Tab"]);
  const s = setlistsSurvey(r);
  assert.ok(group(s.notes, "unclean").some((g) => /not in the snapshot/.test(g.reason)));
  assert.ok(group(s.notes, "decide").some((g) => /neither the mapping/.test(g.reason)));
});

test("a second run reports every tab unchanged", async () => {
  await world();
  await runImport();
  const r = await runImport();
  const written = r.tabs.filter((t) => t.action !== "skipped" && t.action !== "set aside");
  assert.equal(written.length, 10);
  for (const t of written) assert.equal(t.action, "unchanged", t.tab);
  assert.deepEqual(r.mixtape, { venue: "unchanged", show: "unchanged", comment: "unchanged" });
  assert.equal((await db.list("setlists")).length, 10);
  assert.equal((await db.list("venues")).length, 1);
});

test("a dry run writes nothing", async () => {
  await world();
  const r = await runImport(fixture(), { dryRun: true });
  assert.ok(r.tabs.some((t) => t.action === "created"));
  assert.equal((await db.list("setlists")).length, 0);
  assert.equal(await db.get("shows", "sl-test-created-2024-10-24"), null);
  assert.equal(await db.get("venues", "test-hall"), null);
  assert.equal(setlistsSurvey(r).dryRun, true);
});

test("no artist means nothing is imported", async () => {
  const r = await importSetlists({ artist: "nope", snapshot: fixture(), map: FAKE_MAP });
  assert.equal(r.artist, undefined);
  assert.deepEqual(r.tabs, []);
  assert.ok(group(setlistsSurvey(r).notes, "unclean").some((n) => /NO ARTIST/.test(n.reason)));
});

test("a missing mapping file is an error that names the path", () => {
  const path = "/nonexistent/setlists-map.json";
  assert.throws(() => loadSetlistsMap(path), (e: Error) => e.message.includes(path));
});
