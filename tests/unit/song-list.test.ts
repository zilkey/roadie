/**
 * The song-list import and its snapshot merge. The pure link merge needs no emulator; the import is driven through a
 * hand-built snapshot modelled on the real Songs tab (header by column: A Songs, B Key, C Tempo, D Time, E Time (s),
 * F Ingrid, G Jeff, H Capo*, I Original, J Demo, L Rehearsed, M.. dates, AC Genre, AD MC6 PC, AE H90 Bank, AF Iridium Bank).
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { importCtx, newRunId, type Ctx } from "@/server/ctx";
import { mergeCellLinks, numericTitleRows, gridValues, gridLinks, type GridRow, type SongListSnapshot } from "../../scripts/snapshot-song-list";
import { importSongList, songListSurvey, cleanTitle } from "../../scripts/import-song-list";
import { group } from "../../scripts/survey";
import { resetEmulators, makeUser, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.GMAIL_BASE_URL = s.running["fake-gmail"].url;
  process.env.CALENDAR_BASE_URL = s.running["fake-calendar"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};

beforeEach(async () => {
  await resetEmulators();
  const u = await makeUser("jeff@example.com", "admin", { name: "Jeff Smith" });
  ctx = { uid: u.uid, role: "admin", via: "app", runId: newRunId() };
  await db.create(importCtx(), "artists", {
    slug: "ingrid-avison-band", name: "Ingrid Avison Band", driveFolderId: "", links: {},
    configurations: [{ id: "trio", name: "Trio", billingName: "Ingrid Avison Trio", musicianIds: [] }],
  }, { id: TEST_ARTIST });
});

const CHART = "https://docs.google.com/document/d/CHART1/edit";
const SP1 = "https://open.spotify.com/track/aaa";
const SP2 = "https://open.spotify.com/track/bbb";
const YT = "https://www.youtube.com/watch?v=abc";
const DRIVE = "https://drive.google.com/file/d/DEMO1/view";

// ---------- the cell-link merge (pure) ----------

test("merge: a whole-cell hyperlink with no runs is one link titled with the cell's text", () => {
  assert.deepEqual(mergeCellLinks({ formattedValue: "Animal", hyperlink: CHART }), [{ url: CHART, text: "Animal" }]);
});

test("merge: a two-link cell yields two links, titled by their runs, in order", () => {
  const links = mergeCellLinks({
    formattedValue: "Duo On Youtube, Production Demo",
    textFormatRuns: [{ format: { link: { uri: YT } } }, { format: {}, startIndex: 14 }, { format: { link: { uri: DRIVE } }, startIndex: 16 }],
  });
  assert.deepEqual(links, [{ url: YT, text: "Duo On Youtube" }, { url: DRIVE, text: "Production Demo" }]);
});

test("merge: a cell with both a hyperlink and runs does not double-count; the runs win", () => {
  const links = mergeCellLinks({
    formattedValue: "Duo On Youtube, Production Demo", hyperlink: YT,
    textFormatRuns: [{ format: { link: { uri: YT } } }, { format: {}, startIndex: 14 }, { format: { link: { uri: DRIVE } }, startIndex: 16 }],
  });
  assert.equal(links.length, 2);
  assert.deepEqual(links.map((l) => l.url), [YT, DRIVE]);
  // A hyperlink that differs from every run is only a fallback, so it is not added next to them.
  const other = mergeCellLinks({ formattedValue: "Animal", hyperlink: CHART, textFormatRuns: [{ format: { link: { uri: SP1 } } }] });
  assert.deepEqual(other, [{ url: SP1, text: "Animal" }]);
});

test("merge: the whole-cell hyperlink is the fallback when the runs carry no link", () => {
  const links = mergeCellLinks({ formattedValue: "Animal", hyperlink: CHART, textFormatRuns: [{ format: {} }] });
  assert.deepEqual(links, [{ url: CHART, text: "Animal" }]);
});

test("merge: a run with no link contributes nothing", () => {
  const links = mergeCellLinks({
    formattedValue: "one and two",
    textFormatRuns: [{ format: { link: { uri: SP1 } } }, { format: {}, startIndex: 3 }, { format: { link: { uri: SP2 } }, startIndex: 8 }],
  });
  assert.deepEqual(links, [{ url: SP1, text: "one" }, { url: SP2, text: "two" }]);
  assert.deepEqual(mergeCellLinks({ formattedValue: "plain", textFormatRuns: [{ format: {} }] }), []);
  assert.deepEqual(mergeCellLinks(undefined), []);
});

test("merge: 'On Spotify and Cool Intro Lick' yields two Spotify links with their own titles", () => {
  const links = mergeCellLinks({
    formattedValue: "On Spotify and Cool Intro Lick",
    textFormatRuns: [{ format: { link: { uri: SP1 } } }, { format: {}, startIndex: 10 }, { format: { link: { uri: SP2 } }, startIndex: 15 }],
  });
  assert.deepEqual(links, [{ url: SP1, text: "On Spotify" }, { url: SP2, text: "Cool Intro Lick" }]);
});

test("numericTitleRows flags a numeric title cell, with its serial and the truncated text", () => {
  const rows: GridRow[] = [
    { values: [{ formattedValue: "Songs" }] },
    { values: [{ formattedValue: "Feb 17", userEnteredValue: { numberValue: 46070 } }] },
    { values: [{ formattedValue: "Animal", userEnteredValue: { stringValue: "Animal" } }] },
  ];
  assert.deepEqual(numericTitleRows(rows), [{ row: 1, formattedValue: "Feb 17", numberValue: 46070 }]);
});

test("gridValues pads to a rectangle and gridLinks addresses links by row and column", () => {
  const rows: GridRow[] = [
    { values: [{ formattedValue: "a" }] },
    { values: [{ formattedValue: "b" }, { formattedValue: "Animal", hyperlink: CHART }] },
  ];
  assert.deepEqual(gridValues(rows), [["a", ""], ["b", "Animal"]]);
  assert.deepEqual(gridLinks(rows), [{ row: 1, col: 1, url: CHART, text: "Animal" }]);
});

test("cleanTitle drops a trailing (cover) or (chart) marker and trims", () => {
  assert.equal(cleanTitle("Angel From Montgomery (cover)"), "Angel From Montgomery");
  assert.equal(cleanTitle("Ruined (chart)"), "Ruined");
  assert.equal(cleanTitle("Run Down and Ragged "), "Run Down and Ragged");
});

// ---------- the import ----------

const WIDTH = 32;
const HEADER: Record<number, string> = {
  0: "Songs", 1: "Key", 2: "Tempo", 3: "Time", 4: "Time (s)", 5: "Ingrid", 6: "Jeff", 7: "Capo*", 8: "Original", 9: "Demo",
  11: "Rehearsed", 12: "Doghouse", 13: "7/26/26", 22: "10/16/26 Show", 28: "Genre", 29: "MC6 PC", 30: "H90 Bank", 31: "Iridium Bank",
};
const line = (cells: Record<number, string>) => Array.from({ length: WIDTH }, (_, c) => cells[c] ?? "");

/** values[0] header, [1] the numeric "Feb 17" (sheet row 2), [2] a cover with links, [3] a trailing-space title, [4] a bare idea, [5] a second numeric title. */
const fixture = (): SongListSnapshot => ({
  source: "test", sheet: "Songs", fetchedAt: "2026-10-24",
  values: [
    line(HEADER),
    line({ 0: "Feb 17" }),
    line({ 0: "Angel From Montgomery (cover)", 1: "D", 2: "90", 3: "0.0027", 4: "240", 5: "Acoustic", 6: "Keys", 7: "3", 8: "FALSE",
           9: "On Spotify and Cool Intro Lick", 11: "2", 12: "✅", 13: "✅", 28: "Folk", 29: "12" }),
    line({ 0: "Run Down and Ragged ", 1: "E", 2: "120", 3: "0.0021", 4: "187", 5: "n/a", 6: "?", 8: "TRUE", 11: "1", 12: "✅", 22: "✅" }),
    line({ 0: "Plain Idea" }),
    line({ 0: "Mar 3" }),
  ],
  links: [
    { row: 2, col: 0, url: CHART, text: "Angel From Montgomery" },
    { row: 2, col: 9, url: SP1, text: "On Spotify" },
    { row: 2, col: 9, url: SP2, text: "Cool Intro Lick" },
  ],
  numericTitleRows: [
    { row: 1, formattedValue: "Feb 17", numberValue: 46070 },
    { row: 5, formattedValue: "Mar 3", numberValue: 46084 },
  ],
});

const LABELS = ["Ingrid Plays", "Jeff Plays", "Capo", "Genre", "MC6 PC", "H90 Bank", "Iridium Bank"];
const runImport = (snapshot = fixture(), extra: { dryRun?: boolean } = {}) => importSongList({ artist: "ingrid-avison-band", snapshot, ...extra });
const rowOf = (r: Awaited<ReturnType<typeof runImport>>, sheetRow: number) => r.rows.find((x) => x.row === sheetRow)!;
const fieldIds = async () => Object.fromEntries(((await db.get("artists", TEST_ARTIST))!.songFields as { id: string; label: string }[]).map((f) => [f.label, f.id]));
const valueOf = (song: Record<string, any>, fieldId: string) => (song.fields as { fieldId: string; value: string }[]).find((v) => v.fieldId === fieldId)?.value;

test("import: a cover keeps a clean title, writers 'cover', a chart from the title link and two demo links", async () => {
  const r = await runImport();
  const row = rowOf(r, 3);
  assert.equal(row.title, "Angel From Montgomery");
  assert.equal(row.writers, "cover");
  const song = (await db.get("songs", row.songId))!;
  assert.equal(song.title, "Angel From Montgomery");
  assert.equal(song.writers, "cover");

  const files = (await db.list("files")).filter((f) => f.songId === row.songId);
  assert.equal(files.length, 3);
  const chart = files.find((f) => f.kind === "chart")!;
  assert.equal(chart.url, CHART);
  assert.equal(chart.provider, "drive");
  assert.equal(chart.driveFileId, "CHART1");
  assert.deepEqual(files.filter((f) => f.kind !== "chart").map((f) => f.title).sort(), ["Cool Intro Lick", "On Spotify"]);
  // A Spotify link is a released version, so it is filed as a recording rather than a demo.
  assert.deepEqual(files.filter((f) => f.kind !== "chart").map((f) => f.kind), ["recording", "recording"]);
  assert.equal(row.files.length, 3);
  assert.deepEqual(r.multiLinkCells, [{ row: 3, col: "J", text: "On Spotify and Cool Intro Lick", links: 2 }]);
});

test("import: sheet row 2 is the song 'February 17th', an idea", async () => {
  const r = await runImport();
  const row = rowOf(r, 2);
  assert.equal(row.title, "February 17th");
  assert.equal(row.status, "idea");
  const song = (await db.get("songs", row.songId))!;
  assert.equal(song.title, "February 17th");
  assert.equal(song.status, "idea");
  assert.match(row.issues.join("; "), /46070/);
});

test("import: a numeric title on another row is imported from its text and flagged, not skipped", async () => {
  const r = await runImport();
  const row = rowOf(r, 6);
  assert.ok(row, "the row is in the report");
  assert.equal(row.title, "Mar 3");
  assert.ok(row.issues.some((i) => /title cell is a number/.test(i) && /confirm/.test(i)), row.issues.join("; "));
  assert.equal((await db.get("songs", row.songId))?.title, "Mar 3");
  assert.ok(group(songListSurvey(r).notes, "decide").some((g) => g.rows.some((n) => /row 6 Mar 3/.test(n.where ?? ""))), "and it is in the survey's decide list");
});

test("import: the seven custom fields are created once, in sheet order, with the band's labels", async () => {
  const r = await runImport();
  assert.deepEqual(r.fields.map((f) => f.label), LABELS);
  assert.ok(r.fields.every((f) => f.action === "created"));
  const defs = (await db.get("artists", TEST_ARTIST))!.songFields as { id: string; label: string }[];
  assert.deepEqual(defs.map((f) => f.label), LABELS);
  const again = await runImport();
  assert.ok(again.fields.every((f) => f.action === "reused"));
  assert.equal(((await db.get("artists", TEST_ARTIST))!.songFields as unknown[]).length, 7);
});

test("import: field values land as written, n/a becomes 'none', ? stays, and an empty cell stores nothing", async () => {
  const r = await runImport();
  const ids = await fieldIds();
  const angel = (await db.get("songs", rowOf(r, 3).songId))!;
  assert.equal(valueOf(angel, ids["Ingrid Plays"]), "Acoustic");
  assert.equal(valueOf(angel, ids["Jeff Plays"]), "Keys");
  assert.equal(valueOf(angel, ids["Capo"]), "3");

  const run = (await db.get("songs", rowOf(r, 4).songId))!;
  assert.equal(valueOf(run, ids["Ingrid Plays"]), "none");
  assert.equal(valueOf(run, ids["Jeff Plays"]), "?");
  // Truly empty: no entry at all, not an empty string.
  assert.equal(valueOf(run, ids["Capo"]), undefined);
  assert.ok(!(run.fields as { fieldId: string }[]).some((v) => v.fieldId === ids["Capo"]));
  assert.ok(!(run.fields as { value: string }[]).some((v) => v.value === "" || v.value === "n/a"));

  const idea = (await db.get("songs", rowOf(r, 5).songId))!;
  assert.deepEqual(idea.fields, []);
});

test("import: a second run reports everything unchanged and creates nothing new", async () => {
  const first = await runImport();
  const songs = (await db.list("songs")).length;
  const files = (await db.list("files")).length;
  assert.ok(first.rows.every((x) => x.action === "created"));
  const again = await runImport();
  assert.ok(again.rows.length > 0);
  assert.ok(again.rows.every((x) => x.action === "unchanged"), again.rows.map((x) => `${x.row}:${x.action}`).join(" "));
  assert.ok(again.rows.flatMap((x) => x.files).every((f) => f.action === "unchanged"));
  assert.equal(again.rows.flatMap((x) => x.files).length, 3);
  assert.equal((await db.list("songs")).length, songs);
  assert.equal((await db.list("files")).length, files);
});

test("import: column L Rehearsed is dropped and never written to a song", async () => {
  const r = await runImport();
  assert.equal(r.droppedColumns.length, 1);
  assert.equal(r.droppedColumns[0].col, "L");
  assert.equal(r.droppedColumns[0].header, "Rehearsed");
  for (const s of await db.list("songs")) {
    assert.ok(!JSON.stringify(s).includes('"Rehearsed"'));
  }
  const ids = Object.values(await fieldIds());
  assert.equal(ids.length, 7, "no field was made for Rehearsed");
});

test("import: the M..AA columns are deferred with their tick counts, and no rehearsal or setlist is written", async () => {
  const r = await runImport();
  assert.deepEqual(r.deferredColumns, [
    { col: "M", header: "Doghouse", ticks: 2 },
    { col: "N", header: "7/26/26", ticks: 1 },
    { col: "W", header: "10/16/26 Show", ticks: 1 },
  ]);
  assert.deepEqual(await db.list("rehearsals"), []);
  assert.deepEqual(await db.list("setlists"), []);
});

test("import: a title-only row is an idea; a row with a key, tempo or length is active", async () => {
  const r = await runImport();
  assert.equal(rowOf(r, 2).status, "idea");
  assert.equal(rowOf(r, 5).status, "idea");
  assert.equal(rowOf(r, 6).status, "idea");
  assert.equal(rowOf(r, 3).status, "active");
  assert.equal(rowOf(r, 4).status, "active");
  // Each of the three alone is enough.
  const snap = fixture();
  snap.values.push(line({ 0: "Key Only", 1: "G" }), line({ 0: "Tempo Only", 2: "100" }), line({ 0: "Length Only", 4: "200" }));
  const r2 = await runImport(snap);
  assert.deepEqual([7, 8, 9].map((n) => rowOf(r2, n).status), ["active", "active", "active"]);
});

test("import: a trailing-space title is trimmed and the length comes from column E, not the D serial", async () => {
  const r = await runImport();
  const row = rowOf(r, 4);
  assert.equal(row.title, "Run Down and Ragged");
  assert.equal(row.lengthSec, 187);
  assert.equal(row.bpm, 120);
  const song = (await db.get("songs", row.songId))!;
  assert.equal(song.title, "Run Down and Ragged");
  assert.equal(song.lengthSec, 187);
  assert.equal(song.writers, undefined, "Original TRUE is not a cover");
});

test("import: a dry run reports what it would do and writes nothing", async () => {
  const r = await runImport(fixture(), { dryRun: true });
  assert.ok(r.rows.every((x) => x.action === "created"));
  assert.deepEqual(r.fields.map((f) => f.label), LABELS);
  assert.deepEqual(await db.list("songs"), []);
  assert.deepEqual(await db.list("files"), []);
  assert.deepEqual((await db.get("artists", TEST_ARTIST))!.songFields, []);
});

test("artists.removeSongField strips the field from every song that had a value", async () => {
  const r = await runImport();
  const ids = await fieldIds();
  const angelId = rowOf(r, 3).songId, runId = rowOf(r, 4).songId;
  const out = await cmd("artists.removeSongField", { id: TEST_ARTIST, fieldId: ids["Jeff Plays"] });
  assert.equal(out.songsCleared, 2);
  const angel = (await db.get("songs", angelId))!, run = (await db.get("songs", runId))!;
  assert.ok(!(angel.fields as { fieldId: string }[]).some((v) => v.fieldId === ids["Jeff Plays"]));
  assert.ok(!(run.fields as { fieldId: string }[]).some((v) => v.fieldId === ids["Jeff Plays"]));
  // The other fields' values are untouched.
  assert.equal(valueOf(angel, ids["Ingrid Plays"]), "Acoustic");
  assert.equal(valueOf(angel, ids["Capo"]), "3");
  assert.equal(valueOf(run, ids["Ingrid Plays"]), "none");
  assert.ok(!((await db.get("artists", TEST_ARTIST))!.songFields as { label: string }[]).some((f) => f.label === "Jeff Plays"));
});

// ---------- the survey ----------

test("the song-list survey names the seven fields and each deferred column with its tick count", async () => {
  const r = await runImport(fixture(), { dryRun: true });
  const s = songListSurvey(r);
  const fieldsLine = String(s.totals!["song fields"]);
  for (const label of LABELS) assert.ok(fieldsLine.includes(label), `${label} in: ${fieldsLine}`);
  const deferred = s.notes.filter((n) => n.bucket === "deferred" && /rehearsal or show column/.test(n.reason));
  assert.equal(deferred.length, 3);
  assert.ok(deferred.some((n) => /column M Doghouse/.test(n.where ?? "") && n.detail === "2 song(s) marked"));
  assert.ok(deferred.some((n) => /column N 7\/26\/26/.test(n.where ?? "") && n.detail === "1 song(s) marked"));
  assert.ok(deferred.some((n) => /column W 10\/16\/26 Show/.test(n.where ?? "") && n.detail === "1 song(s) marked"));
  assert.ok(s.notes.some((n) => /read but deliberately not imported/.test(n.reason) && /Rehearsed/.test(n.where ?? "")));
  assert.equal(s.totals!.ideas, 4);
  assert.equal(s.totals!.covers, 1);
});
