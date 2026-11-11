import { isPlaced } from "./plot";
import type { PlotShape } from "@/schema/stagePlots";

/** What the sheet, the PDF and the engineer page list: one place turns a plot into rows. Pure, so the browser and the server agree. */
export type SheetPlot = PlotShape & { name?: string; version?: number };
export type Paper = "letter" | "a4";
export const parsePaper = (v: string | null | undefined): Paper => (v === "a4" ? "a4" : "letter");
/** Page size in points (1/72 in). */
export const PAPER_PT: Record<Paper, { w: number; h: number }> = { letter: { w: 612, h: 792 }, a4: { w: 595.28, h: 841.89 } };

export const MIX_LABEL = { wedge: "Wedge", iem: "In-ear", sidefill: "Side fill" } as const;

export interface ChannelRow { n: number; source: string; gear: string; stand: string; phantom: boolean; who: string; note: string; placed: boolean }
export interface MixRow { n: number; kind: string; who: string; wants: string; placed: boolean }

export const channelRows = (plot: SheetPlot, names: Record<string, string> = {}): ChannelRow[] =>
  plot.inputs.map((i, k) => ({
    n: k + 1, source: i.source?.trim() || "", gear: i.gear?.trim() || "", stand: i.stand?.trim() || "", phantom: !!i.phantom,
    who: (i.musicianId && names[i.musicianId]) || "", note: i.note?.trim() || "", placed: isPlaced(i),
  }));

export const mixRows = (plot: SheetPlot, names: Record<string, string> = {}): MixRow[] =>
  plot.monitors.map((m, k) => ({
    n: k + 1, kind: MIX_LABEL[m.kind], who: (m.musicianId && names[m.musicianId]) || "", wants: m.wants?.trim() || "", placed: isPlaced(m),
  }));

/** "Oct 25, 2026" in UTC, so server and browser print the same day. */
export const sheetDate = (d: Date = new Date()) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
