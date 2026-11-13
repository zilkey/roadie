/**
 * Printable setlists: the options, the print route's query string, paper sizes and the fit-to-page search. Shared by the
 * Print dialog, the print route and the setlists.printLink command, so a link Roadie builds opens the same sheets.
 */
import { PrintOptions, type PrintPaper } from "@/schema/print";

export const FIELD_KEY = "key";
export const FIELD_LENGTH = "length";
/** The song's tempo, "120bpm". */
export const FIELD_TEMPO = "tempo";
export const FIELD_BREAKS = "breaks";
/** Alternates pinned to a song print small under it. Off by default. */
export const FIELD_ALTS = "alts";
/** The extra-field id for one of the artist's song fields. */
export const songFieldId = (id: string) => `field:${id}`;

/** The extra fields every setlist offers (song fields come and go with the artist's Custom fields). */
export const BUILTIN_FIELDS: readonly string[] = [FIELD_KEY, FIELD_LENGTH, FIELD_TEMPO, FIELD_BREAKS, FIELD_ALTS];

/**
 * Someone's stored print choices, read leniently: each option that still validates is kept and the rest fall back to the
 * defaults, so one stale or renamed option never throws away the others. Field ids are kept as long as they look like one;
 * which of them still exist is up to the reader (keepFields). null = nothing usable stored.
 */
export function readSavedPrintOptions(raw: unknown): PrintOptions | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const shape = PrintOptions.shape;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(shape) as (keyof typeof shape)[]) {
    if (k === "fields") {
      if (Array.isArray(r.fields)) out.fields = [...new Set(r.fields.filter((f): f is string => typeof f === "string" && f.length > 0))];
      continue;
    }
    const p = shape[k].safeParse(r[k]);
    if (p.success && p.data !== undefined) out[k] = p.data;
  }
  if (!Object.keys(out).length) return null;
  return { ...defaultPrintOptions(2), ...out };
}

/** The picked fields that still exist: the built-in ones, and song fields whose id is in `songFieldIds`. Order kept, no repeats. */
export const keepFields = (fields: string[], songFieldIds: string[]): string[] => {
  const ok = new Set([...BUILTIN_FIELDS, ...songFieldIds.map(songFieldId)]);
  return [...new Set(fields)].filter((f) => ok.has(f));
};

/**
 * What to remember after printing: what was printed, except where the dialog forced a choice the person didn't make, so a
 * one-set setlist doesn't turn "one sheet per set" off and a missing "My copy" doesn't turn it off for next time. Song fields
 * that still exist but weren't on offer this time (taken off "In setlists") stay picked; deleted ones are dropped.
 */
export function printOptionsToRemember(printed: PrintOptions, prev: PrintOptions | null, ctx: { setCount: number; canMine: boolean; offered: string[]; songFieldIds: string[] }): PrintOptions {
  const offered = new Set(ctx.offered);
  const unseen = (prev?.fields ?? []).filter((f) => !offered.has(f));
  return {
    ...printed,
    sheets: ctx.setCount <= 1 && prev ? prev.sheets : printed.sheets,
    copy: !ctx.canMine && prev ? prev.copy : printed.copy,
    fields: keepFields([...printed.fields, ...unseen], ctx.songFieldIds),
  };
}

/** Defaults: band copy, breaks shown, wrapped titles, header on, transitions counted, Letter. One sheet when there is one set; otherwise the saved choice. */
export function defaultPrintOptions(setCount: number, saved?: Partial<PrintOptions> | null): PrintOptions {
  const o: PrintOptions = { copy: "band", sheets: "one", fields: [FIELD_BREAKS], titles: "wrap", header: true, transitions: true, paper: "letter", ...(saved ?? {}) };
  return setCount <= 1 ? { ...o, sheets: "one" } : o;
}

/** The query string for the print route; it mirrors the options exactly. */
export function printQuery(o: PrintOptions): string {
  return new URLSearchParams({
    copy: o.copy, sheets: o.sheets, fields: o.fields.join(","), titles: o.titles, header: o.header ? "1" : "0", transitions: o.transitions === false ? "0" : "1", paper: o.paper,
  }).toString();
}

/** Options from the print route's query; anything missing or unknown falls back to `fallback`. */
export function parsePrintQuery(q: URLSearchParams, fallback: PrintOptions): PrintOptions {
  const pick = <T extends string>(k: string, vals: readonly T[], d: T): T => (vals as readonly string[]).includes(q.get(k) ?? "") ? (q.get(k) as T) : d;
  const fields = q.get("fields");
  const header = q.get("header");
  const transitions = q.get("transitions");
  return {
    copy: pick("copy", ["band", "mine"], fallback.copy),
    sheets: pick("sheets", ["one", "perSet"], fallback.sheets),
    fields: fields == null ? fallback.fields : fields.split(",").filter(Boolean),
    titles: pick("titles", ["wrap", "short"], fallback.titles),
    header: header == null ? fallback.header : header !== "0",
    transitions: transitions == null ? fallback.transitions : transitions !== "0",
    paper: pick("paper", ["letter", "a4"], fallback.paper),
  };
}

/** Artist-relative path of the print route (prefix with artistPath). `id` is a template id or a show id (a show's setlist id). */
export const printPath = (id: string, o: PrintOptions) => `/setlists/${encodeURIComponent(id)}/print?${printQuery(o)}`;

export const PAGE_MARGIN_IN = 0.5;
export const PAPER: Record<PrintPaper, { label: string; css: string; wIn: number; hIn: number }> = {
  letter: { label: "Letter", css: "letter", wIn: 8.5, hIn: 11 },
  a4: { label: "A4", css: "A4", wIn: 8.27, hIn: 11.69 },
};
/** The sheet box (page minus margins) in CSS px at 96 px per inch. */
export const sheetBox = (p: PrintPaper) => ({ w: Math.floor((PAPER[p].wIn - 2 * PAGE_MARGIN_IN) * 96), h: Math.floor((PAPER[p].hIn - 2 * PAGE_MARGIN_IN) * 96) });

/**
 * The biggest base text size (whole px) at which `measure(px)` says everything fits. `measure` sets the base size on every
 * sheet and returns true when no sheet's content is taller than its box, so all sheets share one size. If even `min`
 * doesn't fit, returns `min` (the sheet overflows and the dialog warns).
 */
export function fitTextSize(measure: (px: number) => boolean, min = 14, max = 96): number {
  if (measure(max)) return max;
  if (!measure(min)) return min;
  let lo = min, hi = max; // measure(lo) fits, measure(hi) doesn't
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (measure(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

/** CSS px to points (what the dialog shows): 1pt = 4/3 px. */
export const pxToPt = (px: number) => Math.round(px * 0.75);
