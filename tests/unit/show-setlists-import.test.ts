/**
 * The show-setlists import: the four fall 2026 tabs of the song-list sheet. The fixture tabs are cut-down copies of the
 * real layouts: Key/Seconds/Ingrid/Jeff/Transition columns, a BREAK row, an unheaded "x" column, totals and a parked
 * song under the set, and the abbreviations the Warped Fest tab uses.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { importShowSetlists, showSetlistsSurvey, parseShowTab } from "../../scripts/import-show-setlists";
import type { SetlistsSnapshot } from "../../scripts/snapshot-setlists";
import { resetEmulators, makeArtist, TEST_ARTIST } from "./helpers";

const slugOf = (t: string) => `song-${t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
const SONGS = ["Digging for the Diamond", "Low Gravity Day", "Happy We're Still Fighting", "The IUD Song", "The Bliss", "Helpless", "Take It Easy"];
const SHOWS = ["vb-grossen-bart-2026-09-20", "vb-porchfest-denver-2026-10-03", "vb-jamestown-merc-2026-10-16", "vb-trident-2026-10-17"];

const showBase = {
  status: "played", personnel: [], sound: { provider: "venueProvided" },
  needs: { poster: false, backline: false, merch: false }, docs: [], listings: {}, times: {}, checklists: [],
};

async function world() {
  await makeArtist("Test Band", "test-band");
  for (const t of SONGS) await db.create(importCtx(), "songs", { title: t, status: "active", fields: [] }, { id: slugOf(t) });
  for (const id of SHOWS) {
    await db.create(importCtx(), "shows", { ...showBase, date: id.slice(-10), artistId: TEST_ARTIST, place: { city: "Boulder" } }, { id });
  }
}

const HEAD = ["Song", "Key", "Tempo", "Time", "Seconds", "Ingrid", "Jeff", "Transition", "Transition Time (s)"];
const fixture = (): SetlistsSnapshot => ({
  source: "test", fetchedAt: "2026-10-25",
  tabs: [
    {
      title: "Warped Fest Setlist", values: [
        HEAD,
        ["Digging for the Diamond", "G", "103", "3:10", "190", "Acoustic", "Keys", "Eric counts off, band starts", "0"],
        ["HWSF", "Gb", "98", "2:28", "148", "n/a", "Keys", "", "15"],
        ["IUD", "A", "95", "3:14", "", "Acoustic", "Keys", "Banter", "60"],
        ["", "", "", "", "", "", "", "", ""],
        ["Total Time", "", "", "25", "1478", "", "", "", "3.75"],
      ],
    },
    {
      title: "Jamestown Merc '26", values: [
        ["Song", "Key", "Tempo", "Time", "Seconds", "Ingrid", "Jeff", "Notes", "Transition", "Time (s)", ""],
        ["Take It Easy ", "G", "76", "4:09", "249", "Acoustic", "Keys", "two solos", "", "30", ""],
        ["Helpless (Cover)", "D", "70", "4:00", "240", "", "", "", "", "30", "x"],
        ["BREAK", "", "", "", "", "", "", "", "", "", ""],
        ["Mystery Tune", "", "", "3:00", "180", "", "", "", "", "30", ""],
        ["", "", "", "", "", "", "", "", "", "", ""],
        ["Song Seconds", "", "", "", "669", "", "", "", "", "", ""],
      ],
    },
    {
      title: "Trident '26", values: [
        ["Song", "Key", "Seconds", "NOTE from show"],
        ["The Bliss (Ingrid Solo)", "", "190", ""],
        ["Low Gravity Day", "F", "172", "slow bpm ~2"],
        ["", "", "", ""],
        ["Take It Easy", "G", "249", ""],
      ],
    },
    // Denver Porchfest is missing: a renamed tab must be reported, not skipped silently.
  ],
});

const run = () => importShowSetlists({ artist: "test-band", snapshot: fixture() });

beforeEach(resetEmulators);

test("each tab becomes its show's setlist, in sheet order, with key, length and notes", async () => {
  await world();
  const r = await run();
  const warped = (await db.get("setlists", "vb-grossen-bart-2026-09-20"))!;
  assert.deepEqual(warped.items, [
    { type: "song", songId: slugOf("Digging for the Diamond"), title: "Digging for the Diamond", lengthSec: 190, key: "G", note: "Ingrid: Acoustic; Jeff: Keys; Transition: Eric counts off, band starts" },
    { type: "song", songId: slugOf("Happy We're Still Fighting"), title: "Happy We're Still Fighting", lengthSec: 148, key: "Gb", note: "Ingrid: n/a; Jeff: Keys" },
    // No Seconds: the Time column stands in.
    { type: "song", songId: slugOf("The IUD Song"), title: "The IUD Song", lengthSec: 194, key: "A", note: "Ingrid: Acoustic; Jeff: Keys; Transition: Banter" },
  ]);
  assert.equal(warped.totalSec, 190 + 148 + 194);
  assert.equal(r.tabs.find((t) => t.tab === "Warped Fest Setlist")!.action, "created");
});

test("a BREAK row is a break, a (Cover) suffix still finds the song, and a miss is kept and reported", async () => {
  await world();
  const r = await run();
  const items = (await db.get("setlists", "vb-jamestown-merc-2026-10-16"))!.items as { type: string; title: string; songId?: string }[];
  assert.deepEqual(items.map((i) => [i.type, i.title, i.songId]), [
    ["song", "Take It Easy", slugOf("Take It Easy")],
    ["song", "Helpless", slugOf("Helpless")],
    ["break", "BREAK", undefined],
    ["song", "Mystery Tune", undefined],
  ]);
  const tab = r.tabs.find((t) => t.tab === "Jamestown Merc '26")!;
  assert.deepEqual(tab.unmatched, [{ row: 5, title: "Mystery Tune" }]);
  assert.ok(tab.issues.some((i) => i.reason.includes("no header") && i.detail?.includes('K: "x"')));
  assert.ok(tab.issues.some((i) => i.reason.includes("under the set")));
});

test("a direction in parentheses goes in the note, and nothing below the first blank row is read", async () => {
  await world();
  await run();
  const items = (await db.get("setlists", "vb-trident-2026-10-17"))!.items as { title: string; note?: string }[];
  assert.deepEqual(items.map((i) => [i.title, i.note]), [["The Bliss", "Ingrid Solo"], ["Low Gravity Day", "From the show: slow bpm ~2"]]);
});

test("a missing tab or show writes nothing and says why; a re-run is unchanged; a different setlist is an overwrite", async () => {
  await world();
  await db.softDelete(importCtx(), "shows", "vb-trident-2026-10-17");
  const r = await run();
  assert.equal(r.tabs.find((t) => t.tab === "Denver Porchfest '26")!.action, "skipped");
  assert.equal(r.tabs.find((t) => t.tab === "Trident '26")!.action, "skipped");
  assert.equal(await db.get("setlists", "vb-trident-2026-10-17"), null);

  assert.equal((await run()).tabs.find((t) => t.tab === "Warped Fest Setlist")!.action, "unchanged");

  await db.update(importCtx(), "setlists", "vb-grossen-bart-2026-09-20", { items: [{ type: "song", title: "Something else" }] });
  const again = await run();
  const warped = again.tabs.find((t) => t.tab === "Warped Fest Setlist")!;
  assert.equal(warped.action, "updated");
  assert.ok(showSetlistsSurvey(again).notes.some((n) => n.bucket === "overwrite"));
});

test("a dry run writes nothing", async () => {
  await world();
  const r = await importShowSetlists({ artist: "test-band", snapshot: fixture(), dryRun: true });
  assert.equal(r.tabs.find((t) => t.tab === "Warped Fest Setlist")!.action, "created");
  assert.equal(await db.get("setlists", "vb-grossen-bart-2026-09-20"), null);
});

test("parseShowTab refuses a tab with no Song header", () => {
  const { lines, issues } = parseShowTab([["Title"], ["Low Gravity Day"]]);
  assert.equal(lines.length, 0);
  assert.equal(issues[0].bucket, "unclean");
});
