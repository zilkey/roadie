/**
 * One-time import of the band's "Accounting Form" (Shows tab: one row per gig, what came in and how) onto the shows that
 * already exist, from the snapshot in .booking-kit/accounting-shows.json (gitignored: real money and notes, public repo).
 *   tsx scripts/import-show-income.ts [--dry-run] [--yes] [--artist=<slug>] [--report=<file.json>]
 * Each row is matched to one of the artist's shows on the same date (by venue, host, festival or city name; a lone show that
 * day is taken as a date-only match and reported). Nothing is created: rows with no show are reported, with the venue when one
 * matches, so the show can be added by hand and the import run again.
 * For a matched show:
 *   - the money columns become income docs (the income collection), all received on the show's date, on the show's project
 *     (else the artist's default, Band); sourceKey "acct:<showId>:<column>", so a re-run replaces them, never doubles them.
 *     Run `npm run migrate:money` first: income used to live on the deal, and that migration makes the projects too.
 *     The booked guarantee (the income doc copied from the deal's line "g", received or not, as booking marks every past show's
 *     pay received) or any other not-received guarantee doc is replaced by the sheet's, and the amounts are compared; any other
 *     income already on the show is left alone and the row is reported instead, as are deal income[] lines the migration has
 *     not copied yet (nothing is written for that row)
 *   - Gig Length fills times.setLengthSec when the show has none (a different booked length is reported, not overwritten)
 *   - Notes and the Ingie Award go to the deal's rating notes, Audience Count to the deal's `crowd`, once the rating no
 *     longer requires the 1-5 stars; until then they are reported as waiting. Neither overwrites one the show already has
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
import { formatSurvey, note, tally, type Note, type Survey } from "./survey";

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

/** The fixed id import-booking-kit.ts gives the venue book's pay line. */
const BOOKED_ID = "g";

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

const sumDocs = (ds: Doc[]) => sumIncome(ds as unknown as { amount: number }[]);

/** What a row's money columns would do to the show's income docs: remove the booked/stale ones, fix changed ones, add the rest. */
interface IncomePlan {
  projectId: string;
  update: { id: string; x: { sourceKey: string; category: string; amount: number; method?: string } }[];
  create: { sourceKey: string; category: string; amount: number; method?: string }[];
  remove: string[];
}

export interface IncomeReport {
  project: string; dryRun: boolean; runId: string; artist?: { id: string; name: string }; source: string;
  ratingsSupported: boolean;
  rows: {
    line: number; date: string; gig: string; canceled: boolean; sheetTotal: number; income: number;
    match: "name" | "date-only" | "ambiguous" | "none"; showId?: string; showLabel?: string; showStatus?: string;
    candidates: string[]; nearby: string[]; venueHits: string[];
    incomeAction?: "added" | "replaced" | "unchanged" | "conflict" | "no project" | "none";
    existingIncome?: number; setLength?: "filled" | "same" | "differs" | "none"; bookedMinutes?: number; minutes?: number;
    rating?: "written" | "waiting" | "none"; issues: string[];
  }[];
  skipped: { line: number; why: string }[];
  showsWithoutRow: { id: string; date: string; label: string }[];
}

/** `snapshot` stands in for the gitignored .booking-kit file, so tests can run the import on rows of their own. */
export async function importShowIncome(opts: { dryRun?: boolean; artist?: string; snapshot?: { source: string; values: string[][] } } = {}): Promise<IncomeReport> {
  const snap = opts.snapshot ?? loadSnapshot("accounting-shows.json");
  const { rows, skipped } = parseShows(snap.values);
  const runId = newRunId();
  const report: IncomeReport = {
    project: process.env.GCLOUD_PROJECT ?? "", dryRun: !!opts.dryRun, runId, source: snap.source,
    ratingsSupported: ShowDeal.shape.rating.safeParse({ notes: "x" }).success, rows: [], skipped, showsWithoutRow: [],
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
  const defaultProjectId = new Map((await db.list("projects")).filter((p) => p.isDefault).map((p) => [p.artistId as string, p.id]));
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
    let plan: IncomePlan | undefined;
    {
      const have = await db.list("income", (q) => q.where("showId", "==", s.id));
      const ours = have.filter((d) => typeof d.sourceKey === "string" && d.sourceKey.startsWith(`acct:${s.id}:`));
      const booked = have.filter((d) => !ours.includes(d) && r.income.some((x) => x.category === "guarantee")
        && (d.sourceKey === `${s.id}:${BOOKED_ID}` || (d.category === "guarantee" && !d.receivedAt)));
      const copied = new Set(have.map((d) => d.sourceKey));
      // Deal lines the migration has not copied yet are income we cannot see as docs: treat them like hand-entered income.
      const legacy = (deal && !deal.deletedAt ? ((deal.income ?? []) as { id: string; amount: number }[]) : [])
        .filter((l) => l.amount > 0 && !copied.has(`${s.id}:${l.id}`) && !l.id.startsWith("acct-"));
      const other = have.filter((d) => !ours.includes(d) && !booked.includes(d));
      out.existingIncome = sumDocs(have);
      if (!r.income.length) out.incomeAction = "none";
      else if (other.length || legacy.length) {
        out.incomeAction = "conflict";
        if (other.length) out.issues.push(`the show already has ${other.length} other income line(s) (${formatCents(sumDocs(other))}): left as is`);
        if (legacy.length) out.issues.push(`the deal still has ${legacy.length} legacy income line(s) (${formatCents(sumIncome(legacy))}): run npm run migrate:money first`);
      } else {
        const projectId = (s.projectId as string | undefined) ?? defaultProjectId.get(s.artistId as string);
        const want = r.income.map((l) => ({
          sourceKey: `acct:${s.id}:${l.id.replace(/^acct-/, "")}`, category: l.category, amount: l.amount, ...(l.method ? { method: l.method } : {}),
        }));
        const same = (d: Doc, x: (typeof want)[number]) => d.amount === x.amount && d.category === x.category && d.method === x.method && d.receivedAt === s.date;
        const unchanged = want.length === ours.length && !booked.length && want.every((x) => ours.some((d) => d.sourceKey === x.sourceKey && same(d, x)));
        if (unchanged) out.incomeAction = "unchanged";
        else if (!projectId) {
          out.incomeAction = "no project";
          out.issues.push("the show has no project and the artist has no default project: run npm run migrate:money first");
        } else {
          out.incomeAction = ours.length || booked.length ? "replaced" : "added";
          const bookedSum = sumDocs(booked), gotGuarantee = sumIncome(r.income.filter((l) => l.category === "guarantee"));
          if (booked.length && bookedSum !== gotGuarantee) out.issues.push(`booked guarantee was ${formatCents(bookedSum)}, the sheet says ${formatCents(gotGuarantee)} came in`);
          plan = {
            projectId,
            update: want.flatMap((x) => { const d = ours.find((o) => o.sourceKey === x.sourceKey); return d && !same(d, x) ? [{ id: d.id, x }] : []; }),
            create: want.filter((x) => !ours.some((o) => o.sourceKey === x.sourceKey)),
            remove: [...ours.filter((d) => !want.some((x) => x.sourceKey === d.sourceKey)), ...booked].map((d) => d.id),
          };
        }
      }
    }
    if (deal && !deal.deletedAt) {
      if (r.notes || r.audience || r.award) {
        if (!report.ratingsSupported) out.rating = "waiting";
        else {
          // Notes go on the rating; the crowd estimate is its own field (a pre-migration rating.crowd still counts as "has one").
          const cur = (deal.rating ?? {}) as Record<string, unknown>;
          const notes = [r.notes, r.award && `Ingie Award: ${r.award}`].filter(Boolean).join("\n\n");
          const next = { ...cur, ...(notes && !cur.notes ? { notes } : {}) };
          const haveCrowd = deal.crowd ?? cur.crowd;
          const setCrowd = r.audience !== undefined && haveCrowd === undefined;
          if (JSON.stringify(next) !== JSON.stringify(cur)) patch.rating = next;
          if (setCrowd) patch.crowd = r.audience;
          out.rating = patch.rating || setCrowd ? "written" : "none";
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

    if (opts.dryRun || (!Object.keys(patch).length && !showPatch && !plan)) continue;
    await run(ctx, async (w) => {
      if (Object.keys(patch).length) await w.update("showDeals", s.id, patch);
      if (showPatch) await w.update("shows", s.id, showPatch);
      if (plan) {
        const made: Doc[] = [];
        const venue = s.venue as { name?: string } | undefined;
        const from = venue?.name ?? (s.hostName as string | undefined) ?? (s.editionName as string | undefined) ?? "Show";
        for (const id of plan.remove) await w.softDelete("income", id);
        for (const { id, x } of plan.update) await w.update("income", id, { ...x, method: x.method ?? null, receivedAt: s.date });
        for (const x of plan.create) {
          const c = await w.create("income", { ...x, artistId: s.artistId, date: s.date, from, projectId: plan.projectId, showId: s.id, receivedAt: s.date });
          made.push((await w.get("income", c.id))!);
        }
        await refreshDealTotals(w, s.id, { income: made });
      }
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

/**
 * The show-income survey. The two categories that actually need Jeff are rows matching no show at all (the money has
 * nowhere to go until the show is added by hand) and rows matched by date alone (the importer guessed, because only
 * one show existed that day).
 */
export function incomeSurvey(r: IncomeReport): Survey {
  const notes: Note[] = [];
  for (const x of r.rows) {
    const where = `line ${x.line} ${x.date} ${x.gig}`;
    if (x.match === "none") {
      notes.push(note("unclean", "no show on that date, so the money has nowhere to go", where,
        [x.nearby.length ? `nearby: ${x.nearby.join(", ")}` : "", x.venueHits.length ? `venue: ${x.venueHits.join(", ")}` : ""].filter(Boolean).join("; ") || undefined));
    }
    if (x.match === "ambiguous") notes.push(note("decide", "several shows that day fit the name equally well", where, x.candidates.join(", ")));
    if (x.match === "date-only") notes.push(note("decide", "matched by date alone: the name did not match, but it was the only show that day", where, x.showLabel));
    if (x.incomeAction === "conflict") notes.push(note("decide", "the show already carries other income, so the sheet's money was left out", where, formatCents(x.existingIncome ?? 0)));
    if (x.incomeAction === "no project") notes.push(note("unclean", "neither the show nor the artist has a project to put income on (run migrate:money)", where));
    if (x.incomeAction === "replaced") notes.push(note("overwrite", "income docs from an earlier run or from booking would be replaced", where, formatCents(x.existingIncome ?? 0)));
    if (x.setLength === "differs") notes.push(note("decide", "the booked set length disagrees with the sheet's Gig Length, and is kept", where, `booked ${x.bookedMinutes} min, sheet ${x.minutes} min`));
    if (x.rating === "waiting") notes.push(note("unclean", "Notes / Audience / Ingie columns are waiting on the ratings change (story 03)", where));
    for (const issue of x.issues) {
      // The conflict and set-length issues are already said above, in their own words: don't say them twice.
      if (/other income line|legacy income line|booked guarantee was/.test(issue)) continue;
      // Numbers and amounts are row-specific, so they go in the detail: the reason has to group.
      const reason = issue.replace(/\s*\([^)]*\)/g, "").replace(/-?\$[\d,.]+/g, "an amount").replace(/\b\d+(\.\d+)?\b/g, "N").trim();
      notes.push(note("decide", reason, where, issue));
    }
  }
  for (const s of r.skipped) notes.push(note("deferred", `row skipped: ${s.why}`, `line ${s.line}`));
  for (const s of r.showsWithoutRow) notes.push(note("deferred", "a played show in the sheet's date range has no row, so it gets no money", `${s.date} ${s.label}`));
  return {
    title: "Show income", project: r.project, dryRun: r.dryRun, runId: r.runId,
    source: `${r.rows.length} gig rows from ${r.source}`,
    clean: tally([
      ...r.rows.filter((x) => x.incomeAction && x.incomeAction !== "conflict" && x.incomeAction !== "no project")
        .map((x) => ({ collection: "income", action: x.incomeAction! })),
      ...r.rows.filter((x) => x.setLength === "filled").map(() => ({ collection: "shows set length", action: "filled" })),
      ...r.rows.filter((x) => x.rating === "written").map(() => ({ collection: "showDeals rating", action: "written" })),
    ]),
    notes,
    totals: {
      "matched by name": r.rows.filter((x) => x.match === "name").length,
      "matched by date only": r.rows.filter((x) => x.match === "date-only").length,
      "no show": r.rows.filter((x) => x.match === "none").length,
      ratings: r.ratingsSupported ? "written (story 03 landed)" : "WAITING: story 03 has not landed, so a second run is needed later",
      "income in the sheet": formatCents(r.rows.reduce((t, x) => t + x.income, 0)),
    },
  };
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await importShowIncome({ dryRun: flag("dry-run"), artist: arg("artist") });
  console.log(formatSurvey(incomeSurvey(r)));
  const out = arg("report");
  if (out) { writeFileSync(out, JSON.stringify({ ...r, survey: incomeSurvey(r) }, null, 2) + "\n"); console.log(`Report: ${out}`); }
}

if (process.argv[1]?.endsWith("import-show-income.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
