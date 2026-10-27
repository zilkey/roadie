import { buildSearchItems, searchItems } from "@/lib/booking";

/** How the Festivals tab is ordered. deadline = application deadline, date = edition start; "-" = latest first. */
export const FESTIVAL_SORTS = ["name", "deadline", "-deadline", "date", "-date"] as const;
export type FestivalSort = (typeof FESTIVAL_SORTS)[number];
export const FESTIVAL_PAGE_SIZE = 80;

type Fest = { id: string; name: string; type?: string; contactIds?: string[] };
type Ed = { id: string; festivalId: string; year: number; startDate?: string; appDeadline?: { date: string } };
type Person = { id: string; name: string; emails?: string[]; title?: string };
export type FestivalRef = { kind: "festival" | "edition"; id: string };

/**
 * The Festivals tab rows in order: one per edition (a festival with none gets one row of its own), matching `q` like the booking search
 * does (a festival's name or its contacts). By name: festivals A-Z, each one's newest year first. By deadline or date: rows without one
 * always go last, by name, whichever way the sort runs.
 */
export function festivalRows(d: { festivals: Fest[]; editions: Ed[]; contacts: Person[] }, q: string, sort: FestivalSort): FestivalRef[] {
  const hit = q.trim()
    ? new Set(searchItems(buildSearchItems({ venues: [], promoters: [], festivals: d.festivals, contacts: d.contacts }), q).filter((i) => i.kind === "festival").map((i) => i.id))
    : null;
  const rows: { ref: FestivalRef; name: string; year: number; deadline?: string; date?: string }[] = [];
  for (const f of d.festivals) {
    if (hit && !hit.has(f.id)) continue;
    const eds = d.editions.filter((e) => e.festivalId === f.id);
    if (!eds.length) rows.push({ ref: { kind: "festival", id: f.id }, name: f.name, year: 0 });
    for (const e of eds) rows.push({ ref: { kind: "edition", id: e.id }, name: f.name, year: e.year, deadline: e.appDeadline?.date, date: e.startDate });
  }
  const byName = (a: (typeof rows)[number], b: (typeof rows)[number]) => a.name.localeCompare(b.name) || b.year - a.year;
  const key = sort.replace("-", "") as "name" | "deadline" | "date", desc = sort.startsWith("-");
  rows.sort((a, b) => {
    if (key === "name") return byName(a, b);
    const x = a[key], y = b[key];
    if (!x || !y) return x ? -1 : y ? 1 : byName(a, b);
    return (desc ? y.localeCompare(x) : x.localeCompare(y)) || byName(a, b);
  });
  return rows.map((r) => r.ref);
}
