/**
 * The printable-setlists wireframes' data: the 25-song band list (project/Main.dc.html S1 and S2, a 15-minute break
 * after song 13) and the 5-song opener (Sheet5Band). Shared by the unit tests (buildSheets) and the e2e spec, which
 * creates the same songs through the app's commands.
 */
import type { PrintItem, PrintSong } from "@/lib/printSheets";

/** [title, short title or "", key] */
export type FixtureSong = [string, string, string];

export const S1: FixtureSong[] = [
  ["Open Road Hymn", "", "G"], ["Paper Lanterns", "", "D"],
  ["The Ballad of the Seven-Hundred-Mile Drive Home (Reprise)", "700 Miles (Reprise)", "A"],
  ["Cottonwood →", "", "E"], ["Slow Burn", "", "Em"], ["Better Than Gold", "", "C"],
  ["Holding Pattern", "", "F"], ["Kitchen Light", "", "G"], ["Same River Twice", "", "Bb"],
  ["Little Engine", "", "D"], ["Sundown Over Everything You Promised Me Last Summer", "Sundown", "A"],
  ["Wildfire Season", "", "Em"], ["Northbound", "", "E"],
];
export const S2: FixtureSong[] = [
  ["Heavy Weather", "", "C"], ["Porchlight", "", "G"], ["Blue Mesa", "", "D"],
  ["Everything We Carried In (and Everything We Carried Out)", "Carried In", "F"],
  ["Ghost Town Radio", "", "Am"], ["Two Lane →", "", "E"], ["Hard Rain Coming", "", "E"],
  ["Lucky Penny", "", "G"], ["Night Shift", "", "Bb"], ["Gold Line", "", "D"],
  ["Turn the Lights Down", "", "A"], ["Home Again", "", "G"],
];
/** The 5-song opener (Sheet5Band): a subset of the 25, with the long one third. */
export const FIVE: FixtureSong[] = [S1[0], S1[1], S1[2], S1[7], S2[11]];

export const BREAK_ITEM: PrintItem = { type: "break", title: "Break", note: "Merch + tip jar", lengthSec: 900 };
export const BREAK_TEXT = "Merch + tip jar · BREAK 15";
/** 25 songs of 3:34, except the last of 3:24, plus the 15 min break: 104 min exactly. */
export const TOTAL_25_SEC = 24 * 214 + 204 + 900;

const lengthOf = (i: number, n: number) => (i === n - 1 && n === 25 ? 204 : 214);

/** Song records as the print code sees them, ids "s1".."s25" (or "f1".."f5"). */
export function printSongs(rows: FixtureSong[], prefix = "s"): PrintSong[] {
  return rows.map(([title, shortTitle, key], i) => ({
    id: `${prefix}${i + 1}`, title, key, lengthSec: lengthOf(i, rows.length), ...(shortTitle ? { shortTitle } : {}),
  }));
}
export const songs25 = (): PrintSong[] => printSongs([...S1, ...S2]);
export const songs5 = (): PrintSong[] => printSongs(FIVE, "f");

/** The setlist items of a list of songs, with `breakAfter` (1-based song count) followed by the break. */
export function printItems(songs: PrintSong[], breakAfter?: number): PrintItem[] {
  const out: PrintItem[] = [];
  songs.forEach((s, i) => {
    out.push({ type: "song", songId: s.id, title: s.title, lengthSec: s.lengthSec, key: s.key });
    if (breakAfter === i + 1) out.push({ ...BREAK_ITEM });
  });
  return out;
}
export const items25 = (): PrintItem[] => printItems(songs25(), 13);
export const items5 = (): PrintItem[] => printItems(songs5());
