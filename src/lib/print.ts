/**
 * Printable setlists: the options, the print route's query string, paper sizes and the fit-to-page search. Shared by the
 * Print dialog, the print route and the setlists.printLink command, so a link Roadie builds opens the same sheets.
 */
import type { PrintOptions, PrintPaper } from "@/schema/print";

export const FIELD_KEY = "key";
export const FIELD_LENGTH = "length";
export const FIELD_BREAKS = "breaks";
/** The extra-field id for one of the artist's song fields. */
export const songFieldId = (id: string) => `field:${id}`;

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
