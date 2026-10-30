/**
 * Puts the band's October 2025 Colorado duo tour on Roadie as a tour (#47): one pass over the FINAL tab of the
 * "October Tour - Scenarios" sheet, from the saved values payload in .booking-kit/raw (gitignored: hosts, addresses, money).
 *   tsx scripts/import-october-tour.ts [--dry-run] [--yes] [--values=<payload.json>] [--aliases=<file.json>] [--year=2025]
 * The tour is a tag (tours/october-<year>-co-tour, status done, money goes to the shows' project). Its entries are the days:
 *   - a show entry for each venue row whose show already exists (made by snapshot-october-tour.ts + import-booking-kit.ts; found by
 *     the id the importer gave it, else the one live show that date). The show and its money get tourId, nothing else changes
 *   - a drive each morning the town changes (a day trip out and back is a round trip), miles and minutes from the maps service (Google, or the fake)
 *   - stays from the Lodging column (consecutive nights at one place are one stay; "provided" is the night's host), notes for
 *     travel days, a lead ("contact ..."), and a show that fell through (left off the tour)
 *   - the income already on those shows gets tourId and the show's entry, and is totalled against the sheet's Estimate
 * It creates no shows and no expenses: gas and paid lodging are listed as missing. The whole run is ONE db.ts unit, so --dry-run
 * walks the real data through the Writer overlay and prints the plan day by day and the survey, writing nothing. Re-running is
 * a no-op (every entry is matched against the tour's live entries first). All writes carry one runId, so Admin -> History can
 * undo the run. Against real Firestore (no emulator host) it needs --dry-run or --yes.
 */
import { existsSync, readFileSync } from "node:fs";
import { run, db, type Doc, type Writer } from "../src/server/db";
import { importCtx, newRunId } from "../src/server/ctx";
import { addShowTo, driveFacts, entriesPath, liveEntries, positionOn } from "../src/server/commands/tours";
import { artistFor, requireOpenProject } from "../src/server/commands/projects";
import { geocodeText } from "../src/server/geocode";
import { BAND_TIME_ZONE } from "../src/lib/timezone";
import { showName } from "../src/lib/shows";
import { formatCents } from "../src/lib/money";
import { formatSurvey, note, tally, type Note, type Survey } from "./survey";
import { C, slug, type Aliases } from "./snapshot-october-tour";

// ---------- the pure transform ----------

export const HOME = "Boulder";

export type PlanItem =
  | { kind: "drive"; date: string; from: string; to: string; roundTrip?: true }
  | { kind: "show"; date: string; venue: string; town: string; showId: string; estimateCents: number }
  | { kind: "stay"; date: string; name?: string; host?: true; nights: number; paying?: true; town: string }
  | { kind: "note"; date: string; text: string; why: "canceled" | "travel" | "lead"; showId?: string };
export interface TourPlan {
  name: string; startDate: string; endDate: string; leavingFrom: string; items: PlanItem[]; estimateCents: number;
  skipped: { row: number; date?: string; why: string }[];
}

const PENDING = /^pending$/i, TRAVEL = /^travel\/rest\/work day$/i, GOING_HOME = /^co tour$/i;
const LEAD = /\b(contact|ask|call|email|find)\b/i;
const cell = (r: unknown[], i: number) => String(r[i] ?? "").trim();
const cents = (s: string) => Math.round(Number(s.replace(/[$,\s]/g, "")) * 100) || 0;

interface Row { row: number; lodging: string; venue: string; town: string; estimate: string }
interface Stay { name: string; paying: boolean; dates: string[] }

/** The FINAL tab (header row first) -> the tour's days. No I/O; the DB layer matches it to what exists. */
export function planOctoberTour(values: unknown[][], aliases: Aliases = {}, year = "2025"): TourPlan {
  const days = new Map<string, Row[]>();
  for (const [i, r] of values.entries()) {
    const dm = i === 0 ? null : cell(r, C.date).match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!dm) continue; // the header and the legend (HOLD, CONFIRMED, the $ total) have no date
    const date = `${year}-${dm[1].padStart(2, "0")}-${dm[2].padStart(2, "0")}`;
    days.set(date, [...(days.get(date) ?? []), { row: i + 1, lodging: cell(r, C.lodging), venue: cell(r, C.venue), town: cell(r, C.location), estimate: cell(r, C.estimate) }]);
  }
  const dates = [...days.keys()];
  const skipped: TourPlan["skipped"] = [];
  const showIdOf = (venue: string, date: string) => `vb-${aliases[venue] ?? slug(venue)}-${date}`;
  const isShowRow = (r: Row) => !!r.venue && !PENDING.test(r.venue) && !TRAVEL.test(r.venue) && !GOING_HOME.test(r.venue);
  const lodgingOf = (date: string) => days.get(date)!.map((r) => r.lodging).find((l) => l && !/^tbd$/i.test(l));
  const goesHome = (date: string) => days.get(date)!.some((r) => GOING_HOME.test(r.venue));

  // Named stays: consecutive dates at the same place are one.
  const stays: Stay[] = [];
  const stayOf = new Map<string, Stay>();
  for (const date of dates) {
    const l = lodgingOf(date);
    if (!l || /provided/i.test(l) || LEAD.test(l) || goesHome(date)) continue;
    const paying = /\s*-\s*paying\s*$/i.test(l), name = l.replace(/\s*-\s*paying\s*$/i, "");
    const last = stays[stays.length - 1];
    if (last && last.name.toLowerCase() === name.toLowerCase() && dates[dates.indexOf(date) - 1] === last.dates[last.dates.length - 1]) last.dates.push(date);
    else stays.push({ name, paying, dates: [date] });
    stayOf.set(date, stays[stays.length - 1]);
  }

  const items: PlanItem[] = [];
  let prev = HOME;
  for (const date of dates) {
    const rows = days.get(date)!;
    const shows = rows.filter((r) => isShowRow(r) && r.estimate);
    if (goesHome(date)) {
      if (prev !== HOME) items.push({ kind: "drive", date, from: prev, to: HOME });
      prev = HOME;
      for (const r of rows.filter((x) => PENDING.test(x.venue))) skipped.push({ row: r.row, date, why: "pending: no venue" });
      continue;
    }
    const stay = stayOf.get(date);
    const firstTown = (rs: Row[]) => rs.find((r) => r.town)?.town;
    const night = (stay && stay.dates.length > 1 ? firstTown(stay.dates.flatMap((d) => days.get(d)!)) : undefined)
      ?? shows[0]?.town ?? firstTown(rows) ?? prev;
    if (night !== prev) items.push({ kind: "drive", date, from: prev, to: night });
    if (shows[0] && shows[0].town !== night) items.push({ kind: "drive", date, from: night, to: shows[0].town, roundTrip: true });
    prev = night;
    for (const r of shows) items.push({ kind: "show", date, venue: r.venue, town: r.town, showId: showIdOf(r.venue, date), estimateCents: cents(r.estimate) });
    for (const r of rows) {
      if (PENDING.test(r.venue)) skipped.push({ row: r.row, date, why: "pending: no venue" });
      else if (TRAVEL.test(r.venue)) items.push({ kind: "note", date, text: "Travel / rest / work day", why: "travel" });
      else if (isShowRow(r) && !r.estimate) items.push({ kind: "note", date, text: `${r.venue} (${r.town}) fell through`, why: "canceled", showId: showIdOf(r.venue, date) });
    }
    const l = lodgingOf(date);
    if (l && /provided/i.test(l)) items.push({ kind: "stay", date, host: true, nights: 1, town: night });
    else if (stay && stay.dates[0] === date) items.push({ kind: "stay", date, name: stay.name, nights: stay.dates.length, ...(stay.paying ? { paying: true as const } : {}), town: night });
    if (l && !/provided/i.test(l) && LEAD.test(l)) items.push({ kind: "note", date, text: `Lodging: ${l}`, why: "lead" });
  }
  return {
    name: `October ${year} Colorado Tour`, startDate: dates[0], endDate: dates[dates.length - 1], leavingFrom: HOME, items, skipped,
    estimateCents: items.reduce((n, i) => n + (i.kind === "show" ? i.estimateCents : 0), 0),
  };
}

// ---------- the import ----------

type Geo = { name: string; address: string; lat: number; lng: number };
export interface OctoberTourReport {
  dryRun: boolean; runId: string; tourId: string; plan: TourPlan; source: string;
  /** Plan lines by day: "+" new, "=" already there, "!" couldn't. */
  lines: { date: string; mark: "+" | "=" | "!"; text: string }[];
  rows: { collection: string; action: string }[]; notes: Note[];
  incomeCents: number; shows: number; expenses: number; payouts: number;
}

const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ""}`.trim() : `${min} min`);
const driveText = (d: { from: string; to: string; roundTrip?: boolean }, miles?: number | null, minutes?: number | null) =>
  `drive ${d.from} → ${d.to}${d.roundTrip ? " (round trip" : " ("}${miles != null ? `${d.roundTrip ? ", " : ""}${miles} mi${minutes != null ? `, ${hm(minutes)}` : ""}` : d.roundTrip ? "" : "miles unknown"})`;

export async function importOctoberTour(o: { dryRun: boolean; values: unknown[][]; aliases?: Aliases; year?: string }): Promise<OctoberTourReport> {
  const year = o.year ?? "2025";
  const plan = planOctoberTour(o.values, o.aliases ?? {}, year);
  const tourId = `october-${year}-co-tour`;
  const ctx = importCtx("import-october-tour");
  const overlay = new Map<string, Record<string, unknown> | null>();
  const notes: Note[] = [], rows: OctoberTourReport["rows"] = [], lines: OctoberTourReport["lines"] = [];

  // Maps first, outside the unit (the commands do the same). Only with an emulator or a key (GOOGLE_MAPS_API_KEY): otherwise orsClient is the local
  // fake and would cache fake coordinates in production.
  const have = await db.list(entriesPath(tourId));
  const driveKey = (d: { date?: string; to?: string; roundTrip?: boolean }) => `${d.date}|${d.to}|${!!d.roundTrip}`;
  const haveDrives = new Set(have.filter((e) => e.kind === "drive").map((e) => driveKey({ date: e.date, to: e.to?.name, roundTrip: e.roundTrip })));
  const orsOn = !!(process.env.FIRESTORE_EMULATOR_HOST || process.env.GOOGLE_MAPS_API_KEY || process.env.ORS_API_KEY);
  const geo = new Map<string, Geo | null>();
  const place = async (town: string) => {
    if (!geo.has(town)) {
      const ll = orsOn ? await geocodeText(`${town}, CO`) : null;
      geo.set(town, ll ? { name: town, address: `${town}, CO`, ...ll } : null);
    }
    return geo.get(town)!;
  };
  const facts = new Map<string, { miles: number | null; minutes: number | null }>();
  const newDrives = plan.items.filter((i) => i.kind === "drive").filter((d) => !haveDrives.has(driveKey(d)));
  await place(plan.leavingFrom);
  for (const d of newDrives) {
    const [a, b] = [await place(d.from), await place(d.to)];
    if (a && b && !facts.has(`${d.from}|${d.to}`)) facts.set(`${d.from}|${d.to}`, await driveFacts(a, b));
  }

  const report = await run(ctx, async (w: Writer) => {
    const artist = await artistFor(w);
    // The shows: by the id import-booking-kit gave them, else the one live show that day.
    const shows = new Map<string, Doc>();
    for (const it of plan.items) {
      if (it.kind !== "show") continue;
      const exact = await w.get("shows", it.showId);
      if (exact && !exact.deletedAt) { shows.set(it.showId, exact); continue; }
      const day = (await w.query("shows", (q) => q.where("date", "==", it.date))).filter((s) => !s.deletedAt && s.status !== "canceled" && (!s.artistId || s.artistId === artist.id));
      if (day.length === 1) {
        shows.set(it.showId, day[0]);
        notes.push(note("decide", "show matched by date only", `${it.date} ${it.venue} (${it.town})`, `took ${day[0].id}`));
      } else notes.push(note("unclean", "no show found for the venue row (item skipped)", `${it.date} ${it.venue} (${it.town})`, day.length ? `${day.length} shows that day` : undefined));
    }

    // The tour.
    let tour = await w.get("tours", tourId);
    if (tour?.deletedAt) throw new Error(`Tour ${tourId} exists but is deleted: restore it (or pick another --year) before importing.`);
    if (tour) rows.push({ collection: "tours", action: "unchanged" });
    else {
      const linked = [...shows.values()];
      if (!linked.length) throw new Error("No show on the tour was found, so there is no project for \"Money goes to\".");
      const projects = new Set(linked.map((s) => s.projectId));
      if (projects.size > 1) throw new Error(`The tour's shows are on different projects (${[...projects].join(", ")}): move them to one first.`);
      const projectId = linked[0].projectId as string | undefined;
      if (!projectId) throw new Error("The tour's shows have no project (run npm run migrate:money first).");
      await requireOpenProject(w, projectId);
      const billed = new Set(linked.map((s) => s.billedAs));
      const lf = geo.get(plan.leavingFrom);
      await w.create("tours", {
        artistId: artist.id, name: plan.name, status: "done", startDate: plan.startDate, endDate: plan.endDate, ...(lf ? { leavingFrom: lf } : {}),
        ...(billed.size === 1 && linked[0].billedAs ? { billedAs: linked[0].billedAs } : {}),
        personnel: [...new Set(linked.flatMap((s) => (s.personnel as string[] | undefined) ?? []))], projectId,
        notes: "Imported from the October Tour - Scenarios sheet (FINAL tab).",
      }, { id: tourId });
      tour = (await w.get("tours", tourId))!;
      rows.push({ collection: "tours", action: "created" });
      if (!lf) notes.push(note("unclean", "couldn't place the starting town: leavingFrom left off", plan.leavingFrom));
    }

    // The entries, in plan order so positions come out in plan order.
    const mine = await liveEntries(w, tourId);
    const entryOfShow = new Map<string, string>();
    const hostOn = (date: string) => {
      const it = plan.items.find((x) => x.kind === "show" && x.date === date && shows.has(x.showId)) as Extract<PlanItem, { kind: "show" }> | undefined;
      const s = it && shows.get(it.showId);
      return (s?.hostName as string | undefined) ?? (s?.venue as { name?: string } | undefined)?.name ?? "Host";
    };
    const add = async (fields: Record<string, unknown> & { date: string }) => {
      await w.create(entriesPath(tourId), { tourId, ...fields, position: await positionOn(w, tourId, fields.date), visibility: "band", tz: BAND_TIME_ZONE });
      rows.push({ collection: "tour entries", action: "created" });
    };
    const seen = (e: Doc | undefined, date: string, mark: "+" | "=", text: string) => {
      if (e) rows.push({ collection: "tour entries", action: "unchanged" });
      lines.push({ date, mark, text });
    };
    const miles: number[] = [];
    for (const it of plan.items) {
      if (it.kind === "show") {
        const show = shows.get(it.showId);
        if (!show) { lines.push({ date: it.date, mark: "!", text: `show ${it.venue} (${it.town}): no show found` }); continue; }
        const r = await addShowTo(w, tour!, show);
        entryOfShow.set(show.id, r.entryId);
        rows.push({ collection: "shows", action: r.existing ? "unchanged" : "tagged" }, { collection: "tour entries", action: r.existing ? "unchanged" : "created" });
        lines.push({ date: it.date, mark: r.existing ? "=" : "+", text: `show ${showName(show as never)}, ${it.town}` });
      } else if (it.kind === "drive") {
        const e = mine.find((x) => x.kind === "drive" && driveKey({ date: x.date, to: x.to?.name, roundTrip: x.roundTrip }) === driveKey(it));
        if (e) { seen(e, it.date, "=", driveText(it, e.miles, e.minutes)); if (e.miles != null) miles.push(e.miles); continue; }
        const [from, to] = [geo.get(it.from), geo.get(it.to)];
        if (!from || !to) {
          const bad = [!from && it.from, !to && it.to].filter(Boolean).join(" / ");
          notes.push(note("unclean", "couldn't place a town: drive left off", `${it.date} ${it.from} → ${it.to}`, `couldn't place ${bad}`));
          lines.push({ date: it.date, mark: "!", text: `${driveText(it)} left off` });
          continue;
        }
        const f = facts.get(`${it.from}|${it.to}`);
        await add({ date: it.date, kind: "drive", from, to, ...(it.roundTrip ? { roundTrip: true } : {}), ...(f?.miles != null ? { miles: f.miles } : {}), ...(f?.minutes != null ? { minutes: f.minutes } : {}) });
        lines.push({ date: it.date, mark: "+", text: driveText(it, f?.miles, f?.minutes) });
        if (f?.miles != null) miles.push(f.miles);
        notes.push(note("deferred", "no gas expense for the drive (none created)", `${it.date} ${it.from} → ${it.to}`, f?.miles != null ? `${f.miles} mi${it.roundTrip ? " each way" : ""}` : undefined));
      } else if (it.kind === "stay") {
        const name = it.host ? hostOn(it.date) : it.name!;
        const e = mine.find((x) => x.kind === "stay" && x.date === it.date && x.name === name);
        const text = `stay ${name} (${it.nights} night${it.nights > 1 ? "s" : ""})`;
        if (e) { seen(e, it.date, "=", text); } else { await add({ date: it.date, kind: "stay", name, nights: it.nights }); lines.push({ date: it.date, mark: "+", text }); }
        if (it.paying) notes.push(note("deferred", "paid lodging has no expense (none created)", `${it.date} ${name}`, `${it.nights} night${it.nights > 1 ? "s" : ""}`));
      } else {
        const e = mine.find((x) => x.kind === "note" && x.date === it.date && x.text === it.text);
        if (e) seen(e, it.date, "=", `note ${it.text}`);
        else { await add({ date: it.date, kind: "note", text: it.text }); lines.push({ date: it.date, mark: "+", text: `note ${it.text}` }); }
        if (it.why === "canceled" && it.showId) {
          const s = await w.get("shows", it.showId);
          if (s && !s.deletedAt && s.status !== "canceled") notes.push(note("decide", "the sheet says it fell through but the show isn't canceled", `${it.date} ${it.text}`, s.tourId === tourId ? "and it is ON the tour (left alone)" : undefined));
          else if (s && !s.deletedAt && s.tourId === tourId) notes.push(note("decide", "a canceled show is on the tour (left alone)", `${it.date} ${it.text}`));
        }
      }
    }

    // Money: income on the tour's shows gets the tour and the show's entry.
    let incomeCents = 0, expenses = 0, payouts = 0;
    for (const it of plan.items) {
      if (it.kind !== "show") continue;
      const show = shows.get(it.showId), entryId = show && entryOfShow.get(show.id);
      if (!show || !entryId) continue;
      const on = async (coll: string) => (await w.query(coll, (q) => q.where("showId", "==", show.id), { pending: true })).filter((d) => d.showId === show.id && !d.deletedAt);
      let total = 0;
      for (const d of await on("income")) {
        total += d.amount as number;
        if (d.tourId === tourId && d.tourEntryId === entryId) { rows.push({ collection: "income", action: "unchanged" }); continue; }
        await w.update("income", d.id, { tourId, tourEntryId: entryId });
        rows.push({ collection: "income", action: "tagged" });
      }
      expenses += (await on("expenses")).length;
      payouts += (await on("payouts")).length;
      incomeCents += total;
      // Played income vs the sheet's guess: information, not a decision, so it goes on the show's line.
      const line = lines.find((l) => l.date === it.date && l.text.startsWith(`show ${showName(show as never)}`));
      if (line) line.text += `: income ${formatCents(total)}, sheet Estimate ${formatCents(it.estimateCents)}`;
    }
    // Spending in the tour's dates that isn't on the tour: Jeff decides which belongs.
    const inDates = (await w.query("expenses", (q) => q.where("date", ">=", plan.startDate).where("date", "<=", plan.endDate))).filter((x) => !x.deletedAt && !x.tourId);
    for (const x of inDates) notes.push(note("decide", "expense in the tour's dates, not on the tour", `${x.date} ${x.category}`, `${formatCents(x.amount as number)}: ${x.what}`));
    return { incomeCents, expenses, payouts, shows: shows.size };
  }, o.dryRun ? { dryRun: true, overlay: overlay as never } : {});

  lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)); // stable: keeps plan order within a day
  return { dryRun: o.dryRun, runId: ctx.runId ?? newRunId(), tourId, plan, source: `${Math.max(0, o.values.length - 1)} rows of the FINAL tab`, lines, rows, notes, ...report };
}

const dayName = (d: string) => `${d} ${new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}`;

export function octoberTourSurvey(r: OctoberTourReport): Survey {
  const skipped = r.plan.skipped.map((s) => note("deferred", "sheet row skipped", `row ${s.row}${s.date ? ` ${s.date}` : ""}`, s.why));
  return {
    title: "October tour", project: process.env.GCLOUD_PROJECT ?? "", dryRun: r.dryRun, runId: r.runId, source: r.source,
    clean: tally(r.rows), notes: [...r.notes, ...skipped],
    totals: {
      "Income on the tour": formatCents(r.incomeCents), "Sheet's Estimate": formatCents(r.plan.estimateCents),
      "Shows on the tour": r.shows, "Expenses / payouts on those shows": `${r.expenses} / ${r.payouts}`,
    },
  };
}

/** The plan day by day (+ new, = already there, ! couldn't), then the survey. */
export function formatOctoberTour(r: OctoberTourReport): string {
  const out: string[] = [`${r.plan.name}, ${r.plan.startDate} to ${r.plan.endDate}, leaving from ${r.plan.leavingFrom}`];
  for (const date of [...new Set(r.lines.map((l) => l.date))]) {
    out.push(dayName(date));
    for (const l of r.lines.filter((x) => x.date === date)) out.push(`  ${l.mark} ${l.text}`);
  }
  return [...out, "", formatSurvey(octoberTourSurvey(r))].join("\n");
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const valuesPath = arg("values") ?? ".booking-kit/raw/october-tour-final.values.json";
  const payload = JSON.parse(readFileSync(valuesPath, "utf8")) as { values?: unknown[][] };
  if (!Array.isArray(payload.values)) throw new Error(`${valuesPath} has no "values" array`);
  const aliasPath = arg("aliases") ?? ".booking-kit/october-tour-aliases.json";
  const aliases = existsSync(aliasPath) ? (JSON.parse(readFileSync(aliasPath, "utf8")) as Aliases) : {};
  console.log(formatOctoberTour(await importOctoberTour({ dryRun: flag("dry-run"), values: payload.values, aliases, year: arg("year") ?? "2025" })));
}

if (process.argv[1]?.endsWith("import-october-tour.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
