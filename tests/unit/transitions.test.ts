import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldChanges, fmtChange, transitionAt, type TransitionItem, type TransitionSong } from "@/lib/transitions";
import { buildSheets, type SheetRow } from "@/lib/printSheets";
import type { SongField } from "@/schema";

const fields: SongField[] = [
  { id: "ingrid-plays", label: "Ingrid Plays", inSetlists: true },
  { id: "capo", label: "Capo (Eb)", setlistLabel: "Capo", inSetlists: true },
  { id: "h90", label: "H90 Bank" }, // not In setlists: never compared
];
const song = (id: string, vals: Record<string, string>): TransitionSong => ({ id, fields: Object.entries(vals).map(([fieldId, value]) => ({ fieldId, value })) });
const songs = [
  song("a", { "ingrid-plays": "Acoustic", capo: "5", h90: "1" }),
  song("b", { "ingrid-plays": "Acoustic", capo: "6", h90: "2" }),
  song("c", { h90: "2" }),
  song("d", { "ingrid-plays": "Acoustic", capo: "6" }),
];

test("fieldChanges: only In setlists fields that differ, by their setlist label; empty reads as nothing", () => {
  assert.deepEqual(fieldChanges(songs[0], songs[1], fields).map(fmtChange), ["Capo: 5 → 6"]);
  assert.deepEqual(fieldChanges(songs[1], songs[2], fields).map(fmtChange), ["Ingrid Plays: Acoustic → nothing", "Capo: 6 → nothing"]);
  assert.deepEqual(fieldChanges(songs[1], songs[3], fields), [], "same values, and h90 is not In setlists");
  assert.deepEqual(fieldChanges(undefined, songs[1], fields), [], "an off-library song has nothing to compare");
});

test("transitionAt: none on the first item or a break; notes only after a break; the note lives on the lower song", () => {
  const items: TransitionItem[] = [
    { type: "song", songId: "a", transitionNote: "ignored: first song" },
    { type: "song", songId: "b", transitionNote: "  Eric counts in  " },
    { type: "break" },
    { type: "song", songId: "c", transitionNote: "Jeff starts" },
    { type: "song", title: "Cover" } as TransitionItem,
  ];
  assert.equal(transitionAt(items, 0, songs, fields), null);
  assert.deepEqual(transitionAt(items, 1, songs, fields), { changes: [{ fieldId: "capo", label: "Capo", from: "5", to: "6" }], afterBreak: false, note: "Eric counts in" });
  assert.equal(transitionAt(items, 2, songs, fields), null);
  assert.deepEqual(transitionAt(items, 3, songs, fields), { changes: [], afterBreak: true, note: "Jeff starts" });
  assert.deepEqual(transitionAt(items, 4, songs, fields), { changes: [], afterBreak: false, note: "" });
});

test("buildSheets: the transitions field prints the changes and notes above each song but the first", () => {
  const items = [
    { type: "song" as const, songId: "a", title: "A" },
    { type: "song" as const, songId: "b", title: "B", transitionNote: "Eric counts in" },
    { type: "break" as const, title: "Break", lengthSec: 600 },
    { type: "song" as const, songId: "d", title: "D", transitionNote: "Jeff starts" },
    { type: "song" as const, songId: "c", title: "C" },
  ];
  const run = (picked: string[]) => buildSheets({
    items, songs: songs.map((s) => ({ ...s, title: s.id })), songFields: fields.filter((f) => f.inSetlists),
    options: { copy: "band", sheets: "one", fields: picked, titles: "wrap", header: true, transitions: true, paper: "letter" }, bandName: "Band",
  }).sheets.flatMap((s) => s.sets.flatMap((st) => st.rows)).flatMap((r: SheetRow) => (r.kind === "song" ? [r.transition] : []));
  assert.deepEqual(run(["transitions"]), [undefined, "Capo: 5 → 6 · Eric counts in", "Jeff starts", "Ingrid Plays: Acoustic → nothing · Capo: 6 → nothing"]);
  assert.deepEqual(run([]), [undefined, undefined, undefined, undefined], "off unless picked");
});
