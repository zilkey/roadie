/**
 * The setlist-songs import: the 23 originals the setlists play that the Songs tab never listed. The fixture is a few tabs
 * shaped like the real metadata tabs (a `Song | Ingrid | Jeff | BPM | Capo` header, a blank-A header with a Key column, a
 * headerless time column, a bare `Song | Capo | Notes`), with two songs the tabs disagree about and every alias the brief names.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { slug } from "@/schema/normalize";
import { importSetlistSongs, setlistSongsSurvey, harvest, SONGS } from "../../scripts/import-setlist-songs";
import type { SetlistsSnapshot } from "../../scripts/snapshot-setlists";
import { group } from "../../scripts/survey";
import { resetEmulators, TEST_ARTIST } from "./helpers";

const idOf = (title: string) => `song-${slug(title)}`;
const DEFS = [{ id: "f-ingrid", label: "Ingrid Plays" }, { id: "f-jeff", label: "Jeff Plays" }, { id: "f-capo", label: "Capo" }];

async function world(songFields: { id: string; label: string }[] | undefined = DEFS) {
  await db.create(importCtx(), "artists", {
    slug: "ingrid-avison-band", name: "Ingrid Avison Band", driveFolderId: "", links: {},
    configurations: [{ id: "trio", name: "Trio", billingName: "Ingrid Avison Trio", musicianIds: [] }],
    ...(songFields ? { songFields } : {}),
  }, { id: TEST_ARTIST });
}

const fixture = (): SetlistsSnapshot => ({
  source: "test", fetchedAt: "2026-10-25",
  tabs: [
    // The header the brief names: Song | Ingrid | Jeff | BPM | Capo. "Capo 4" is how the real tabs write it.
    {
      title: "Trade and Post 2", values: [
        ["Song", "Ingrid", "Jeff", "BPM", "Capo"],
        ["If It's All About Love", "Acoustic", "Piano", "", "Capo 4"],
        ["Clarity", "Rubber Bridge", "Bass", "", "Capo 3"],
        ["---- Break ----", "", "", "", ""],
        ["Cathy", "Acoustic?", "Piano", "", ""],
        // A capo typed into the Ingrid column, as Trade and Post 1 does for Flowers: a cell in the wrong place, not an instrument.
        ["Flowers", "Capo 1", "", "", ""],
      ],
    },
    // A blank column A header, a Key column, "76bpm".
    {
      title: "Wild Edge_10.10.25", values: [
        ["", "Ingrid", "Jeff", "BPM", "Capo", "Key", "Notes"],
        ["Walk With Me", "Acoustic", "Piano", "76bpm", "", "G", "bring the shaker"],
        ["Saturn", "n/a", "Keys", "", "", "Am", ""],
        ["IIAAL", "", "", "", "4", "", ""],
        ["Morphine", "", "", "", "", "Bb", ""],
        ["RunOnSentence", "", "", "", "", "A E Bm", ""],
      ],
    },
    // Headerless duration column, as on the real Swallow Hill tab.
    {
      title: "Swallow Hill 12.15.24", values: [
        ["Song", "Ingrid", "Jeff", "BPM", "", ""],
        ["Friends", "Keys", "Bass", "", "", "3:20"],
        ["Santa is a Silver Fox", "-", "Keys", "80", "", "2:25"],
      ],
    },
    // Disagrees about Saturn's key, repeats Santa under two other names with the same values, and states Clarity's capo again.
    {
      title: "Hotel", values: [
        ["Song", "Ingrid", "Jeff", "BPM", "Capo", "Key"],
        ["Saturn", "", "", "", "", "C"],
        ["Santa Claus", "", "", "80", "", ""],
        ["santa = silver fox", "", "", "", "", ""],
        ["Clarity", "", "", "", "Capo 2", ""],
      ],
    },
    { title: "Mixtape 10.23", values: [["Song", "Capo", "Notes"], ["If It's All About Love", "Capo 4", "associating emotional pain"], ["Jesus, Peter", "", ""]] },
    // Length as two columns, and a seconds cell that is not seconds ("27 | 188" is a running total typed into the row).
    {
      title: "Mercury Cafe 6.24.24", values: [
        ["Song", "Min", "Sec", "Ingrid", "Jeff"],
        ["Hungry Ghosts", "3", "25", "", ""],
        ["Cathy", "2", "188", "", ""],
      ],
    },
    // No header: a plain setlist. Its titles name songs, and say nothing about them.
    { title: "Boco Cider", values: [["Hungry Ghosts"], ["Witch"], ["Walk With Me"], ["Santa Claus"]] },
    // Right words, but column A says "Order": which song a row describes is not certain, so nothing is read (Witch stays an idea).
    { title: "Roots 9.21.24", values: [["Order", "", "Ingrid", "Jeff", "Steve", "BPM", "Capo"], ["1", "Witch", "", "", "", "99", "Capo 2"]] },
    // No header at all, but an m:ss next to a song.
    { title: "Steve's Guitars 1.10.25", values: [["Flowers", "Acoustic", "Keys", "", "", "3:20"]] },
  ],
});

const runImport = (snapshot = fixture(), extra: { dryRun?: boolean } = {}) => importSetlistSongs({ artist: "ingrid-avison-band", snapshot, ...extra });
const rowOf = (r: Awaited<ReturnType<typeof runImport>>, title: string) => r.songs.find((s) => s.title === title)!;
const valueOf = (song: Record<string, any>, fieldId: string) => (song.fields as { fieldId: string; value: string }[]).find((v) => v.fieldId === fieldId)?.value;

beforeEach(resetEmulators);

test("the table is 23 originals, each with its own id", () => {
  assert.equal(SONGS.length, 23);
  assert.equal(new Set(SONGS.map((s) => idOf(s.title))).size, 23);
});

test("all 23 songs are created at song-<slug>", async () => {
  await world();
  const r = await runImport();
  assert.equal(r.songs.length, 23);
  assert.ok(r.songs.every((s) => s.action === "created"));
  const ids = (await db.list("songs")).map((s) => s.id).sort();
  assert.deepEqual(ids, SONGS.map((s) => idOf(s.title)).sort());
  assert.equal((await db.get("songs", idOf("Jesus, Peter")))!.title, "Jesus, Peter");
});

test("Santa Claus and 'santa = silver fox' are the one song, and make no second record", async () => {
  await world();
  await runImport();
  assert.equal(await db.get("songs", "song-santa-claus"), null);
  assert.equal(await db.get("songs", "song-santa-silver-fox"), null);
  const titles = (await db.list("songs")).map((s) => s.title as string);
  assert.equal(titles.filter((t) => /santa/i.test(t)).length, 1);
  // Three spellings, one value: the 80 bpm is stated under "Santa is a Silver Fox" and "Santa Claus" and agrees.
  const santa = (await db.get("songs", idOf("Santa is a Silver Fox")))!;
  assert.equal(santa.bpm, 80);
  assert.equal(santa.lengthSec, 145);
});

test("a song that already exists is reported unchanged and is not rewritten", async () => {
  await world();
  await db.create(importCtx(), "songs", { title: "Walk With Me", status: "learning", key: "D", fields: [] }, { id: idOf("Walk With Me") });
  const r = await runImport();
  assert.equal(rowOf(r, "Walk With Me").action, "unchanged");
  const song = (await db.get("songs", idOf("Walk With Me")))!;
  assert.equal(song.key, "D");
  assert.equal(song.status, "learning");
  assert.equal(song.bpm, undefined);
  assert.equal(r.songs.filter((s) => s.action === "created").length, SONGS.length - 1);
  // It is surprising, so it is on Jeff's list.
  assert.ok(group(setlistSongsSurvey(r).notes, "decide").some((g) => /already exists/.test(g.reason) && g.rows.some((n) => n.where === "Walk With Me")));
});

test("key, bpm, length, capo and the plays fields land on the song the tab named, under any alias", async () => {
  await world();
  const r = await runImport();
  const walk = (await db.get("songs", idOf("Walk With Me")))!;
  assert.equal(walk.key, "G");
  assert.equal(walk.bpm, 76); // "76bpm"
  assert.equal(valueOf(walk, "f-ingrid"), "Acoustic");
  // The tab says "Piano"; the Songs tab's own word for it is "Keys" (25 songs, never "Piano"), so that is what is stored.
  assert.equal(valueOf(walk, "f-jeff"), "Keys");
  // IIAAL is If It's All About Love, and two tabs state Capo 4 -- agreeing, so it is used.
  const love = (await db.get("songs", idOf("If It's All About Love")))!;
  assert.equal(valueOf(love, "f-capo"), "4");
  assert.deepEqual(rowOf(r, "If It's All About Love").sources.find((s) => s.field === "Capo")!.tabs.sort(), ["Mixtape 10.23", "Trade and Post 2", "Wild Edge_10.10.25"]);
  assert.equal((await db.get("songs", idOf("Run On Sentence")))!.key, "A E Bm");
  assert.equal((await db.get("songs", idOf("Friends")))!.lengthSec, 200); // 3:20 from a column with no header
  // "n/a" is that person playing nothing, as in the song-list import.
  assert.equal(valueOf((await db.get("songs", idOf("Saturn")))!, "f-ingrid"), "none");
});

test("two tabs disagreeing about a key leave it unset, and the conflict names both values and tabs", async () => {
  await world();
  const r = await runImport();
  const saturn = (await db.get("songs", idOf("Saturn")))!;
  assert.equal(saturn.key, undefined, "neither Am nor C was picked");
  const c = r.conflicts.find((x) => x.title === "Saturn" && x.field === "key")!;
  assert.deepEqual(c.values.map((v) => [v.value, v.tabs]).sort(), [["Am", ["Wild Edge_10.10.25"]], ["C", ["Hotel"]]]);
  // Capo disagrees on Clarity ("Capo 3" vs "Capo 2"), and no capo value is written.
  assert.ok(r.conflicts.some((x) => x.title === "Clarity" && x.field === "Capo"));
  assert.equal(valueOf((await db.get("songs", idOf("Clarity")))!, "f-capo"), undefined);
  const decide = group(setlistSongsSurvey(r).notes, "decide").find((g) => /disagree/.test(g.reason))!;
  const line = decide.rows.find((n) => n.where === "Saturn")!.detail!;
  assert.match(line, /"Am" \(Wild Edge_10\.10\.25\)/);
  assert.match(line, /"C" \(Hotel\)/);
  assert.equal(r.conflicts.length, 2);
});

test("Morphine Smile is created as an original: writers unset, key harvested through the 'Morphine' alias", async () => {
  await world();
  await runImport();
  const song = (await db.get("songs", idOf("Morphine Smile")))!;
  assert.equal(song.title, "Morphine Smile");
  assert.equal(song.writers, undefined);
  assert.equal(song.key, "Bb");
  for (const s of await db.list("songs")) assert.equal(s.writers, undefined, s.id);
});

test("status: every imported song is active, title-only or not", async () => {
  await world();
  const r = await runImport();
  assert.equal(rowOf(r, "Witch").status, "active");
  assert.equal((await db.get("songs", idOf("Witch")))!.status, "active");
  assert.equal((await db.get("songs", idOf("Get Up Again")))!.status, "active");
  assert.equal((await db.get("songs", idOf("Walk With Me")))!.status, "active");
  assert.equal((await db.get("songs", idOf("Friends")))!.status, "active"); // length only
  assert.equal((await db.get("songs", idOf("Saturn")))!.status, "active");
  // A title-only song stores nothing it was not told.
  const witch = (await db.get("songs", idOf("Witch")))!;
  assert.equal(witch.key, undefined);
  assert.deepEqual(witch.fields, []);
});

test("a tentative cell is reported and not written", async () => {
  await world();
  const r = await runImport();
  const cathy = (await db.get("songs", idOf("Cathy")))!;
  assert.equal(valueOf(cathy, "f-ingrid"), undefined, '"Acoustic?" is not evidence');
  assert.equal(valueOf(cathy, "f-jeff"), "Keys");
  assert.ok(rowOf(r, "Cathy").issues.some((i) => i.bucket === "deferred" && /Acoustic\?/.test(i.detail ?? "")));
  // The "-" for Santa's Ingrid cell is the same.
  assert.equal(valueOf((await db.get("songs", idOf("Santa is a Silver Fox")))!, "f-ingrid"), undefined);
});

test("an instrument is stored the way the Songs tab spells it, so one instrument is not two disagreeing values", async () => {
  await world();
  const r = await runImport();
  // The tabs write Jeff's instrument as "Piano"; the Songs tab calls it "Keys" on 25 of its 41 songs and never
  // "Piano", so that is what is stored. Without this, a song whose tabs use both words reads as a disagreement and
  // loses the field -- which is what the real import did for 6 of its 13 conflicts before normalising (2026-10-25).
  assert.equal(valueOf((await db.get("songs", idOf("Walk With Me")))!, "f-jeff"), "Keys");
  assert.equal(valueOf((await db.get("songs", idOf("Cathy")))!, "f-jeff"), "Keys");
  assert.ok(!rowOf(r, "Walk With Me").issues.some((i) => /disagree/.test(i.reason)), "one instrument, one value");
  // A word the Songs tab does not settle is kept exactly as written: "Rubber Bridge" is a different guitar, not a
  // different spelling, so it is never folded into "Acoustic".
  assert.equal(valueOf((await db.get("songs", idOf("Clarity")))!, "f-ingrid"), "Rubber Bridge");
});

test("length given as Min and Sec columns is read, and a seconds cell over 59 is reported and not used", async () => {
  await world();
  const r = await runImport();
  assert.equal((await db.get("songs", idOf("Hungry Ghosts")))!.lengthSec, 205);
  assert.equal((await db.get("songs", idOf("Hungry Ghosts")))!.status, "active");
  assert.equal((await db.get("songs", idOf("Cathy")))!.lengthSec, undefined);
  assert.ok(rowOf(r, "Cathy").issues.some((i) => i.bucket === "unclean" && /2:188/.test(i.detail ?? "")));
});

test("a capo typed into an instrument column is not an instrument", async () => {
  await world();
  const r = await runImport();
  const flowers = (await db.get("songs", idOf("Flowers")))!;
  assert.equal(valueOf(flowers, "f-ingrid"), undefined);
  assert.ok(rowOf(r, "Flowers").issues.some((i) => i.bucket === "unclean" && /Capo 1/.test(i.detail ?? "")));
});

test("tabs that look like metadata but cannot be tied to a song are reported, and nothing is read from them", async () => {
  await world();
  const r = await runImport();
  assert.deepEqual(r.unread.map((u) => u.tab), ["Roots 9.21.24", "Steve's Guitars 1.10.25"]);
  const witch = (await db.get("songs", idOf("Witch")))!;
  assert.equal(witch.status, "active");
  assert.deepEqual(witch.fields, []);
  assert.equal(rowOf(r, "Witch").values.length, 0);
  assert.ok(group(setlistSongsSurvey(r).notes, "decide").some((g) => /was not read/.test(g.reason) && g.rows.some((n) => n.where === "Roots 9.21.24")));
});

test("existing field definitions are reused, never duplicated, and the values use their ids", async () => {
  await world();
  const r = await runImport();
  assert.ok(r.fields.length > 0 && r.fields.every((f) => f.action === "reused"));
  assert.deepEqual(r.fields.map((f) => f.id).sort(), ["f-capo", "f-ingrid", "f-jeff"]);
  assert.equal(((await db.get("artists", TEST_ARTIST))!.songFields as unknown[]).length, 3);
});

test("a missing definition is created once, by label, and reported", async () => {
  await world([{ id: "f-capo", label: "Capo" }]);
  const r = await runImport();
  assert.deepEqual(r.fields.map((f) => [f.label, f.action]), [["Ingrid Plays", "created"], ["Jeff Plays", "created"], ["Capo", "reused"]]);
  const defs = (await db.get("artists", TEST_ARTIST))!.songFields as { id: string; label: string }[];
  assert.deepEqual(defs.map((f) => f.label), ["Capo", "Ingrid Plays", "Jeff Plays"]);
  const ingrid = defs.find((f) => f.label === "Ingrid Plays")!.id;
  assert.equal(valueOf((await db.get("songs", idOf("Walk With Me")))!, ingrid), "Acoustic");
  assert.ok(group(setlistSongsSurvey(r).notes, "decide").some((g) => /did not exist/.test(g.reason)));
  await runImport();
  assert.equal(((await db.get("artists", TEST_ARTIST))!.songFields as unknown[]).length, 3);
});

test("a dry run writes nothing, not even a song field, and still reports what it would do", async () => {
  await world([]);
  const r = await runImport(fixture(), { dryRun: true });
  assert.equal(r.songs.length, 23);
  assert.ok(r.songs.every((s) => s.action === "created"));
  assert.equal((await db.list("songs")).length, 0);
  assert.deepEqual((await db.get("artists", TEST_ARTIST))!.songFields, []);
  assert.ok(r.fields.every((f) => f.action === "created"));
  assert.equal(setlistSongsSurvey(r).dryRun, true);
});

test("a second run reports every song unchanged and writes nothing new", async () => {
  await world();
  await runImport();
  const r = await runImport();
  assert.equal(r.songs.length, 23);
  for (const s of r.songs) assert.equal(s.action, "unchanged", s.title);
  assert.equal((await db.list("songs")).length, 23);
  // Its own earlier output is not "surprising".
  assert.equal(r.songs.flatMap((s) => s.issues).filter((i) => /already exists/.test(i.reason)).length, 0);
});

test("harvest reads only tabs with a header, and a Notes column is never read", () => {
  const h = harvest(fixture());
  assert.deepEqual(h.tabs.map((t) => t.tab), ["Trade and Post 2", "Wild Edge_10.10.25", "Swallow Hill 12.15.24", "Hotel", "Mixtape 10.23", "Mercury Cafe 6.24.24"]);
  assert.equal([...h.observed.values()].flat().some((o) => /shaker|emotional/.test(o.value)), false);
  assert.equal([...h.observed.values()].flat().some((o) => o.tab === "Boco Cider"), false);
});

test("no artist means nothing is imported", async () => {
  const r = await importSetlistSongs({ artist: "nope", snapshot: fixture() });
  assert.equal(r.artist, undefined);
  assert.deepEqual(r.songs, []);
  assert.ok(group(setlistSongsSurvey(r).notes, "unclean").some((n) => /NO ARTIST/.test(n.reason)));
});
