/** Pure stats helpers: Spotify for Artists CSV parsing and "latest numbers". */

export interface StatLike { source: string; date: string; followers?: number; monthlyListeners?: number; streams?: number; popularity?: number }

/** Latest value of each number across all snapshots (a source that lacks a field does not hide an older value). */
export function statsCurrent(snaps: StatLike[]) {
  const sorted = [...snaps].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const latest = (f: "followers" | "monthlyListeners" | "streams" | "popularity") => {
    const s = sorted.find((x) => typeof x[f] === "number");
    return s ? { value: s[f] as number, date: s.date, source: s.source } : undefined;
  };
  return { followers: latest("followers"), monthlyListeners: latest("monthlyListeners"), streams: latest("streams"), popularity: latest("popularity") };
}

/** Values for {{stats.*}} template fields. */
export function statsTemplateFields(snaps: StatLike[]): Record<string, string | undefined> {
  const c = statsCurrent(snaps);
  const n = (x?: { value: number }) => (x ? x.value.toLocaleString("en-US") : undefined);
  return { "stats.monthlyListeners": n(c.monthlyListeners), "stats.followers": n(c.followers) };
}

/** RFC 4180-ish CSV: quotes, escaped quotes, BOM, CRLF. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Day the numbers describe. A bare month ("2026-09", "Sep 2026", "9/2026") means the last day of that month. */
export function parseStatDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m) return valid(+m[1], +m[2], lastDay(+m[1], +m[2]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return valid(+m[3], +m[1], +m[2]);
  m = /^(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return valid(+m[2], +m[1], lastDay(+m[2], +m[1]));
  m = /^([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/.exec(s);
  if (m) { const mi = MONTHS.indexOf(m[1].toLowerCase()); if (mi >= 0) return valid(+m[2], mi + 1, lastDay(+m[2], mi + 1)); }
  return null;
}
function valid(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > lastDay(y, mo)) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}
const num = (raw: string | undefined): number | null | undefined => {
  if (raw === undefined) return undefined;
  const s = raw.trim().replace(/[,\s]/g, "");
  if (s === "") return undefined;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s));
};

export interface ParsedStatRow { date: string; monthlyListeners?: number; streams?: number; followers?: number }
export interface CsvParseResult { rows: ParsedStatRow[]; errors: string[] }

const HEADS: Record<string, "date" | "monthlyListeners" | "streams" | "followers"> = {
  date: "date", day: "date", month: "date", period: "date",
  listeners: "monthlyListeners", "monthly listeners": "monthlyListeners", "monthly_listeners": "monthlyListeners", monthlylisteners: "monthlyListeners",
  streams: "streams", "total streams": "streams", plays: "streams",
  followers: "followers", "total followers": "followers",
};

/** Parse a Spotify for Artists audience export (or anything with date + listeners/streams/followers columns). */
export function parseSpotifyCsv(text: string): CsvParseResult {
  const table = parseCsv(text);
  const errors: string[] = [];
  if (!table.length) return { rows: [], errors: ["The file is empty"] };
  const head = table[0].map((h) => HEADS[h.trim().toLowerCase()]);
  const col = (k: string) => head.indexOf(k as never);
  if (col("date") < 0) return { rows: [], errors: ["No date column (expected a header like date, day or month)"] };
  if (col("monthlyListeners") < 0 && col("streams") < 0 && col("followers") < 0) {
    return { rows: [], errors: ["No numbers found (expected listeners, streams or followers columns)"] };
  }
  const byDate = new Map<string, ParsedStatRow>();
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const date = parseStatDate(r[col("date")] ?? "");
    if (!date) { errors.push(`Line ${line}: can't read the date "${(r[col("date")] ?? "").trim()}"`); return; }
    const out: ParsedStatRow = { date };
    for (const k of ["monthlyListeners", "streams", "followers"] as const) {
      if (col(k) < 0) continue;
      const v = num(r[col(k)]);
      if (v === null) { errors.push(`Line ${line}: "${r[col(k)].trim()}" is not a number`); return; }
      if (v !== undefined) out[k] = v;
    }
    if (out.monthlyListeners === undefined && out.streams === undefined && out.followers === undefined) { errors.push(`Line ${line}: no numbers`); return; }
    byDate.set(date, { ...byDate.get(date), ...out });
  });
  return { rows: [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)), errors };
}
