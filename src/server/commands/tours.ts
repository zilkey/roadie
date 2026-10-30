import { z } from "zod";
import { defineCommand } from "./types";
import { db, run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { route } from "../gas/route";
import { syncShow } from "../showSync";
import { BAND_TIME_ZONE, dateInBandZone } from "@/lib/timezone";
import { showCity, showName } from "@/lib/shows";
import { sortedDates } from "@/lib/booking";
import type { ExpenseLike, IncomeLike, PayoutLike } from "@/lib/money";
import { byPosition, dayLabel, slotIn, tourByDay, tourDays, tourTotals, tourWarnings, type EntryLike, type ShowFacts, type TourLike } from "@/lib/tours";
import { dateStr, timeStr, geoPoint, tourStatus, entryVisibility } from "@/schema";
import { artistFor, requireOpenProject } from "./projects";
import { createShow, ShowCreateIn } from "./shows";
import { flagPitch } from "./booking";

// Tours (#11, #41): a tour is a tag, not a project. Shows, pitches and money carry tourId; a tour's numbers are the records
// with its tourId, whatever their project, and the same money still counts on its project. Tour.projectId is only where money
// added from the tour starts ("Money goes to"). The tour's days are its entries (tours/{id}/entries): shows, options (one per
// date a pitch offers, or one undated in the "No date yet" bucket), drives, stays and notes. Shows and pitches stay the source
// of truth: putting one on a tour sets tourId and writes its entry in the same transaction.
// Members read the tour and its band entries only (never options, never money); admins write.

const id1 = z.string().min(1);
const BAND = ["admin", "member", "mcp"] as const;
const ADMIN = ["admin", "mcp"] as const;
const MONEY = ["income", "expenses", "payouts"] as const;
export const entriesPath = (tourId: string) => `tours/${tourId}/entries`;
const todayOf = (ctx: Ctx) => dateInBandZone(ctx.now ?? new Date());
const seesAll = (ctx: Ctx) => ctx.role !== "member";

// ---------- helpers ----------

async function requireTour(w: Writer, id: string): Promise<Doc> {
  const t = await w.get("tours", id);
  if (!t || t.deletedAt || (w.ctx.artistId && t.artistId !== w.ctx.artistId)) throw new AppError("not_found", "Tour not found", 404);
  return t;
}
/** The tour's live entries. `pending` also sees entries this run has just written (they come unfiltered, so the tour's own path is all there is). */
export const liveEntries = (w: Writer, tourId: string, pending = true) => w.query(entriesPath(tourId), undefined, { pending });
async function requireEntry(w: Writer, tourId: string, id: string): Promise<Doc> {
  const e = await w.get(entriesPath(tourId), id);
  if (!e || e.deletedAt) throw new AppError("not_found", "That isn't on the tour", 404);
  return e;
}
/** Money pinned to one entry: the entry must be on that tour (the same check as a release track on its project). */
export async function requireEntryOnTour(w: Writer, tourId: string | undefined, entryId: string): Promise<Doc> {
  if (!tourId) throw new AppError("invalid_input", "Say which tour (tourId) the entry is on", 400);
  await requireTour(w, tourId);
  return requireEntry(w, tourId, entryId);
}
/** A live tour for money to point at. */
export async function requireTourFor(w: Writer, tourId: string): Promise<Doc> { return requireTour(w, tourId); }

async function liveShow(w: Writer, id: string) {
  const s = await w.get("shows", id);
  if (!s || s.deletedAt || (w.ctx.artistId && s.artistId && s.artistId !== w.ctx.artistId)) throw new AppError("not_found", "Show not found", 404);
  return s;
}
async function livePitch(w: Writer, id: string) {
  const p = await w.get("pitches", id);
  if (!p || p.deletedAt || (w.ctx.artistId && p.artistId !== w.ctx.artistId)) throw new AppError("not_found", "Pitch not found", 404);
  return p;
}
/** The show's room's time zone when it has one, else the band's. */
async function tzOfShow(w: Writer, show: Doc): Promise<string> {
  const venueId = (show.venue as { id?: string } | undefined)?.id;
  const v = venueId ? await w.get("venues", venueId) : null;
  return (v?.timeZone as string | undefined) ?? BAND_TIME_ZONE;
}
/** End of `date` in the tour, after `after` / before `before` when given. */
export async function positionOn(w: Writer, tourId: string, date: string | undefined, o: { after?: string; before?: string; skip?: string } = {}) {
  const day = (await liveEntries(w, tourId)).filter((e) => (e.date ?? undefined) === date && e.id !== o.skip) as (Doc & { position: number })[];
  const p = slotIn(day, o);
  if (p === null) throw new AppError("invalid_input", "after / before must be entries on that day", 400);
  return p;
}

/** Records with this showId (live, including ones this run just wrote). */
async function moneyOfShow(w: Writer, coll: (typeof MONEY)[number], showId: string) {
  return (await w.query(coll, (q) => q.where("showId", "==", showId), { pending: true })).filter((d) => d.showId === showId);
}

/** Put a show on the tour: tourId on the show and its money (projects untouched), and a show entry on its date. Moves it off another tour first. */
export async function addShowTo(w: Writer, tour: Doc, show: Doc): Promise<{ entryId: string; existing: boolean }> {
  if (show.tourId === tour.id) {
    const have = (await liveEntries(w, tour.id)).find((e) => e.kind === "show" && e.showId === show.id);
    if (have) return { entryId: have.id, existing: true };
  } else if (show.tourId) {
    const other = await w.get("tours", show.tourId as string);
    if (other && !other.deletedAt) await removeShowFrom(w, other.id, show);
  }
  await w.update("shows", show.id, { tourId: tour.id });
  for (const coll of MONEY) {
    for (const d of await moneyOfShow(w, coll, show.id)) if (d.tourId !== tour.id) await w.update(coll, d.id, { tourId: tour.id, tourEntryId: null });
  }
  const r = await w.create(entriesPath(tour.id), {
    tourId: tour.id, kind: "show", date: show.date, position: await positionOn(w, tour.id, show.date as string), visibility: "band", tz: await tzOfShow(w, show), showId: show.id,
  });
  return { entryId: r.id, existing: false };
}

/** Take a show off the tour: its entries go, tourId comes off the show and its money (only money tagged with this tour), and money pinned to those entries becomes the whole tour's. */
async function removeShowFrom(w: Writer, tourId: string, show: Doc) {
  const gone = (await liveEntries(w, tourId)).filter((e) => e.kind === "show" && e.showId === show.id);
  for (const e of gone) await w.softDelete(entriesPath(tourId), e.id);
  if (show.tourId === tourId) await w.update("shows", show.id, { tourId: null });
  for (const coll of MONEY) {
    for (const d of await moneyOfShow(w, coll, show.id)) if (d.tourId === tourId) await w.update(coll, d.id, { tourId: null, tourEntryId: null });
  }
  await unpin(w, gone.map((e) => e.id));
}
/** Money pinned to entries that are going: back to the whole tour. */
async function unpin(w: Writer, entryIds: string[]) {
  for (const eid of entryIds) {
    for (const coll of MONEY) {
      for (const d of await w.query(coll, (q) => q.where("tourEntryId", "==", eid))) await w.update(coll, d.id, { tourEntryId: null });
    }
  }
}

/** Put a pitch on the tour: tourId on the pitch (with any new dates merged in) and one option entry per date, or one undated entry in the bucket. */
async function addPitchTo(w: Writer, tour: Doc, pitch: Doc, more: string[] = []): Promise<{ entryIds: string[] }> {
  const dates = sortedDates([...((pitch.dates as string[] | undefined) ?? []), ...more]);
  const patch: Record<string, unknown> = {};
  if (pitch.tourId !== tour.id) patch.tourId = tour.id;
  if (JSON.stringify(dates) !== JSON.stringify(pitch.dates ?? [])) patch.dates = dates;
  if (Object.keys(patch).length) await w.update("pitches", pitch.id, patch);
  // A pitch on another tour leaves it: one pitch, one tour.
  if (pitch.tourId && pitch.tourId !== tour.id) {
    const old = (await liveEntries(w, pitch.tourId as string)).filter((e) => e.kind === "option" && e.pitchId === pitch.id);
    for (const e of old) await w.softDelete(entriesPath(pitch.tourId as string), e.id);
  }
  const mine = (await liveEntries(w, tour.id)).filter((e) => e.kind === "option" && e.pitchId === pitch.id);
  const ids: string[] = [];
  // The bucket entry takes the first new date (same id); the rest are new entries.
  let bucket = mine.find((e) => !e.date);
  for (const date of dates) {
    const have = mine.find((e) => e.date === date);
    if (have) { ids.push(have.id); continue; }
    const position = await positionOn(w, tour.id, date);
    if (bucket) { await w.update(entriesPath(tour.id), bucket.id, { date, position }); ids.push(bucket.id); bucket = undefined; continue; }
    ids.push((await w.create(entriesPath(tour.id), { tourId: tour.id, kind: "option", date, position, visibility: "admins", tz: BAND_TIME_ZONE, pitchId: pitch.id })).id);
  }
  if (!dates.length) {
    if (bucket) ids.push(bucket.id);
    else ids.push((await w.create(entriesPath(tour.id), { tourId: tour.id, kind: "option", position: await positionOn(w, tour.id, undefined), visibility: "admins", tz: BAND_TIME_ZONE, pitchId: pitch.id })).id);
  }
  return { entryIds: ids };
}

/** Take a pitch off the tour: its option entries go and tourId comes off. Its dates stay on the pitch. */
async function removePitchFrom(w: Writer, tourId: string, pitch: Doc) {
  const gone = (await liveEntries(w, tourId)).filter((e) => e.kind === "option" && e.pitchId === pitch.id);
  for (const e of gone) await w.softDelete(entriesPath(tourId), e.id);
  if (pitch.tourId === tourId) await w.update("pitches", pitch.id, { tourId: null });
}

/** One option goes: its date comes off the pitch, and a pitch with no options left leaves the tour (`bucket`: waits in No date yet instead). `nextStep` asks someone to tell them. */
async function dropOption(w: Writer, tourId: string, entry: Doc, o: { nextStep?: { text: string; due: string }; bucket?: boolean } = {}) {
  await w.softDelete(entriesPath(tourId), entry.id);
  const pitch = await w.get("pitches", entry.pitchId as string);
  if (!pitch || pitch.deletedAt) return;
  const patch: Record<string, unknown> = {};
  if (entry.date && ((pitch.dates as string[] | undefined) ?? []).includes(entry.date as string)) patch.dates = (pitch.dates as string[]).filter((d) => d !== entry.date);
  const left = (await liveEntries(w, tourId)).filter((e) => e.kind === "option" && e.pitchId === pitch.id && e.id !== entry.id);
  if (!left.length && pitch.tourId === tourId) {
    if (o.bucket) await w.create(entriesPath(tourId), { tourId, kind: "option", position: await positionOn(w, tourId, undefined), visibility: "admins", tz: BAND_TIME_ZONE, pitchId: pitch.id });
    else patch.tourId = null;
  }
  if (o.nextStep) patch.nextStep = o.nextStep;
  if (Object.keys(patch).length) await w.update("pitches", pitch.id, patch);
}

/** Miles and minutes for a drive, from ORS behind routeCache. Outside any transaction (it writes the cache); blank when ORS can't say. */
export async function driveFacts(from?: { lat: number; lng: number } | null, to?: { lat: number; lng: number } | null): Promise<{ miles: number | null; minutes: number | null }> {
  if (!from || !to) return { miles: null, minutes: null };
  try {
    const r = await route(from, to, { needMinutes: true });
    return { miles: Math.round(r.oneWayMiles * 10) / 10, minutes: r.minutes === undefined ? null : Math.round(r.minutes) };
  } catch { return { miles: null, minutes: null }; }
}

// ---------- reads ----------

async function artistIdFor(ctx: Ctx): Promise<string | undefined> {
  return ctx.artistId ?? (await db.list("artists", (q) => q.limit(1)))[0]?.id;
}
async function readTour(ctx: Ctx, id: string): Promise<Doc> {
  const t = await db.get("tours", id);
  if (!t || t.deletedAt || (ctx.artistId && t.artistId !== ctx.artistId)) throw new AppError("not_found", "Tour not found", 404);
  return t;
}
/** The entries the caller may read: everything for admins, the band's entries for members (the same filter the rules ask of them). */
async function readEntries(ctx: Ctx, tourId: string): Promise<Doc[]> {
  return db.list(entriesPath(tourId), seesAll(ctx) ? undefined : (q) => q.where("visibility", "==", "band"));
}
async function tourMoney(tourId: string) {
  const [income, expenses, payouts] = await Promise.all(MONEY.map((c) => db.list(c, (q) => q.where("tourId", "==", tourId))));
  return { income: income as unknown as IncomeLike[], expenses: expenses as unknown as ExpenseLike[], payouts: payouts as unknown as PayoutLike[] };
}
async function showsOf(entries: Doc[]): Promise<Map<string, Doc>> {
  const ids = [...new Set(entries.filter((e) => e.showId).map((e) => e.showId as string))];
  const docs = await Promise.all(ids.map((x) => db.get("shows", x)));
  return new Map(docs.filter((d): d is Doc => !!d && !d.deletedAt).map((d) => [d.id, d]));
}
const factsOf = (shows: Map<string, Doc>) => new Map<string, ShowFacts>([...shows].map(([k, s]) => [k, { date: s.date, name: showName(s as never), loadIn: s.times?.loadIn }]));

/** A line for an entry, as the plan reads: the show, the option's venue, "Drive to Salt Lake City", the stay's name, the note. */
function labelOf(e: Doc, shows: Map<string, Doc>, pitches: Map<string, Doc>): string {
  if (e.kind === "show") { const s = shows.get(e.showId); return s ? [showName(s as never), showCity(s as never)].filter(Boolean).join(", ") : "Show"; }
  if (e.kind === "option") return `Option: ${(pitches.get(e.pitchId)?.target as { name?: string } | undefined)?.name ?? "a pitch"}`;
  if (e.kind === "drive") return e.to ? `Drive to ${e.to.name ?? e.to.address}` : "Drive";
  if (e.kind === "stay") return e.name ?? "Stay";
  return e.text ?? "Note";
}

export const toursList = defineCommand({
  name: "tours.list", roles: [...BAND],
  description: "The band's tours, soonest first: id, name, status (idea|planning|booked|done), startDate / endDate (optional), projectId (where new money from the tour starts), and counts (days, shows, options, drives, stays, warnings). " +
    "Admins also get totals (cents, records tagged with the tour whatever their project: inReceived, inOwed, outPaid, outOwed, net, netIfSettled, expected for shows not played yet). Members get no options and no money.",
  input: z.strictObject({ status: tourStatus.optional() }),
  async run(ctx, i) {
    const artistId = await artistIdFor(ctx);
    const today = todayOf(ctx);
    const tours = (await db.list("tours", artistId ? (q) => q.where("artistId", "==", artistId) : undefined)).filter((t) => !i.status || t.status === i.status);
    const rows = await Promise.all(tours.map(async (t) => {
      const entries = await readEntries(ctx, t.id);
      const shows = await showsOf(entries);
      const { days } = tourDays(t as TourLike, entries as unknown as EntryLike[]);
      const n = (k: string) => entries.filter((e) => e.kind === k).length;
      const warnings = tourWarnings(t as TourLike, entries as unknown as EntryLike[], factsOf(shows)).filter((x) => seesAll(ctx) || x.kind !== "openDate");
      return {
        id: t.id, name: t.name, status: t.status, startDate: t.startDate ?? null, endDate: t.endDate ?? null, projectId: t.projectId,
        counts: { days: days.length, shows: n("show"), ...(seesAll(ctx) ? { options: n("option") } : {}), drives: n("drive"), stays: n("stay"), warnings: warnings.length },
        ...(seesAll(ctx) ? { totals: tourTotals(await tourMoney(t.id), today) } : {}),
      };
    }));
    return { tours: rows.sort((a, b) => (a.startDate ?? "9999") < (b.startDate ?? "9999") ? -1 : 1) };
  },
});

export const toursGet = defineCommand({
  name: "tours.get", roles: [...BAND],
  description: "One tour (id from tours.list) and its entries in day order: kind (show|option|drive|stay|note), date (none = the \"No date yet\" bucket, options only), position, showId / pitchId, the drive's from, to, leaveBy, roundTrip, miles and minutes, the stay's name, address, nights and checkIn, the note's text, with a label for each. " +
    "Members get the band's entries only (no options).",
  input: z.strictObject({ id: id1 }),
  async run(ctx, { id }) {
    const tour = await readTour(ctx, id);
    const entries = await readEntries(ctx, id);
    const shows = await showsOf(entries);
    const pitches = new Map(seesAll(ctx) ? (await Promise.all([...new Set(entries.filter((e) => e.pitchId).map((e) => e.pitchId as string))].map((p) => db.get("pitches", p)))).filter((p): p is Doc => !!p).map((p) => [p.id, p]) : []);
    const sorted = [...entries].sort((a, b) => ((a.date ?? "") < (b.date ?? "") ? -1 : (a.date ?? "") > (b.date ?? "") ? 1 : a.position - b.position));
    return { tour, entries: sorted.map((e) => ({ ...e, label: labelOf(e, shows, pitches) })) };
  },
});

export const toursSummary = defineCommand({
  name: "tours.summary", roles: [...BAND],
  description: "How a tour is doing (\"how's the tour doing?\"): days (every date it covers, each with its entries in order), the bucket of undated options, and warnings, worked out fresh: " +
    "noStay (a night with no stay), openDate (a day with nothing booked or pitched), longDrive (over 5 h), lateArrival (leaving at leaveBy gets in after a show's load in), outsideDates (an entry outside the tour's dates). " +
    "Admins also get totals in cents over the records tagged with the tour (inReceived / inOwed / outPaid / outOwed / net / netIfSettled; shows not played yet are only in expected) and byDay (the same per day: an entry's date for money pinned to one; money not pinned to an entry is the Whole tour row, date null). Members get no options and no money.",
  input: z.strictObject({ id: id1 }),
  async run(ctx, { id }) {
    const tour = await readTour(ctx, id);
    const entries = await readEntries(ctx, id);
    const shows = await showsOf(entries);
    const pitches = new Map(seesAll(ctx) ? (await Promise.all([...new Set(entries.filter((e) => e.pitchId).map((e) => e.pitchId as string))].map((p) => db.get("pitches", p)))).filter((p): p is Doc => !!p).map((p) => [p.id, p]) : []);
    const { days, bucket } = tourDays(tour as TourLike, entries as unknown as (EntryLike & Doc)[]);
    const line = (e: Doc) => ({ id: e.id, kind: e.kind, label: labelOf(e, shows, pitches), ...(e.showId ? { showId: e.showId } : {}), ...(e.pitchId ? { pitchId: e.pitchId } : {}), ...(e.leaveBy ? { leaveBy: e.leaveBy } : {}), ...(e.minutes !== undefined ? { minutes: e.minutes, miles: e.miles } : {}) });
    const warnings = tourWarnings(tour as TourLike, entries as unknown as EntryLike[], factsOf(shows)).filter((x) => seesAll(ctx) || x.kind !== "openDate");
    const out = {
      tour: { id: tour.id, name: tour.name, status: tour.status, startDate: tour.startDate ?? null, endDate: tour.endDate ?? null, projectId: tour.projectId },
      days: days.map((d) => ({ date: d.date, label: dayLabel(d.date), entries: d.entries.map(line) })),
      ...(seesAll(ctx) ? { bucket: bucket.map(line) } : {}),
      warnings,
    };
    if (!seesAll(ctx)) return out;
    const today = todayOf(ctx);
    const money = await tourMoney(id);
    const entryDate = new Map(entries.map((e) => [e.id, e.date as string | undefined]));
    return {
      ...out,
      totals: tourTotals(money, today),
      byDay: tourByDay(money, entryDate, today),
    };
  },
});

// ---------- the tour ----------

const TourFields = {
  name: z.string().trim().min(1), status: tourStatus.optional(), startDate: dateStr.optional(), endDate: dateStr.optional(), leavingFrom: geoPoint.optional(),
  billedAs: id1.optional(), personnel: z.array(id1).optional(), notes: z.string().trim().min(1).optional(),
};
function configOf(artist: Doc, billedAs?: string) {
  if (!billedAs) return undefined;
  const c = ((artist.configurations ?? []) as { id: string; musicianIds?: string[] }[]).find((x) => x.id === billedAs);
  if (!c) throw new AppError("invalid_input", `No configuration "${billedAs}"`, 400);
  return c;
}

export const toursCreate = defineCommand({
  name: "tours.create", roles: [...ADMIN],
  description: "Start a tour: name, projectId (\"Money goes to\": an existing OPEN project from context.now projects, usually Duo or Band; money added from the tour starts there; a tour never makes a project), status (idea|planning|booked|done, default planning), " +
    "startDate / endDate (optional, YYYY-MM-DD; only used for warnings), leavingFrom (a town from geo.autocomplete: { name?, address, lat, lng }), billedAs (a configuration id; fills personnel), personnel (musician ids), notes. " +
    "pitchIds and showIds put those pitches (one option per offered date) and shows on it in the same step. Returns { id, entryIds }.",
  input: z.strictObject({ ...TourFields, projectId: id1, pitchIds: z.array(id1).default([]), showIds: z.array(id1).default([]) }),
  run: (ctx, { pitchIds, showIds, ...i }) => run(ctx, async (w) => {
    const artist = await artistFor(w);
    const project = await requireOpenProject(w, i.projectId);
    if (project.artistId && project.artistId !== artist.id) throw new AppError("not_found", "Project not found", 404);
    const cfg = configOf(artist, i.billedAs);
    const r = await w.create("tours", { ...i, artistId: artist.id, status: i.status ?? "planning", personnel: i.personnel ?? cfg?.musicianIds ?? [] });
    const tour = (await w.get("tours", r.id))!;
    const entryIds: string[] = [];
    for (const s of showIds) entryIds.push((await addShowTo(w, tour, await liveShow(w, s))).entryId);
    for (const p of pitchIds) entryIds.push(...(await addPitchTo(w, tour, await livePitch(w, p))).entryIds);
    return { id: r.id, entryIds };
  }),
});

export const toursUpdate = defineCommand({
  name: "tours.update", roles: [...ADMIN],
  description: "Edit a tour (id from tours.list): name, status (idea|planning|booked|done), startDate / endDate / leavingFrom / billedAs / notes (null clears), personnel (the whole list), projectId (\"Money goes to\", an open project; money already recorded stays where it is).",
  input: z.strictObject({ id: id1, patch: z.strictObject({
    name: z.string().trim().min(1).optional(), status: tourStatus.optional(), startDate: dateStr.nullable().optional(), endDate: dateStr.nullable().optional(),
    leavingFrom: geoPoint.nullable().optional(), billedAs: id1.nullable().optional(), personnel: z.array(id1).optional(), projectId: id1.optional(), notes: z.string().trim().nullable().optional(),
  }) }),
  run: (ctx, { id, patch }) => run(ctx, async (w) => {
    await requireTour(w, id);
    if (patch.projectId) await requireOpenProject(w, patch.projectId);
    if (patch.billedAs) configOf(await artistFor(w), patch.billedAs);
    return w.update("tours", id, { ...patch, ...(patch.notes === "" ? { notes: null } : {}) });
  }),
});

export const toursRemove = defineCommand({
  name: "tours.remove", roles: [...ADMIN],
  description: "Archive (or cancel) a tour: tourId comes off its shows, pitches and money (their projects don't change) and its own entries go. The shows and pitches themselves stay.",
  input: z.strictObject({ id: id1 }),
  run: (ctx, { id }) => run(ctx, async (w) => {
    await requireTour(w, id);
    for (const e of await liveEntries(w, id, false)) await w.softDelete(entriesPath(id), e.id);
    for (const coll of ["shows", "pitches", ...MONEY]) {
      for (const d of await w.query(coll, (q) => q.where("tourId", "==", id))) {
        await w.update(coll, d.id, { tourId: null, ...(MONEY.includes(coll as never) ? { tourEntryId: null } : {}) });
      }
    }
    return w.softDelete("tours", id);
  }),
});

export const toursAddShow = defineCommand({
  name: "tours.addShow", roles: [...ADMIN],
  description: "Put a show on a tour (\"put the Kilby show on Mountain West\": showId from shows.list or search, tourId from tours.list): sets tourId on the show and on its income, expenses and payouts (their project stays), and adds a show entry on its date. " +
    "A show on another tour moves. Returns { entryId, existing }.",
  input: z.strictObject({ tourId: id1, showId: id1 }),
  run: (ctx, i) => run(ctx, async (w) => addShowTo(w, await requireTour(w, i.tourId), await liveShow(w, i.showId))),
});

export const toursAddPitch = defineCommand({
  name: "tours.addPitch", roles: [...ADMIN],
  description: "Put a pitch on a tour as options (\"add Velour for the 9th or 10th\"): pitchId (from search), or venueId (from search) to use the band's open pitch for that venue, flagging it onto the Pitch List if there is none. " +
    "dates [YYYY-MM-DD, ...] are added to the pitch's possible dates. One option entry per date on the pitch; a pitch with no dates sits in the \"No date yet\" bucket. Options are admins only. Returns { pitchId, entryIds }.",
  input: z.strictObject({ tourId: id1, pitchId: id1.optional(), venueId: id1.optional(), dates: z.array(dateStr).default([]) })
    .refine((v) => !!v.pitchId !== !!v.venueId, "Give pitchId or venueId"),
  run: (ctx, i) => run(ctx, async (w) => {
    const tour = await requireTour(w, i.tourId);
    const pitchId = i.pitchId ?? (await flagPitch(w, ctx, { kind: "venue", id: i.venueId! })).id;
    const pitch = await w.get("pitches", pitchId);
    if (!pitch || pitch.deletedAt || (ctx.artistId && pitch.artistId !== ctx.artistId)) throw new AppError("not_found", "Pitch not found", 404);
    return { pitchId, ...(await addPitchTo(w, tour, pitch, i.dates)) };
  }),
});

export const toursRemoveItem = defineCommand({
  name: "tours.removeItem", roles: [...ADMIN],
  description: "Take a show (showId) or a pitch (pitchId) off a tour: the reverse of tours.addShow / tours.addPitch. A show's money loses the tag (its project stays); a pitch keeps its dates.",
  input: z.strictObject({ tourId: id1, showId: id1.optional(), pitchId: id1.optional() }).refine((v) => !!v.showId !== !!v.pitchId, "Give showId or pitchId"),
  run: (ctx, i) => run(ctx, async (w) => {
    await requireTour(w, i.tourId);
    if (i.showId) await removeShowFrom(w, i.tourId, await liveShow(w, i.showId));
    else await removePitchFrom(w, i.tourId, await livePitch(w, i.pitchId!));
    return { tourId: i.tourId };
  }),
});

// ---------- entries: drives, stays, notes ----------

const DriveFields = { from: geoPoint.optional(), to: geoPoint.optional(), leaveBy: timeStr.optional(), roundTrip: z.boolean().optional() };
const StayFields = { name: z.string().trim().min(1).optional(), address: geoPoint.optional(), nights: z.number().int().positive().optional(), checkIn: timeStr.optional() };
const KIND_FIELDS: Record<string, string[]> = { drive: Object.keys(DriveFields), stay: Object.keys(StayFields), note: ["text"], show: [], option: [] };
/** Refuse fields that belong to another kind of entry. */
function onlyKindFields(kind: string, o: Record<string, unknown>) {
  const bad = Object.keys(o).filter((k) => [...KIND_FIELDS.drive, ...KIND_FIELDS.stay, "text"].includes(k) && !KIND_FIELDS[kind].includes(k) && o[k] !== undefined);
  if (bad.length) throw new AppError("invalid_input", `A ${kind} has no ${bad.join(", ")}`, 400);
}

export const toursEntriesAdd = defineCommand({
  name: "tours.entries.add", roles: [...ADMIN],
  description: "Add a drive, stay or note to a tour day (date YYYY-MM-DD). after / before (entry ids from tours.get) put it between two entries; otherwise it goes at the end of the day. " +
    "drive (\"add a drive Saturday at 11\"): from / to (places from geo.autocomplete), leaveBy (HH:MM, local), roundTrip; miles and minutes are filled in from driving directions. " +
    "stay (\"we're camping Sunday\": name \"Camping\"): name (\"Airbnb\", \"The van\"), address, nights (default 1), checkIn (HH:MM). note: text. visibility band (default) or admins; tz (IANA, default the band's). Returns { id, miles?, minutes? }.",
  input: z.strictObject({
    tourId: id1, kind: z.enum(["drive", "stay", "note"]), date: dateStr, after: id1.optional(), before: id1.optional(),
    visibility: entryVisibility.optional(), tz: z.string().min(1).optional(), ...DriveFields, ...StayFields, text: z.string().trim().min(1).optional(),
  }),
  async run(ctx, { tourId, kind, date, after, before, visibility, tz, ...fields }) {
    onlyKindFields(kind, fields);
    if (kind === "note" && !fields.text) throw new AppError("invalid_input", "A note needs text", 400);
    const facts = kind === "drive" ? await driveFacts(fields.from, fields.to) : { miles: null, minutes: null };
    return run(ctx, async (w) => {
      await requireTour(w, tourId);
      const r = await w.create(entriesPath(tourId), {
        ...fields, tourId, kind, date, position: await positionOn(w, tourId, date, { after, before }), visibility: visibility ?? "band", tz: tz ?? BAND_TIME_ZONE,
        ...(facts.miles !== null ? { miles: facts.miles } : {}), ...(facts.minutes !== null ? { minutes: facts.minutes } : {}),
      });
      return { id: r.id, ...(facts.miles !== null ? { miles: facts.miles } : {}), ...(facts.minutes !== null ? { minutes: facts.minutes } : {}) };
    });
  },
});

export const toursEntriesUpdate = defineCommand({
  name: "tours.entries.update", roles: [...ADMIN],
  description: "Change one entry of a tour (id from tours.get): a drive's from / to / leaveBy / roundTrip, a stay's name / address / nights / checkIn, a note's text (null clears), the date (drives, stays and notes), visibility (band|admins), tz. " +
    "A drive whose from, to or date changes gets its miles and minutes again. Options and shows move with tours.entries.move or on the show itself.",
  input: z.strictObject({ tourId: id1, id: id1, patch: z.strictObject({
    date: dateStr.optional(), visibility: entryVisibility.optional(), tz: z.string().min(1).optional(),
    from: geoPoint.nullable().optional(), to: geoPoint.nullable().optional(), leaveBy: timeStr.nullable().optional(), roundTrip: z.boolean().nullable().optional(),
    name: z.string().trim().min(1).nullable().optional(), address: geoPoint.nullable().optional(), nights: z.number().int().positive().nullable().optional(), checkIn: timeStr.nullable().optional(),
    text: z.string().trim().min(1).nullable().optional(),
  }) }),
  async run(ctx, { tourId, id, patch }) {
    const before = await db.get(entriesPath(tourId), id);
    if (!before || before.deletedAt) throw new AppError("not_found", "That isn't on the tour", 404);
    const kind = before.kind as string;
    const { date, visibility, tz, ...fields } = patch;
    onlyKindFields(kind, fields);
    if ((kind === "show" || kind === "option") && (date !== undefined || visibility !== undefined)) {
      throw new AppError("invalid_input", kind === "show" ? "A show's date is the show's: change it on the show" : "Move an option with tours.entries.move; options are always admins only", 400);
    }
    const routeChanged = kind === "drive" && ("from" in fields || "to" in fields || (date !== undefined && date !== before.date));
    const facts = routeChanged ? await driveFacts(fields.from === undefined ? before.from : fields.from, fields.to === undefined ? before.to : fields.to) : null;
    return run(ctx, async (w) => {
      await requireTour(w, tourId);
      const cur = await requireEntry(w, tourId, id);
      const p: Record<string, unknown> = { ...fields };
      if (tz) p.tz = tz;
      if (visibility) p.visibility = visibility;
      if (date !== undefined && date !== cur.date) { p.date = date; p.position = await positionOn(w, tourId, date, { skip: id }); }
      if (facts) Object.assign(p, facts);
      return w.update(entriesPath(tourId), id, p);
    });
  },
});

export const toursEntriesMove = defineCommand({
  name: "tours.entries.move", roles: [...ADMIN],
  description: "Move an entry (drag): to another date and/or between two entries (after / before, entry ids on that day; neither = the end of the day). " +
    "Moving an option to another date changes the pitch's dates too; date null puts an option back in the \"No date yet\" bucket. A show moves with its show, not here.",
  input: z.strictObject({ tourId: id1, id: id1, date: dateStr.nullable().optional(), after: id1.optional(), before: id1.optional() }),
  run: (ctx, i) => run(ctx, async (w) => {
    await requireTour(w, i.tourId);
    const e = await requireEntry(w, i.tourId, i.id);
    const to = i.date === undefined ? (e.date as string | undefined) : i.date ?? undefined;
    if (e.kind === "show" && to !== e.date) throw new AppError("invalid_input", "A show's date is the show's: change it on the show", 400);
    if (!to && e.kind !== "option") throw new AppError("invalid_input", "Only options can go in the No date yet bucket", 400);
    const patch: Record<string, unknown> = { position: await positionOn(w, i.tourId, to, { after: i.after, before: i.before, skip: e.id }) };
    if (to !== e.date) {
      patch.date = to ?? null;
      if (e.kind === "option") {
        const pitch = await livePitch(w, e.pitchId as string);
        const others = (await liveEntries(w, i.tourId)).filter((x) => x.kind === "option" && x.pitchId === pitch.id && x.id !== e.id);
        if (to && others.some((x) => x.date === to)) throw new AppError("invalid_input", "That pitch is already an option on that date", 409);
        const dates = ((pitch.dates as string[] | undefined) ?? []).filter((d) => d !== e.date);
        await w.update("pitches", pitch.id, { dates: sortedDates(to ? [...dates, to] : dates) });
      }
    }
    return w.update(entriesPath(i.tourId), e.id, patch);
  }),
});

export const toursEntriesRemove = defineCommand({
  name: "tours.entries.remove", roles: [...ADMIN],
  description: "Take one entry off a tour. An option drops that date from its pitch (a pitch with no options left leaves the tour); a show entry takes the show off the tour (tours.removeItem). Money pinned to the entry becomes the whole tour's.",
  input: z.strictObject({ tourId: id1, id: id1 }),
  run: (ctx, i) => run(ctx, async (w) => {
    await requireTour(w, i.tourId);
    const e = await requireEntry(w, i.tourId, i.id);
    if (e.kind === "show") { await removeShowFrom(w, i.tourId, await liveShow(w, e.showId as string)); return { id: e.id, changed: true }; }
    if (e.kind === "option") await dropOption(w, i.tourId, e);
    else await w.softDelete(entriesPath(i.tourId), e.id);
    await unpin(w, [e.id]);
    return { id: e.id, changed: true };
  }),
});

// ---------- booking an option ----------

const OtherChoice = z.enum(["drop", "keep", "tellBooked"]);

export const toursBook = defineCommand({
  name: "tours.book", roles: [...ADMIN],
  description: "Book an option on a tour (entryId: an option entry from tours.get; date: the date it's booked for, YYYY-MM-DD): books the pitch the way shows.create with pitchId does (the show, its deal, the pitch booked), " +
    "puts the show on the tour, and the option entry becomes the show's entry (same id). The pitch's other dates go. others decides the other options that day: keep (default), drop (their date comes off; a pitch left with no options waits in No date yet), " +
    "or tellBooked (dropped, and their pitch gets a next step to tell them we're booked); give one of those for all of them, or { [pitchId]: choice } per pitch (pitches left out are kept). addStay adds a stay after the show that night. Returns { showId, entryId, dropped }.",
  input: z.strictObject({ tourId: id1, entryId: id1, date: dateStr, others: z.union([OtherChoice, z.record(id1, OtherChoice)]).default("keep"), addStay: z.boolean().default(false) }),
  async run(ctx, i) {
    const out = await run(ctx, async (w) => {
      const tour = await requireTour(w, i.tourId);
      const e = await requireEntry(w, i.tourId, i.entryId);
      if (e.kind !== "option") throw new AppError("invalid_input", "Only an option can be booked", 400);
      const pitch = await livePitch(w, e.pitchId as string);
      const target = pitch.target as { kind: string; id: string };
      const all = await liveEntries(w, i.tourId);
      const showId = await createShow(w, ctx, ShowCreateIn.parse({
        pitchId: pitch.id, date: i.date,
        ...(target.kind === "venue" ? { venueId: target.id } : target.kind === "edition" ? { editionId: target.id } : {}),
        ...(tour.billedAs ? { billedAs: tour.billedAs } : {}), ...((tour.personnel as string[] | undefined)?.length ? { personnel: tour.personnel } : {}),
      }));
      const show = (await w.get("shows", showId))!;
      await w.update("shows", showId, { tourId: tour.id });
      for (const coll of MONEY) for (const d of await moneyOfShow(w, coll, showId)) await w.update(coll, d.id, { tourId: tour.id });
      await w.update(entriesPath(i.tourId), e.id, {
        kind: "show", showId, pitchId: null, date: i.date, visibility: "band", tz: await tzOfShow(w, show),
        ...(i.date !== e.date ? { position: await positionOn(w, i.tourId, i.date, { skip: e.id }) } : {}),
      });
      for (const x of all.filter((x) => x.kind === "option" && x.pitchId === pitch.id && x.id !== e.id)) await w.softDelete(entriesPath(i.tourId), x.id);
      await w.update("pitches", pitch.id, { dates: [i.date] });
      const dropped: string[] = [];
      for (const x of all.filter((x) => x.kind === "option" && x.date === i.date && x.pitchId !== pitch.id)) {
        const choice = typeof i.others === "string" ? i.others : i.others[x.pitchId as string] ?? "keep";
        if (choice === "keep") continue;
        await dropOption(w, i.tourId, x, choice === "tellBooked" ? { nextStep: { text: `Tell them we're booked on ${dayLabel(i.date)}`, due: todayOf(ctx) } } : { bucket: true });
        dropped.push(x.pitchId as string);
      }
      if (i.addStay) {
        const day = byPosition(all.filter((x) => x.date === i.date && x.id !== e.id) as (Doc & { position: number })[]);
        const after = Math.max(e.position as number, ...day.map((x) => x.position));
        await w.create(entriesPath(i.tourId), { tourId: tour.id, kind: "stay", date: i.date, position: after + 1, visibility: "band", tz: await tzOfShow(w, show), nights: 1 });
      }
      return { showId, entryId: e.id, dropped };
    });
    const sync = await syncShow(ctx, out.showId);
    return { ...out, warnings: sync.warnings };
  },
});

export const tourCommands = [
  toursList, toursGet, toursSummary, toursCreate, toursUpdate, toursRemove, toursAddShow, toursAddPitch, toursRemoveItem,
  toursEntriesAdd, toursEntriesUpdate, toursEntriesMove, toursEntriesRemove, toursBook,
];
