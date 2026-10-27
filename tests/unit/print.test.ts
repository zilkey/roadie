import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultPrintOptions, fitTextSize, parsePrintQuery, printPath, printQuery } from "@/lib/print";
import { buildSheets, type BuildInput, type PrintItem, type SheetRow } from "@/lib/printSheets";
import type { PrintOptions } from "@/schema/print";
import { BREAK_ITEM, BREAK_TEXT, items25, items5, songs25, songs5, TOTAL_25_SEC } from "../fixtures/print-setlists";

const opts = (over: Partial<PrintOptions> = {}): PrintOptions => ({ copy: "band", sheets: "one", fields: ["breaks"], titles: "wrap", header: true, transitions: true, paper: "letter", ...over });
const songFields = [{ id: "capo", label: "Capo" }, { id: "midi", label: "MIDI" }];
const base = (over: Partial<BuildInput> = {}): BuildInput => ({
  items: items25(), songs: songs25(), songFields, options: opts(), bandName: "Ingrid Avison Band", showName: "St. Vrain Cidery", date: "2026-11-13", ...over,
});
const rowsOf = (r: ReturnType<typeof buildSheets>) => r.sheets.flatMap((s) => s.sets.flatMap((st) => st.rows));
const songRows = (rows: SheetRow[]) => rows.flatMap((r) => (r.kind === "song" ? [r] : []));

test("fitTextSize: the biggest whole px that fits, max when all fits, min when nothing fits", () => {
  assert.equal(fitTextSize((px) => px * 20 <= 900), 45);
  assert.equal(fitTextSize((px) => px * 20 <= 900, 14, 96), 45);
  assert.equal(fitTextSize(() => true), 96);
  assert.equal(fitTextSize(() => true, 10, 50), 50);
  assert.equal(fitTextSize(() => false), 14);
  assert.equal(fitTextSize(() => false, 20, 60), 20);
  assert.equal(fitTextSize((px) => px <= 14, 14, 96), 14);
  // Odd thresholds still give a whole px, and it really fits while the next one up doesn't.
  const fits = (px: number) => px * 13.7 <= 1000;
  const n = fitTextSize(fits);
  assert.ok(Number.isInteger(n));
  assert.ok(fits(n) && !fits(n + 1));
});

test("fitTextSize: several sheets share one size, the tightest sheet wins", () => {
  const heightsPerPx = [20, 30, 12]; // content height per px of text on each sheet
  const box = 900;
  const all = (px: number) => heightsPerPx.every((h) => px * h <= box);
  assert.equal(fitTextSize(all), 30); // 900 / 30
  assert.equal(fitTextSize((px) => [20, 12].every((h) => px * h <= box)), 45); // without the tight sheet it can grow
});

test("printQuery and parsePrintQuery round-trip; unknown or missing values fall back", () => {
  const o = opts({ copy: "mine", sheets: "perSet", fields: ["key", "length", "field:capo", "breaks"], titles: "short", header: false, paper: "a4" });
  assert.deepEqual(parsePrintQuery(new URLSearchParams(printQuery(o)), defaultPrintOptions(2)), o);
  const empty = opts({ fields: [] });
  assert.deepEqual(parsePrintQuery(new URLSearchParams(printQuery(empty)), defaultPrintOptions(2)), empty, "no extra fields survives");
  const fb = opts({ sheets: "perSet", paper: "a4", titles: "short" });
  const got = parsePrintQuery(new URLSearchParams("copy=nope&sheets=weird&titles=huge&paper=legal&header=0"), fb);
  assert.deepEqual(got, { ...fb, header: false });
  assert.deepEqual(parsePrintQuery(new URLSearchParams(""), fb), fb);
  assert.equal(printPath("abc", o), `/setlists/abc/print?${printQuery(o)}`);
});

test("defaultPrintOptions: breaks only, and one sheet when there is only one set", () => {
  assert.deepEqual(defaultPrintOptions(2), opts());
  assert.equal(defaultPrintOptions(1, { sheets: "perSet" }).sheets, "one");
  assert.equal(defaultPrintOptions(2, { sheets: "perSet" }).sheets, "perSet");
});

test("buildSheets: short titles apply only to songs that have one, and only with titles=short", () => {
  const wrap = songRows(rowsOf(buildSheets(base())));
  assert.equal(wrap[2].title, "The Ballad of the Seven-Hundred-Mile Drive Home (Reprise)");
  const short = songRows(rowsOf(buildSheets(base({ options: opts({ titles: "short" }) }))));
  assert.equal(short[2].title, "700 Miles (Reprise)");
  assert.equal(short[10].title, "Sundown");
  assert.equal(short[0].title, "Open Road Hymn", "a song with no short title keeps its title");
  assert.equal(short.length, 25);
});

test("buildSheets: the item's key wins over the song's; the key prints on the band copy only when Key is on", () => {
  const items: PrintItem[] = items25().map((i, n) => (n === 0 ? { ...i, key: "Dm" } : i));
  const off = songRows(rowsOf(buildSheets(base({ items }))));
  assert.equal(off[0].key, undefined);
  const on = songRows(rowsOf(buildSheets(base({ items, options: opts({ fields: ["key", "breaks"] }) }))));
  assert.equal(on[0].key, "Dm", "the item's key");
  assert.equal(on[1].key, "D", "the song's key when the item has none of its own");
  // An item with no key of its own falls back to the song's.
  const noItemKey = items25().map((i, n) => (n === 0 ? { ...i, key: undefined } : i));
  assert.equal(songRows(rowsOf(buildSheets(base({ items: noItemKey, options: opts({ fields: ["key"] }) }))))[0].key, "G");
});

test("buildSheets: the band copy carries the other picked fields that have a value, in order, after the key", () => {
  const songs = songs25().map((s, i) => (i === 0 ? { ...s, fields: [{ fieldId: "capo", value: "2" }] } : s));
  const rows = songRows(rowsOf(buildSheets(base({ songs, options: opts({ fields: ["field:capo", "key", "length"] }) }))));
  assert.deepEqual(rows[0].fields.map((f) => f.label), ["Length", "Capo"]);
  assert.equal(rows[0].fields[1].value, "2");
  assert.equal(rows[0].key, "G");
  assert.deepEqual(rows[1].fields.map((f) => f.label), ["Length"], "an empty field is left out");
  assert.deepEqual(songRows(rowsOf(buildSheets(base({ songs }))))[0].fields, [], "nothing picked, nothing printed");
});

test("buildSheets: a break splits the sets, numbers run on, and the break prints its note and minutes", () => {
  const r = buildSheets(base());
  assert.equal(r.setCount, 2);
  assert.equal(r.songCount, 25);
  assert.equal(r.sheets.length, 1);
  const sets = r.sheets[0].sets;
  assert.deepEqual(sets.map((s) => s.name), ["Set 1", "Set 2"]);
  assert.equal(songRows(sets[0].rows).length, 13);
  assert.equal(songRows(sets[1].rows)[0].n, 14);
  assert.equal(songRows(sets[1].rows).at(-1)!.n, 25);
  const breaks = rowsOf(r).filter((x) => x.kind === "break");
  assert.equal(breaks.length, 1);
  assert.equal((breaks[0] as { text: string }).text, BREAK_TEXT);
  assert.ok(sets[0].rows.includes(breaks[0]), "the break closes set 1");
  assert.equal(r.totalSec, TOTAL_25_SEC);
});

test("buildSheets: a break without a note says BREAK and the minutes; breaks are hidden unless Breaks is on", () => {
  const items = items25().map((i) => (i.type === "break" ? { ...BREAK_ITEM, note: undefined } : i));
  const plain = rowsOf(buildSheets(base({ items }))).find((x) => x.kind === "break") as { text: string };
  assert.match(plain.text, /BREAK 15/);
  assert.ok(!plain.text.includes("Merch"));
  const hidden = buildSheets(base({ options: opts({ fields: [] }) }));
  assert.equal(rowsOf(hidden).filter((x) => x.kind === "break").length, 0);
  assert.equal(hidden.setCount, 2, "the sets are still split at the break");
  assert.deepEqual(hidden.sheets[0].sets.map((s) => s.name), ["Set 1", "Set 2"]);
  assert.equal(songRows(hidden.sheets[0].sets[1].rows)[0].n, 14);
  assert.equal(hidden.totalSec, TOTAL_25_SEC, "the break's time still counts");
});

test("buildSheets: perSet gives one sheet per set; a one-set setlist is always one sheet", () => {
  const per = buildSheets(base({ options: opts({ sheets: "perSet" }) }));
  assert.equal(per.sheets.length, 2);
  assert.equal(per.sheets[0].title, "SET 1");
  assert.equal(per.sheets[1].title, "SET 2");
  assert.deepEqual(per.sheets.map((s) => s.sets.length), [1, 1]);
  assert.equal(songRows(per.sheets[1].sets[0].rows)[0].n, 14);
  const one = buildSheets(base({ items: items5(), songs: songs5(), options: opts({ sheets: "perSet" }) }));
  assert.equal(one.sheets.length, 1);
  assert.equal(one.setCount, 1);
  assert.equal(one.songCount, 5);
  assert.equal(buildSheets(base({ options: opts({ sheets: "one" }) })).sheets.length, 1);
});

test("buildSheets: row layout is a list for the band, a table for my copy with 3+ fields and more than 8 songs, else under the title", () => {
  const four = ["key", "length", "field:capo", "field:midi", "breaks"];
  assert.equal(buildSheets(base({ options: opts({ fields: four }) })).layout, "list");
  assert.equal(buildSheets(base({ options: opts({ copy: "mine", fields: four }), copyName: "Jeff" })).layout, "table");
  assert.equal(buildSheets(base({ options: opts({ copy: "mine", fields: ["key", "length"] }), copyName: "Jeff" })).layout, "underTitle");
  assert.equal(buildSheets(base({ options: opts({ copy: "mine", fields: ["key", "length", "field:capo"] }), copyName: "Jeff" })).layout, "table");
  // Few songs: the fields go under the title however many there are.
  assert.equal(buildSheets(base({ items: items5(), songs: songs5(), options: opts({ copy: "mine", fields: four }), copyName: "Jeff" })).layout, "underTitle");
  assert.equal(buildSheets(base({ items: items5(), songs: songs5(), options: opts({ copy: "band", fields: four }) })).layout, "list");
});

test("buildSheets: my copy is Jeff's copy and carries the extra fields' values", () => {
  const songs = songs25().map((s, i) => (i === 0 ? { ...s, fields: [{ fieldId: "capo", value: "2" }] } : s));
  const r = buildSheets(base({ songs, options: opts({ copy: "mine", fields: ["key", "length", "field:capo", "field:midi"] }), copyName: "Jeff" }));
  assert.equal(r.sheets[0].title, "Jeff's copy");
  assert.ok(r.sheets[0].columns.some((c) => c.label === "Capo"));
  assert.ok(r.sheets[0].columns.some((c) => c.label === "MIDI"));
  const first = songRows(rowsOf(r))[0];
  assert.equal(first.fields.find((f) => f.label === "Capo")?.value, "2");
  assert.match(r.sheets[0].footer, /25 songs/);
});

test("buildSheets: counts and total time", () => {
  const five = buildSheets(base({ items: items5(), songs: songs5(), showName: undefined, date: undefined, templateName: "Opener" }));
  assert.equal(five.songCount, 5);
  assert.equal(five.setCount, 1);
  assert.equal(five.totalSec, 5 * 214);
  assert.match(five.sheets[0].footer, /5 songs/);
  assert.equal(buildSheets(base()).songCount, 25);
});

test("buildSheets: transitions between songs in a row count into the set lengths, unless turned off", () => {
  // 13 songs, a break, 12 songs: 12 + 11 transitions, none across the break.
  const r = buildSheets(base({ transitionSec: 30, options: opts({ sheets: "perSet" }) }));
  assert.equal(r.totalSec, TOTAL_25_SEC + 23 * 30);
  assert.equal(r.sheets[1].sets[0].lengthSec, 12 * 214 - 10 + 11 * 30);
  assert.equal(buildSheets(base({ transitionSec: 30, options: opts({ transitions: false }) })).totalSec, TOTAL_25_SEC);
  assert.equal(buildSheets(base()).totalSec, TOTAL_25_SEC, "no transitionSec, nothing added");
});

test("printQuery round-trips transitions; a link without it keeps the fallback", () => {
  const off = opts({ transitions: false });
  assert.deepEqual(parsePrintQuery(new URLSearchParams(printQuery(off)), defaultPrintOptions(2)), off);
  assert.equal(parsePrintQuery(new URLSearchParams("copy=band"), defaultPrintOptions(2)).transitions, true);
});

test("buildSheets: alternates print under their song only when Alternates is on, with short titles, and add no length", () => {
  const songs = songs5();
  const items = items5().map((i, n) => (n === 0 ? { ...i, alts: [{ songId: songs[2].id, title: "stale copy" }, { songId: "gone", title: "Off the list" }] } : i));
  const plain = buildSheets(base({ items, songs }));
  assert.equal(songRows(rowsOf(plain))[0].alts, undefined);
  const on = buildSheets(base({ items, songs, options: opts({ fields: ["breaks", "alts"] }) }));
  assert.deepEqual(songRows(rowsOf(on))[0].alts, [songs[2].title, "Off the list"]);
  assert.equal(on.totalSec, plain.totalSec);
  assert.equal(on.songCount, plain.songCount);
  const short = songs.map((s, n) => (n === 2 ? { ...s, shortTitle: "Shorty" } : s));
  assert.deepEqual(songRows(rowsOf(buildSheets(base({ items, songs: short, options: opts({ fields: ["alts"], titles: "short" }) }))))[0].alts, ["Shorty", "Off the list"]);
});
