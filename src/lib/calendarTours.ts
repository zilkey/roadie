/**
 * The Calendar's Tours layer, pure: which week rows a tour's bar spans, its label, the chips on its days and the counts for the
 * side panel. Worked out from the tour and its entries every time (nothing stored). Members pass band entries only, so they never see options.
 */
import { dayLabel, dateRange, tourSpan, tourWarnings, type EntryLike, type ShowFacts, type TourLike, type TourWarning } from "./tours";

type Place = { name?: string; address: string };
export type LayerEntry = EntryLike & { from?: Place; address?: Place };
export interface LayerTour extends TourLike { id: string; name: string; leavingFrom?: Place }

export type TourChipKind = "drive" | "stay" | "note" | "open" | "warn";
export interface TourChip { id: string; kind: TourChipKind; text: string }

export interface TourLayer {
  id: string; name: string; span: { from: string; to: string };
  /** Shows on the tour. */
  booked: number;
  /** Days of the span with no show on them. */
  openDates: string[];
  /** What needs fixing, apart from open dates (those have their own count). */
  warnings: TourWarning[];
  /** Chips by date (drives, stays, notes, open, warnings); shows are normal calendar items and are not repeated. */
  chips: Map<string, TourChip[]>;
  /** The bar's text: "Fall run · Mar 9–14 · 2 booked, 3 open" (members: no open count). */
  label: string;
}

/** A town from a picked place: its name, else the first part of the address. */
export const town = (p?: Place): string | undefined => p?.name || p?.address.split(",")[0].trim() || undefined;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8))}`;

/** "Mar 9–14", "Mar 30 – Apr 2", "Mar 9" (no year: the calendar shows it). */
export function shortDates(from: string, to: string): string {
  if (from === to) return md(from);
  return from.slice(0, 7) === to.slice(0, 7) ? `${md(from)}–${Number(to.slice(8))}` : `${md(from)} – ${md(to)}`;
}

/** "Fri 12" for YYYY-MM-DD. */
export const dayShort = (d: string) => { const [w, , n] = dayLabel(d).split(" "); return `${w} ${n}`; };

/** "Fri 12", "Fri 12 and Sat 13", "Fri 12, Sat 13 and Sun 14". */
export function listDays(ds: readonly string[]): string {
  const x = ds.map(dayShort);
  return x.length < 2 ? x.join("") : `${x.slice(0, -1).join(", ")} and ${x[x.length - 1]}`;
}

/** The chip for a drive, stay or note; null for shows and options (shows are calendar items, options are the open chip's count). */
export function entryChip(e: LayerEntry, tour: LayerTour): TourChip | null {
  if (e.kind === "drive") {
    const f = town(e.from), t = town(e.to);
    const text = e.roundTrip && t ? `Round trip to ${t}`
      : t && t === town(tour.leavingFrom) ? "Drive home"
      : f && t ? `Drive ${f} → ${t}` : t ? `Drive to ${t}` : "Drive";
    return { id: e.id, kind: "drive", text };
  }
  if (e.kind === "stay") return { id: e.id, kind: "stay", text: [e.name, town(e.address)].filter(Boolean).join(" · ") || "Stay" };
  if (e.kind === "note" && e.text?.trim()) return { id: e.id, kind: "note", text: e.text.trim() };
  return null;
}

const WARN_TEXT: Record<string, string> = { noStay: "No stay", longDrive: "Long drive", lateArrival: "Late arrival", outsideDates: "Outside dates" };

/**
 * The layer for one tour, or null when nothing is dated yet. `entries` are what the person can read (members: band entries);
 * open-date chips and counts are for admins only, since members cannot see the options.
 */
export function buildTourLayer(tour: LayerTour, entries: readonly LayerEntry[], shows: ReadonlyMap<string, ShowFacts>, admin: boolean): TourLayer | null {
  const live = entries.filter((e) => !e.deletedAt);
  const span = tourSpan(tour, live);
  if (!span) return null;
  const all = tourWarnings(tour, live, shows);
  const warnings = all.filter((w) => w.kind !== "openDate");
  const showDates = new Set(live.filter((e) => e.kind === "show" && e.date).map((e) => e.date!));
  const optionCount = new Map<string, number>();
  for (const e of live) if (e.kind === "option" && e.date) optionCount.set(e.date, (optionCount.get(e.date) ?? 0) + 1);
  const days = dateRange(span.from, span.to);
  const openDates = days.filter((d) => !showDates.has(d));
  const booked = live.filter((e) => e.kind === "show").length;

  const chips = new Map<string, TourChip[]>();
  const add = (d: string, c: TourChip) => chips.set(d, [...(chips.get(d) ?? []), c]);
  for (const e of [...live].sort((a, b) => a.position - b.position)) {
    const c = e.date ? entryChip(e, tour) : null;
    if (c) add(e.date!, c);
  }
  if (admin) {
    for (const d of openDates) {
      const n = optionCount.get(d) ?? 0;
      add(d, { id: `open:${d}`, kind: "open", text: n ? `Open · ${n} option${n === 1 ? "" : "s"}` : "Open" });
    }
  }
  for (const w of warnings) if (w.date) add(w.date, { id: `warn:${w.kind}:${w.entryId ?? w.date}`, kind: "warn", text: WARN_TEXT[w.kind] ?? "Check" });

  const count = `${booked} booked${admin ? `, ${openDates.length} open` : ""}`;
  return { id: tour.id, name: tour.name, span, booked, openDates: admin ? openDates : [], warnings, chips, label: `${tour.name} · ${shortDates(span.from, span.to)} · ${count}` };
}

/** One bar in one week row of the month grid. Columns are 1–7 (Sunday first); rows count from 0 at the grid's first week. */
export interface TourBarSeg { tourId: string; row: number; col: number; end: number; first: boolean; contFrom: boolean; contTo: boolean; text: string; fix: number }

/** The bars for a tour over a month grid (a flat list of dates, 7 to a week): one per week row it touches. The first carries the full label and the "to fix" count; the rest just the name. */
export function barSegments(grid: readonly string[], layer: TourLayer): TourBarSeg[] {
  const out: TourBarSeg[] = [];
  for (let row = 0; row * 7 < grid.length; row++) {
    const week = grid.slice(row * 7, row * 7 + 7);
    const cols = week.map((d, i) => (d >= layer.span.from && d <= layer.span.to ? i + 1 : 0)).filter(Boolean);
    if (!cols.length) continue;
    const first = out.length === 0;
    out.push({
      tourId: layer.id, row, col: cols[0], end: cols[cols.length - 1], first,
      contFrom: week[cols[0] - 1] > layer.span.from, contTo: week[cols[cols.length - 1] - 1] < layer.span.to,
      text: first ? layer.label : layer.name, fix: first ? layer.warnings.length : 0,
    });
  }
  return out;
}

/** Does the tour overlap the grid's dates? */
export const overlaps = (span: { from: string; to: string }, grid: readonly string[]) => !!grid.length && span.from <= grid[grid.length - 1] && span.to >= grid[0];

/** Is the date on the tour's span? */
export const onTour = (layer: TourLayer, date: string) => date >= layer.span.from && date <= layer.span.to;
