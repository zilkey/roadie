/**
 * One-time import of the band's "Accounting Form" (Shows tab: one row per gig, what came in and how) onto the shows that
 * already exist, from the snapshot in .booking-kit/accounting-shows.json (gitignored: real money and notes, public repo).
 *   tsx scripts/import-show-income.ts [--dry-run] [--yes] [--artist=<slug>] [--report=<file.json>]
 * Each row is matched to one of the artist's shows on the same date (by venue, host, festival or city name; a lone show that
 * day is taken as a date-only match and reported). Nothing is created: rows with no show are reported, with the venue when one
 * matches, so the show can be added by hand and the import run again.
 * For a matched show:
 *   - the money columns become income lines on its deal, all received (ids acct-*, so a re-run replaces them, never doubles them);
 *     a not-received guarantee line from booking is replaced by the received one; any other income already on the deal is left
 *     alone and the row is reported instead
 *   - Gig Length fills times.setLengthSec when the show has none (a different booked length is reported, not overwritten)
 *   - Notes, Audience Count and the Ingie Award go to the deal's rating (notes / crowd) once the rating no longer requires the
 *     1-5 stars; until then they are reported as waiting
 * All writes go through db.ts with via "import" and one runId, so Admin → History can undo the whole import.
 * Against real Firestore (no emulator host) it needs --yes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run, db, type Doc } from "../src/server/db";
import { importCtx, newRunId } from "../src/server/ctx";
import { refreshDealTotals } from "../src/server/dealTotals";
import { slug } from "../src/schema/normalize";
import { ShowDeal } from "../src/schema/shows";
import { setLengthOf } from "../src/lib/duration";
import { sumIncome, formatCents } from "../src/lib/money";

// ---------- sheet parsing (shared with import-gas.ts) ----------

/** "6/28/2026" -> "2026-06-28"; undefined when it isn't a date. */
export function sheetDate(s: string): string | undefined {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : undefined;
}
/** "$1,000.00", "121.4", "" -> cents (0 when blank). */
export function sheetCents(s: string | undefined): number {
  const t = (s ?? "").replace(/[$,\s]/g, "");
  return t ? Math.round(Number(t) * 100) : 0;
}
export const loadSnapshot = (file: string) =>
  JSON.parse(readFileSync(join(process.cwd(), ".booking-kit", file), "utf8")) as { source: string; values: string[][]; [k: string]: unknown };

// ---------- matching a sheet row to a show ----------

const STOP = new Set([
  "the", "a", "and", "of", "at", "co", "house", "concert", "show", "party", "hc", "hs", "fest", "festival", "canceled", "vb",
]);
const words = (s: string) => slug(s).split("-").filter((t) => t && !/^\d+$/.test(t));
const initials = (s: string) => words(s).map((t) => t[0]).join("");

/** Everything a show is called: venue, hosts, festival year, city, and its id (booking-kit ids carry the place). */
function namesOf(s: Doc): string[] {
  const v = s.venue as { name?: string } | undefined, p = s.place as { city?: string } | undefined;
  return [v?.name, s.hostName as string | undefined, s.editionName as string | undefined, p?.city, (s.id as string).replace(/-\d{4}-\d{2}-\d{2}$/, "")]
    .filter((x): x is string => !!x);
}
export const showLabel = (s: Doc) => {
  const v = s.venue as { name?: string } | undefined, p = s.place as { city?: string } | undefined;
  return [v?.name ?? (s.hostName ? `${s.hostName} (${p?.city ?? "house"})` : p?.city), s.editionName].filter(Boolean).join(" · ");
};

/** How well a gig name fits a show: shared words, a squashed-together name ("Breadbar"), or initials ("WWMS", "BV"). */
export function nameScore(gig: string, s: Doc): number {
  const g = words(gig).filter((t) => !STOP.has(t));
  const names = namesOf(s);
  const hay = new Set(names.flatMap(words));
  let n = g.filter((t) => hay.has(t)).length;
  const squashed = g.join("");
  if (squashed.length >= 5 && names.some((x) => words(x).join("").includes(squashed) || squashed.includes(words(x).join("") || "\0"))) n += 1;
  if (g.some((t) => t.length >= 2 && names.some((x) => initials(x).replace(/\d/g, "") === t))) n += 1;
  return n;
}

export interface Match<R> { row: R; show?: Doc; how: "name" | "date-only" | "ambiguous" | "none"; candidates: Doc[] }

/** Name matches first (they claim their show); then a row left alone on a day with one unclaimed show takes it, date-only. */
export function matchRows<R extends { date: string; gig: string }>(rows: R[], shows: Doc[]): Match<R>[] {
  const byDate = new Map<string, Doc[]>();
  for (const s of shows) byDate.set(s.date as string, [...(byDate.get(s.date as string) ?? []), s]);
  const claimed = new Set<string>();
  const out: Match<R>[] = rows.map((row) => {
    const cands = byDate.get(row.date) ?? [];
    const scored = cands.map((s) => ({ s, n: nameScore(row.gig, s) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
    if (scored.length && (scored.length === 1 || scored[0].n > scored[1].n)) {
      claimed.add(scored[0].s.id);
      return { row, show: scored[0].s, how: "name", candidates: cands };
    }
    return { row, how: scored.length ? "ambiguous" : "none", candidates: cands };
  });
  for (const m of out) {
    if (m.how !== "none") continue;
    const open = m.candidates.filter((s) => !claimed.has(s.id));
    if (m.candidates.length === 1 && open.length === 1) { m.show = open[0]; m.how = "date-only"; claimed.add(open[0].id); }
  }
  return out;
}

/** For a row with no show that day: the same place on a nearby date (a typo'd year or month), best first. */
export function nearby(gig: string, date: string, shows: Doc[], days = 400): Doc[] {
  const t = Date.parse(date);
  return shows
    .filter((s) => Math.abs(Date.parse(s.date as string) - t) <= days * 864e5 && nameScore(gig, s) > 0)
    .sort((a, b) => Math.abs(Date.parse(a.date as string) - t) - Math.abs(Date.parse(b.date as string) - t))
    .slice(0, 3);
}

// ---------- the Shows tab ----------

/** Money columns -> income line (id, category, method). Blank or $0 cells add nothing. */
const MONEY: { col: string; id: string; category: "guarantee" | "door" | "tips" | "merch"; method?: "cash" | "venmo" }[] = [
  { col: "Guarantee (Check / Venmo)", id: "acct-guarantee", category: "guarantee" },
  { col: "Guarantee (Cash)", id: "acct-guarantee-cash", category: "guarantee", method: "cash" },
  { col: "Ticket Sales", id: "acct-door", category: "door" },
  { col: "Cash Ticket Sales", id: "acct-door-cash", category: "door", method: "cash" },
  { col: "Cash Tip", id: "acct-tips-cash", category: "tips", method: "cash" },
  { col: "Cash Merch", id: "acct-merch-cash", category: "merch", method: "cash" },
  { col: "Venmo Tip", id: "acct-tips-venmo", category: "tips", method: "venmo" },
  { col: "Venmo Merch", id: "acct-merch-venmo", category: "merch", method: "venmo" },
];

export interface GigRow {
  line: number; date: string; gig: string; canceled: boolean;
  income: { id: string; category: string; amount: number; method?: string; received: true }[];
  sheetTotal: number; minutes?: number; hours?: number; notes?: string; audience?: number; award?: string;
}

export function parseShows(values: string[][]): { rows: GigRow[]; skipped: { line: number; why: string }[] } {
  const [head, ...body] = values;
  const col = (r: string[], name: string) => (r[head.indexOf(name)] ?? "").trim();
  const rows: GigRow[] = [], skipped: { line: number; why: string }[] = [];
  body.forEach((r, i) => {
    const line = i + 2, date = sheetDate(col(r, "Date"));
    if (!date) { if (r.some((c) => c.trim())) skipped.push({ line, why: "no date (totals row)" }); return; }
    const rawGig = col(r, "Gig");
    const income = MONEY.map((m) => ({ id: m.id, category: m.category, amount: sheetCents(col(r, m.col)), ...(m.method ? { method: m.method } : {}), received: true as const }))
      .filter((l) => l.amount > 0);
    const minutes = Number(col(r, "Gig Length (minutes)")) || undefined;
    const hours = Number(col(r, "Hours")) || undefined;
    const audience = Number(col(r, "Audience Count")) || undefined;
    const notes = col(r, "Notes").replace(/^\.\.\.$/, "") || undefined;
    rows.push({
      line, date, gig: rawGig.replace(/^\[canceled\]\s*/i, ""), canceled: /^\[canceled\]/i.test(rawGig), income,
      sheetTotal: sheetCents(col(r, "Total Income")), minutes, hours, notes, audience, award: col(r, "Ingie Award Nomination") || undefined,
    });
  });
  return { rows, skipped };
}

// ---------- the import ----------

export interface IncomeReport {
  project: string; dryRun: boolean; runId: string; artist?: { id: string; name: string }; source: string;
  ratingsSupported: boolean;
  rows: {
    line: number; date: string; gig: string; canceled: boolean; sheetTotal: number; income: number;
    match: "name" | "date-only" | "ambiguous" | "none"; showId?: string; showLabel?: string; showStatus?: string;
    candidates: string[]; nearby: string[]; venueHits: string[];
    incomeAction?: "added" | "replaced" | "unchanged" | "conflict" | "no deal" | "none";
    existingIncome?: number; setLength?: "filled" | "same" | "differs" | "none"; bookedMinutes?: number; minutes?: number;
    rating?: "written" | "waiting" | "none"; issues: string[];
  }[];
  skipped: { line: number; why: string }[];
  showsWithoutRow: { id: string; date: string; label: string }[];
}

export async function importShowIncome(opts: { dryRun?: boolean; artist?: string } = {}): Promise<IncomeReport> {
  const snap = loadSnapshot("accounting-shows.json");
  const { rows, skipped } = parseShows(snap.values);
  const runId = newRunId();
  const report: IncomeReport = {
    project: process.env.GCLOUD_PROJECT ?? "", dryRun: !!opts.dryRun, runId, source: snap.source,
    ratingsSupported: ShowDeal.shape.rating.safeParse({ crowd: 1, notes: "x" }).success, rows: [], skipped, showsWithoutRow: [],
  };
  const artists = await db.list("artists");
  const artist = opts.artist ? artists.find((a) => a.slug === opts.artist) : artists.length === 1 ? artists[0] : undefined;
  if (!artist) {
    if (artists.length > 1) throw new Error(`Several artists: pass --artist=<slug> (${artists.map((a) => a.slug).join(", ")})`);
    for (const r of rows) report.rows.push({ ...rowBase(r), match: "none", candidates: [], nearby: [], venueHits: [], issues: ["no artist in this project yet"] });
    return report;
  }
  report.artist = { id: artist.id, name: artist.name as string };
  const ctx = importCtx("import-show-income", runId, artist.id);
  const shows = await db.list("shows", (q) => q.where("artistId", "==", artist.id));
  const venues = await db.list("venues");
  const matches = matchRows(rows, shows);
  const used = new Set(matches.map((m) => m.show?.id).filter(Boolean));

  for (const m of matches) {
    const r = m.row, s = m.show;
    const out: IncomeReport["rows"][number] = {
      ...rowBase(r), match: m.how, candidates: m.candidates.map((c) => `${c.id} (${showLabel(c)})`), nearby: [], venueHits: [], issues: [],
    };
    report.rows.push(out);
    if (r.sheetTotal !== sumIncome(r.income)) out.issues.push(`Total Income says ${formatCents(r.sheetTotal)}, the columns add up to ${formatCents(sumIncome(r.income))}`);
    if (!r.minutes && r.hours) out.issues.push(`Gig Length is blank but Hours says ${r.hours} (looks like minutes typed in the Hours column)`);
    if (!s) {
      out.nearby = nearby(r.gig, r.date, shows).map((c) => `${c.date} ${c.id} (${showLabel(c)})`);
      out.venueHits = venues.filter((v) => !v.deletedAt && words(r.gig).filter((t) => !STOP.has(t)).some((t) => words(v.name as string).includes(t)))
        .slice(0, 3).map((v) => `${v.id} (${v.name}, ${(v.address as { city?: string })?.city ?? ""})`);
      continue;
    }
    Object.assign(out, { showId: s.id, showLabel: showLabel(s), showStatus: s.status });
    if (r.canceled && s.status !== "canceled") out.issues.push(`the sheet says canceled, the show is "${s.status}"`);
    if (!r.canceled && (s.status === "canceled" || s.status === "dropped")) out.issues.push(`the show is ${s.status} but the sheet has it as played`);

    const deal = await db.get("showDeals", s.id);
    const patch: Record<string, unknown> = {};
    if (!deal || deal.deletedAt) out.incomeAction = r.income.length ? "no deal" : "none";
    else {
      const have = (deal.income ?? []) as { id: string; category: string; amount: number; method?: string; received: boolean }[];
      const ours = have.filter((l) => l.id.startsWith("acct-"));
      const booked = have.filter((l) => !l.id.startsWith("acct-") && l.category === "guarantee" && !l.received && r.income.some((x) => x.category === "guarantee"));
      const other = have.filter((l) => !ours.includes(l) && !booked.includes(l));
      out.existingIncome = sumIncome(have);
      if (!r.income.length) out.incomeAction = "none";
      else if (other.length) {
        out.incomeAction = "conflict";
        out.issues.push(`the deal already has ${other.length} other income line(s) (${formatCents(sumIncome(other))}): left as is`);
      } else {
        const next = [...have.filter((l) => !ours.includes(l) && !booked.includes(l)), ...r.income];
        if (JSON.stringify(next) === JSON.stringify(have)) out.incomeAction = "unchanged";
        else {
          patch.income = next;
          out.incomeAction = ours.length || booked.length ? "replaced" : "added";
          const bookedSum = sumIncome(booked), gotGuarantee = sumIncome(r.income.filter((l) => l.category === "guarantee"));
          if (booked.length && bookedSum !== gotGuarantee) out.issues.push(`booked guarantee was ${formatCents(bookedSum)}, the sheet says ${formatCents(gotGuarantee)} came in`);
        }
      }
      if (r.notes || r.audience || r.award) {
        if (!report.ratingsSupported) out.rating = "waiting";
        else {
          const cur = (deal.rating ?? {}) as Record<string, unknown>;
          const notes = [r.notes, r.award && `Ingie Award: ${r.award}`].filter(Boolean).join("\n\n");
          const next = { ...cur, ...(r.audience !== undefined && cur.crowd === undefined ? { crowd: r.audience } : {}), ...(notes && !cur.notes ? { notes } : {}) };
          if (JSON.stringify(next) !== JSON.stringify(cur)) { patch.rating = next; out.rating = "written"; } else out.rating = "none";
          if (cur.notes && notes && cur.notes !== notes) out.issues.push("the deal already has rating notes: sheet notes not written");
        }
      }
    }

    const times = (s.times ?? {}) as Record<string, unknown>;
    const booked = setLengthOf(times as { setLengthSec?: number; setLength?: number });
    out.minutes = r.minutes;
    let showPatch: Record<string, unknown> | undefined;
    if (!r.minutes) out.setLength = "none";
    else if (booked === undefined) { out.setLength = "filled"; showPatch = { times: { ...times, setLengthSec: r.minutes * 60 } }; }
    else if (booked === r.minutes * 60) out.setLength = "same";
    else { out.setLength = "differs"; out.bookedMinutes = Math.round(booked / 60); }

    if (opts.dryRun || (!Object.keys(patch).length && !showPatch)) continue;
    await run(ctx, async (w) => {
      if (Object.keys(patch).length) await w.update("showDeals", s.id, patch);
      if (showPatch) await w.update("shows", s.id, showPatch);
      if (patch.income) await refreshDealTotals(w, s.id);
    });
  }
  const cutoff = rows.reduce((a, r) => (r.date < a ? r.date : a), "9999");
  const last = rows.reduce((a, r) => (r.date > a ? r.date : a), "");
  report.showsWithoutRow = shows
    .filter((s) => !used.has(s.id) && s.status === "played" && (s.date as string) >= cutoff && (s.date as string) <= last)
    .sort((a, b) => ((a.date as string) < (b.date as string) ? -1 : 1))
    .map((s) => ({ id: s.id, date: s.date as string, label: showLabel(s) }));
  return report;
}

function rowBase(r: GigRow) {
  return { line: r.line, date: r.date, gig: r.gig, canceled: r.canceled, sheetTotal: r.sheetTotal, income: sumIncome(r.income), issues: [] as string[] };
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await importShowIncome({ dryRun: flag("dry-run"), artist: arg("artist") });
  const verb = r.dryRun ? "Would import" : "Imported";
  const by = (k: string) => r.rows.filter((x) => x.incomeAction === k).length;
  console.log(`${verb} ${r.rows.length} gig rows into ${r.project}${r.artist ? ` (${r.artist.name})` : ""}, run ${r.runId}`);
  console.log(`  matched by name ${r.rows.filter((x) => x.match === "name").length}, by date only ${r.rows.filter((x) => x.match === "date-only").length}, ambiguous ${r.rows.filter((x) => x.match === "ambiguous").length}, no show ${r.rows.filter((x) => x.match === "none").length}`);
  console.log(`  income: added ${by("added")}, replaced ${by("replaced")}, unchanged ${by("unchanged")}, conflict ${by("conflict")}, no deal ${by("no deal")}`);
  console.log(`  set length filled ${r.rows.filter((x) => x.setLength === "filled").length}, differs ${r.rows.filter((x) => x.setLength === "differs").length}; ratings ${r.ratingsSupported ? "written" : "waiting (rating needs stars)"}`);
  for (const x of r.rows.filter((x) => x.issues.length || x.match !== "name")) console.log(`  line ${x.line} ${x.date} ${x.gig} [${x.match}${x.showId ? ` -> ${x.showId}` : ""}]: ${x.issues.join("; ")}`);
  const out = arg("report");
  if (out) { writeFileSync(out, JSON.stringify(r, null, 2) + "\n"); console.log(`Report: ${out}`); }
}

if (process.argv[1]?.endsWith("import-show-income.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
