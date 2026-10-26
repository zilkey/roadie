/**
 * Builds the printed sheets from a setlist. Pure (no React, no Firestore) so it is unit tested; the print route and the
 * Print dialog's preview both render its output with <PrintSheets>.
 *
 * A setlist is one flat list of songs and breaks: breaks split it into sets ("Set 1", "Set 2", ...). Song numbers run on
 * across sets. A break ends its set and prints as a dashed box when "breaks" is among the fields; the last set has none
 * unless the list ends with a break.
 */
import type { SongField } from "@/schema";
import type { PrintOptions } from "@/schema/print";
import { fmtLen } from "@/lib/music";
import { FIELD_BREAKS, FIELD_KEY, FIELD_LENGTH, songFieldId } from "@/lib/print";

export interface PrintSong { id: string; title: string; shortTitle?: string; key?: string; lengthSec?: number; fields?: { fieldId: string; value: string }[] }
export interface PrintItem { type: "song" | "break"; songId?: string; title: string; lengthSec?: number; key?: string; note?: string }

/** One extra-field value printed on a song row. */
export interface RowField { id: string; label: string; value: string }
export type SheetRow =
  | { kind: "song"; n: number; title: string; /** printed after the title (band copy, Key on) */ key?: string; /** band copy: after the key; otherwise under the title or in columns */ fields: RowField[] }
  | { kind: "break"; /** e.g. "Merch + tip jar · BREAK 15" */ text: string };
export interface PrintSet { name: string; lengthSec: number; rows: SheetRow[] }
/**
 * How song rows print. "list": number + title (+ key and other fields after it). "table": song then one column per field (my copy, 3+ fields,
 * more than 8 songs). "underTitle": fields on a line under the title (my copy otherwise).
 */
export type RowLayout = "list" | "table" | "underTitle";
export interface PrintSheet {
  /** Header left: the set name on a per-set sheet ("Set 1"), else the band name, or "<name>'s copy" on my copy. */
  title: string;
  /** Header right: show name · date (shows) or the template name (templates); a per-set sheet adds the set length after a "\n". */
  subtitle: string;
  sets: PrintSet[];
  /** Columns for the "table" layout, in order. */
  columns: { id: string; label: string }[];
  /** The Header option: false prints no header band. */
  header: boolean;
  /** Per-set sheet: the title is the set name and prints in the set-heading color. */
  setHeading: boolean;
  /** Footer left, e.g. "Band copy · 25 songs · 1 h 44 min" or "Ingrid Avison Band · band copy · sheet 1 of 2". */
  footer: string;
}
export interface BuildInput {
  items: PrintItem[];
  songs: PrintSong[];
  songFields: SongField[];
  options: PrintOptions;
  bandName: string;
  /** Show setlists: venue (showName) and the show's date, YYYY-MM-DD. Templates: the template name. */
  showName?: string;
  date?: string;
  templateName?: string;
  /** The viewer's name, for "Jeff's copy". Ignored on the band copy. */
  copyName?: string;
  /** Seconds between two songs in a row, added to the set lengths when options.transitions is on (the show's transitionSec). */
  transitionSec?: number;
}
export interface BuildResult { sheets: PrintSheet[]; layout: RowLayout; songCount: number; setCount: number; totalSec: number }

/** "Thu Nov 13" from YYYY-MM-DD, read as a calendar date (no timezone drift). */
export function fmtSheetDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).replace(",", "");
}

/** "1 h 44 min", "54 min", "2 h". */
export function fmtSheetLen(sec: number): string {
  const mins = Math.round(sec / 60);
  const h = Math.floor(mins / 60), m = mins % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function buildSheets(input: BuildInput): BuildResult {
  const { options, songFields } = input;
  const mine = options.copy === "mine";
  const songsById = new Map(input.songs.map((s) => [s.id, s]));

  // Selected non-break fields, in the order Key, Length, then the artist's own order.
  const picked = new Set(options.fields);
  const selected: { id: string; label: string }[] = [
    ...(picked.has(FIELD_KEY) ? [{ id: FIELD_KEY, label: "Key" }] : []),
    ...(picked.has(FIELD_LENGTH) ? [{ id: FIELD_LENGTH, label: "Length" }] : []),
    ...songFields.filter((f) => picked.has(songFieldId(f.id))).map((f) => ({ id: songFieldId(f.id), label: f.label })),
  ];
  const showBreaks = picked.has(FIELD_BREAKS);
  const songCount = input.items.filter((i) => i.type === "song").length;
  const layout: RowLayout = !mine ? "list" : selected.length >= 3 && songCount > 8 ? "table" : "underTitle";

  const sets: PrintSet[] = [];
  let cur: PrintSet = { name: "Set 1", lengthSec: 0, rows: [] };
  let curSongs = 0;
  let n = 0;
  const gap = options.transitions === false ? 0 : input.transitionSec ?? 0;
  let prev: PrintItem | undefined;
  for (const item of input.items) {
    const after = prev;
    prev = item;
    const song = item.songId ? songsById.get(item.songId) : undefined;
    const sec = item.lengthSec ?? song?.lengthSec ?? 0;
    if (item.type === "break") {
      if (!curSongs) continue; // a break before any song of its set has nothing to end
      cur.lengthSec += sec;
      if (showBreaks) {
        const label = item.note || (item.title !== "Break" ? item.title : "");
        const text = [label, item.lengthSec != null ? `BREAK ${Math.round(sec / 60)}` : "BREAK"].filter(Boolean).join(" · ");
        cur.rows.push({ kind: "break", text });
      }
      sets.push(cur);
      cur = { name: `Set ${sets.length + 1}`, lengthSec: 0, rows: [] };
      curSongs = 0;
      continue;
    }
    n++;
    if (after?.type === "song") cur.lengthSec += gap;
    curSongs++;
    cur.lengthSec += sec;
    const key = item.key ?? song?.key;
    const title = options.titles === "short" && song?.shortTitle ? song.shortTitle : item.title;
    const value = (id: string): string => {
      if (id === FIELD_KEY) return key ?? "";
      if (id === FIELD_LENGTH) return fmtLen(sec || undefined);
      return song?.fields?.find((f) => songFieldId(f.fieldId) === id)?.value ?? "";
    };
    if (layout === "list") {
      // The key right after the title, then the other picked fields that have a value.
      const fields = selected.filter((f) => f.id !== FIELD_KEY).flatMap((f) => { const v = value(f.id); return v ? [{ id: f.id, label: f.label, value: v }] : []; });
      cur.rows.push({ kind: "song", n, title, key: picked.has(FIELD_KEY) && key ? key : undefined, fields });
    } else {
      const fields = selected.flatMap((f) => {
        const v = value(f.id);
        return layout === "table" ? [{ id: f.id, label: f.label, value: v || "—" }] : v ? [{ id: f.id, label: f.label, value: v }] : [];
      });
      cur.rows.push({ kind: "song", n, title, fields });
    }
  }
  if (curSongs || !sets.length) sets.push(cur);

  const totalSec = sets.reduce((a, s) => a + s.lengthSec, 0);
  const copyLabel = mine ? `${input.copyName ?? "My"}'s copy` : "Band copy";
  const where = input.showName ? [input.showName, input.date ? fmtSheetDate(input.date) : ""].filter(Boolean).join(" · ") : input.templateName ?? "";
  const columns = selected.map(({ id, label }) => ({ id, label }));
  const perSet = options.sheets === "perSet" && sets.length > 1;
  const base = { header: options.header, columns };

  const out: PrintSheet[] = perSet
    ? sets.map((s, i) => ({
        ...base, title: s.name.toUpperCase(), subtitle: `${where}\n${fmtSheetLen(s.lengthSec)}`.replace(/^\n/, ""), sets: [s], setHeading: true,
        footer: `${input.bandName} · ${mine ? copyLabel : "band copy"} · sheet ${i + 1} of ${sets.length}`,
      }))
    : [{
        ...base, title: mine ? copyLabel : input.bandName, subtitle: where, sets, setHeading: false,
        footer: `${copyLabel} · ${songCount} ${songCount === 1 ? "song" : "songs"} · ${fmtSheetLen(totalSec)}`,
      }];
  return { sheets: out, layout, songCount, setCount: sets.length, totalSec };
}
