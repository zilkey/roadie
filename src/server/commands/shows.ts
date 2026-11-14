import { ensureBandsintownItem } from "../bandsintown";
import { randomUUID } from "node:crypto";
import { dateInBandZone } from "@/lib/timezone";
import { z } from "zod";
import { defineCommand } from "./types";
import { idInput } from "./util";
import { db, run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { calendarLink, calendarPreview, calendarRemove, calendarSend, deleteEvent } from "../calendarSync";
import { noteOf, requireContact, setContactRoles } from "../venues";
import { dayOfContactOf } from "@/lib/venues";
import { addDays, calendarInvitees, isOff, joinNames, showCity, showFilter, showName, SHOW_FILTERS, type ArtistLike, type ChecklistItem, type ChecklistLike } from "@/lib/shows";
import { dateStr, timeStr, sound as soundSchema, cents, showKind, ShowFanPage } from "@/schema";
import { defaultProjectIdFor, requireOpenProject } from "./projects";
import { refreshDealTotals } from "../dealTotals";
import { checklistCommands } from "./checklists";

const newId = () => randomUUID().slice(0, 8);
const todayServer = () => dateInBandZone();

const times = z.strictObject({
  loadIn: timeStr.optional(), soundcheck: timeStr.optional(), doors: timeStr.optional(), showStart: timeStr.optional(), set: timeStr.optional(),
  setLengthSec: z.number().int().min(1).optional(),
});
const needs = z.strictObject({ poster: z.boolean(), backline: z.boolean(), merch: z.boolean() });
const dayOfContact = z.strictObject({ name: z.string().trim().min(1), phone: z.string().trim().optional(), contactId: z.string().min(1).optional() });

// ---------- helpers ----------

async function requireShow(w: Writer, id: string) {
  const s = await w.get("shows", id);
  if (!s || s.deletedAt) throw new AppError("not_found", "Show not found", 404);
  return s;
}
async function requireVenue(w: Writer, id: string) {
  const v = await w.get("venues", id);
  if (!v || v.deletedAt) throw new AppError("not_found", "Venue not found", 404);
  return v;
}
/** A show's artist: the one given, else the one this call is for (ctx.artistId), else the one artist there is. */
async function artistFor(w: Writer, artistId = w.ctx.artistId): Promise<Doc> {
  const a = artistId ? await w.get("artists", artistId) : (await w.query("artists", (q) => q.limit(1)))[0];
  if (!a || a.deletedAt) throw new AppError("not_found", "Set up the artist first", 404);
  return a;
}
async function requireEdition(w: Writer, id: string) {
  const e = await w.get("editions", id);
  if (!e || e.deletedAt) throw new AppError("not_found", "Festival year not found", 404);
  return e;
}
/** Host contacts -> their ids and the names copy the band can read. */
async function hostsOf(w: Writer, ids: string[]) {
  const names: string[] = [];
  for (const id of ids) {
    names.push((await requireContact(w, id, "Host contact")).name as string);
  }
  return { hostContactIds: ids, hostName: joinNames(names) || undefined };
}
const place = z.strictObject({ city: z.string().trim().min(1), address: z.string().trim().optional() });
const NO_PLACE = "Choose a venue (or a festival year, venue TBD), or give the city for a house concert";
export const editionLabel = (e: Doc) => `${e.festivalName} ${e.label}`;
const venueCopy = (v: Doc) => ({
  id: v.id, name: v.name as string, address: [v.address?.street, v.address?.city].filter(Boolean).join(", "), city: v.address?.city as string | undefined,
});
function configOf(artist: Doc, billedAs?: string | null) {
  if (!billedAs) return undefined;
  const c = (artist.configurations as ArtistLike["configurations"]).find((x) => x.id === billedAs);
  if (!c) throw new AppError("invalid_input", `No configuration "${billedAs}"`, 400);
  return c;
}
const done = (id: string) => ({ id, warnings: [] as string[] });

// ---------- list ----------

export const showsList = defineCommand({
  name: "shows.list", roles: ["admin", "mcp"],
  description:
    "List shows by filter: upcoming, played (or confirmed with the date passed), canceled (they called it off), or dropped (we pulled out, or a hold whose date passed unconfirmed). " +
    "Optional narrowing: venueId, from / to (YYYY-MM-DD, inclusive, on the show date), city (case-insensitive exact match). " +
    "Rows carry reason (why it was canceled or dropped) when one was given, and totals {income, paidOut, expenses, net} in cents when the show has a deal with money entered (net = income - paidOut - expenses; owed amounts count). " +
    "'What did we make this year?' = filter played + from/to, then sum totals.net. " +
    "counts has every filter's number under the venueId/from/to/city narrowing but ignores filter, so 'how many shows were canceled?' is one call. Without a filter, rows are every show. Upcoming soonest first, the rest newest first.",
  input: z.strictObject({
    filter: z.enum(SHOW_FILTERS).optional(), venueId: z.string().min(1).optional(), from: dateStr.optional(), to: dateStr.optional(), city: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  async run(_ctx, i) {
    const today = todayServer();
    const city = i.city?.toLowerCase();
    const shows = (await db.list("shows"))
      .filter((s) => (!i.venueId || s.venue?.id === i.venueId) && (!i.from || s.date >= i.from) && (!i.to || s.date <= i.to)
        && (!city || showCity(s as never)?.toLowerCase() === city))
      .map((s) => ({ s, f: showFilter(s as never, today) }));
    const counts = Object.fromEntries(SHOW_FILTERS.map((f) => [f, shows.filter((x) => x.f === f).length]));
    const rows = shows.filter((x) => !i.filter || x.f === i.filter)
      .sort((a, b) => (i.filter === "upcoming" ? a.s.date.localeCompare(b.s.date) : b.s.date.localeCompare(a.s.date)));
    const page = rows.slice(0, i.limit);
    // One list for every deal; a show's deal shares its id. Only the money totals leave here.
    const totalsOf = new Map((page.length ? await db.list("showDeals") : []).flatMap((d) => {
      const t = d.totals as { income: number; paidOut?: number; expenses: number } | undefined;
      return t ? [[d.id, { income: t.income, paidOut: t.paidOut ?? 0, expenses: t.expenses, net: t.income - (t.paidOut ?? 0) - t.expenses }] as const] : [];
    }));
    return {
      today, filter: i.filter ?? null, counts, count: rows.length,
      shows: page.map(({ s, f }) => ({
        id: s.id, name: showName(s as never), date: s.date, status: s.status, filter: f, city: showCity(s as never),
        ...(s.reason ? { reason: s.reason } : {}), ...(totalsOf.has(s.id) ? { totals: totalsOf.get(s.id) } : {}),
      })),
    };
  },
});

// ---------- create ("Booked it") ----------

const DealIn = z.strictObject({
  deal: z.enum(["guarantee", "doorSplit", "flat", "tips", "free"]).default("guarantee"),
  guarantee: cents.optional(), doorSplitPct: z.number().int().min(0).max(100).optional(), ticketPrice: cents.optional(),
  promoterId: z.string().min(1).optional(), editionId: z.string().min(1).optional(), contactIds: z.array(z.string()).optional(),
});

/** shows.create's input: also what tours.book parses to book an option through the same path. */
export const ShowCreateIn = z.strictObject({
    pitchId: z.string().min(1).optional(), date: dateStr, status: z.enum(["hold", "confirmed"]).default("confirmed"),
    kind: showKind.optional(), venueId: z.string().min(1).optional(), place: place.optional(), hostContactIds: z.array(z.string().min(1)).optional(),
    editionId: z.string().min(1).optional(), editionName: z.string().optional(), times: times.default({}),
    billedAs: z.string().min(1).nullable().optional(), personnel: z.array(z.string().min(1)).optional(), sendInvites: z.boolean().optional(),
    sound: soundSchema.optional(), needs: needs.default({ poster: false, backline: false, merch: false }),
    ticketUrl: z.string().optional(), dayOfContact: dayOfContact.optional(),
    copyPitchComments: z.boolean().default(false), deal: DealIn.default({ deal: "guarantee" }),
  });

export const showsCreate = defineCommand({
  name: "shows.create", roles: ["admin", "mcp"],
  description:
    "Create a show (and its admin-only showDeal) in one step. 'We booked X on DATE' = shows.create with pitchId + date; it is the pitch's 'Booked it' (links pitch.showIds, sets the pitch to booked). " +
    "The pitch does not supply the place: still give venueId, or for a house concert hostContactIds (contacts) + place {city, address?}. billedAs and personnel fall back to the pitch's. " +
    "status hold|confirmed (default confirmed); kind: venue|house|festival|radio|other (default from the rest). editionId links a festival year (editionName is then always the festival name and year label). " +
    "billedAs is a configuration id (context.now artist.configurations; null = none, no personnel) and fills personnel; sound defaults from the venue; needs (poster/backline/merch). " +
    "times: loadIn, soundcheck, doors, showStart, set (HH:MM) and setLengthSec (seconds). deal.guarantee is cents and becomes an income record (guarantee, from the venue, not yet received: income.setReceived when it arrives). The show's project is billedAs's configuration project, else the default project. " +
    "The show starts with no checklists (shows.addChecklist), except that a confirmed venue or festival show gets an \"Add to Bandsintown\" item (in its Promotion list, or a new one). copyPitchComments (needs pitchId) copies the pitch's comments onto the show. " +
    "It never touches Google Calendar (that is shows.calendar, on purpose). sendInvites decides who the calendar event will invite when it is sent: true only the configuration's members on the team with an email, false nobody; omitted everyone in personnel with an email. " +
    "dayOfContact {name, phone?, contactId?} defaults to the venue's first day-of contact (contacts.setRoles); a contactId at a venue also makes them a day-of contact there.",
  input: ShowCreateIn,
  async run(ctx, i) {
    const id = await run(ctx, (w) => createShow(w, ctx, i));
    await ensureBandsintownItem(ctx, id);
    return done(id);
  },
});

/**
 * The booking path: the show, its deal, the guarantee as income, and, with a pitchId, the pitch booked ("Booked it").
 * One writer, so tours.book can book an option in the same transaction as its tour changes. Returns the show id.
 */
export async function createShow(w: Writer, ctx: Ctx, i: z.infer<typeof ShowCreateIn>): Promise<string> {
  const venue = i.venueId ? await requireVenue(w, i.venueId) : null;
  const hosts = i.hostContactIds?.length ? await hostsOf(w, i.hostContactIds) : null;
  const pitch = i.pitchId ? await w.get("pitches", i.pitchId) : null;
  if (i.pitchId && (!pitch || pitch.deletedAt)) throw new AppError("not_found", "Pitch not found", 404);
  if (pitch && ctx.artistId && pitch.artistId !== ctx.artistId) throw new AppError("not_found", "Pitch not found", 404);
  const artist = await artistFor(w, pitch?.artistId);
  const billedAs = i.billedAs === null ? undefined : i.billedAs ?? pitch?.pitchedAs ?? undefined;
  const cfg = configOf(artist, billedAs);
  const personnel = i.personnel ?? (i.billedAs !== undefined ? cfg?.musicianIds : pitch?.personnel?.length ? pitch.personnel : cfg?.musicianIds) ?? [];
  const calendarInviteeIds = i.sendInvites === undefined ? undefined
    : i.sendInvites ? calendarInvitees(cfg?.musicianIds ?? [], await w.query("musicians"), await w.query("users"), artist.id) : [];
  const pitchEdition = (pitch?.target as { kind: string; id: string } | undefined)?.kind === "edition" ? (pitch!.target as { id: string }).id : undefined;
  const editionId = i.editionId ?? i.deal.editionId ?? pitchEdition;
  const edition = editionId ? await requireEdition(w, editionId) : null;
  // A festival show can be booked before the festival says which stage or venue: venue TBD.
  if (!venue && !i.place && !edition) throw new AppError("invalid_input", NO_PLACE, 400);
  const kind = i.kind ?? (hosts && !venue ? "house" : edition ? "festival" : venue ? "venue" : "other");
  // Most house concerts run on the band's own PA.
  const snd = i.sound ?? venue?.sound ?? { provider: kind === "house" ? "bandProvided" as const : "venueProvided" as const };
  const dayOf = i.dayOfContact ?? (venue ? await venueDayOf(w, venue, artist.id) : undefined);
  const r = await w.create("shows", {
    date: i.date, status: i.status, kind, venue: venue ? venueCopy(venue) : undefined, place: venue ? undefined : i.place, ...hosts,
    editionId: edition?.id, editionName: edition ? editionLabel(edition) : i.editionName, times: i.times, artistId: artist.id,
    billedAs, projectId: await defaultProjectIdFor(w, artist.id, billedAs), personnel, calendarInviteeIds, sound: snd, needs: i.needs,
    checklists: [],
    docs: [], ticketUrl: i.ticketUrl, dayOfContact: dayOf,
    statusHistory: [{ status: i.status, by: ctx.uid, at: w.now.toDate().toISOString() }],
  });
  const d = i.deal;
  const target = pitch?.target as { kind: string; id: string } | undefined;
  await w.create("showDeals", {
    pitchId: i.pitchId, promoterId: d.promoterId ?? (target?.kind === "promoter" ? target.id : undefined),
    editionId: edition?.id ?? (target?.kind === "edition" ? target.id : undefined),
    contactIds: d.contactIds ?? (venue ? (await noteOf(w, venue, artist.id)).fields.contactIds : undefined) ?? hosts?.hostContactIds ?? [], deal: d.deal,
    doorSplitPct: d.doorSplitPct, ticketPrice: d.ticketPrice,
  }, { id: r.id });
  const projectId = (await w.get("shows", r.id))!.projectId as string | undefined;
  if (d.guarantee) {
    if (!projectId) throw new AppError("invalid_state", "There is no default project yet: create one with projects.create (isDefault) before booking with a guarantee", 409);
    const inc = await w.create("income", {
      artistId: artist.id, category: "guarantee", amount: d.guarantee, from: venue?.name as string ?? hosts?.hostName ?? i.place?.city ?? edition?.festivalName as string ?? "Guarantee",
      projectId, showId: r.id, date: i.date,
    });
    await refreshDealTotals(w, r.id, { income: [(await w.get("income", inc.id))!] });
  }
  if (venue && i.dayOfContact?.contactId) await tickDayOf(w, venue, artist.id, i.dayOfContact.contactId);
  if (i.copyPitchComments && !pitch) throw new AppError("invalid_input", "copyPitchComments needs a pitchId", 400);
  if (pitch && i.pitchId) {
    if (i.copyPitchComments) {
      const found = await w.query(`pitches/${i.pitchId}/comments`, (q) => q);
      for (const c of found.sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis())) {
        await w.create(`shows/${r.id}/comments`, { authorId: c.authorId, body: c.body }, { keep: { createdAt: c.createdAt, createdBy: c.createdBy } });
      }
    }
    await w.update("pitches", i.pitchId, { showIds: [...(pitch.showIds as string[]), r.id], ...(pitch.status === "booked" ? {} : { status: "booked" }) });
    if (pitch.status !== "booked") await w.create(`pitches/${i.pitchId}/activity`, { type: "status", fromStatus: pitch.status, toStatus: "booked", text: "Booked it" });
    for (const av of await w.query("availability", (q) => q.where("pitchId", "==", i.pitchId))) {
      if (!av.showId && av.date === i.date) await w.update("availability", av.id, { showId: r.id });
    }
  }
  return r.id;
}

/** The venue's first day-of contact (this band's notes) as a show's dayOfContact, if it has one that still exists. */
async function venueDayOf(w: Writer, venue: Doc, artistId: string) {
  for (const id of (await noteOf(w, venue, artistId)).fields.dayOfContactIds) {
    const c = await w.get("contacts", id);
    if (c && !c.deletedAt && c.artistId === artistId) return dayOfContactOf({ id: c.id, name: c.name as string, phones: (c.phones as string[] | undefined) ?? [] });
  }
  return undefined;
}
/** Whoever a show at the venue calls on the day is a day-of contact there: linked (privately) and ticked, other roles kept. */
async function tickDayOf(w: Writer, venue: Doc, artistId: string, contactId: string) {
  const c = await w.get("contacts", contactId);
  if (c && !c.deletedAt && c.artistId === artistId) await setContactRoles(w, venue, artistId, contactId, ["dayOf"], "add");
}

// ---------- update ----------

const showPatch = z.strictObject({
  date: dateStr.optional(), status: z.enum(["hold", "confirmed", "played", "canceled", "dropped"]).optional(), reason: z.string().nullable().optional(), kind: showKind.optional(),
  venueId: z.string().min(1).nullable().optional(), place: place.nullable().optional(), hostContactIds: z.array(z.string().min(1)).optional(),
  editionId: z.string().min(1).nullable().optional(), editionName: z.string().nullable().optional(), times: times.optional(), billedAs: z.string().min(1).nullable().optional(),
  personnel: z.array(z.string().min(1)).optional(), sound: soundSchema.optional(), needs: needs.optional(),
  docs: z.array(z.strictObject({ title: z.string(), driveFileId: z.string(), url: z.string() })).optional(),
  ticketUrl: z.string().nullable().optional(), dayOfContact: dayOfContact.nullable().optional(),
  transitionSec: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(90)]).optional(),
  projectId: z.string().min(1).optional(),
  fanPage: ShowFanPage.optional(),
});

export const showsUpdate = defineCommand({
  name: "shows.update", roles: ["admin", "mcp"],
  description:
    "Edit a show. Patch: date, status (hold|confirmed|played|canceled|dropped; to cancel or drop use shows.setStatus / shows.cancel / shows.drop, which ask first; 'played' is set here or by shows.afterShow), reason (why it was canceled or dropped; null clears), kind, " +
    "venueId (from a venue search; null = no venue: needs place), place {city, address?} (null clears), hostContactIds ([] clears), editionId (null unlinks; sets editionName), " +
    "times {loadIn, soundcheck, doors, showStart, set, setLengthSec (seconds)} and sound REPLACE the whole object: send every key you want to keep. personnel and docs REPLACE the lists: read the show first and resend them all. " +
    "billedAs is a configuration id (context.now artist.configurations; also refills personnel unless personnel is given), needs, ticketUrl, fanPage {on, name?, amountCents?, button: ticket|donation} (the show's Venmo line on the public fan page, shown while on from 1h before the show time to 3h after; REPLACES the whole object), dayOfContact {name, phone?, contactId?} (null clears; a contactId at a venue also makes them a day-of contact there), transitionSec (15|30|60|90: the average song-to-song gap counted into the setlist length; default 30), projectId (the project its money belongs to, an open one from context.now projects; money already recorded stays where it is). A status change is added to statusHistory. " +
    "Checklists are not touched (use the shows.*Checklist* commands). " +
    "Google Calendar is never touched: resend the event with shows.calendar.",
  input: z.strictObject({ id: z.string().min(1), patch: showPatch }),
  async run(ctx, { id, patch }) {
    await run(ctx, async (w) => {
      const before = await requireShow(w, id);
      const { venueId, hostContactIds, editionId, ...rest } = patch;
      const p: Record<string, unknown> = { ...rest };
      if (ctx.artistId && before.artistId && before.artistId !== ctx.artistId) throw new AppError("not_found", "Show not found", 404);
      const artist = await artistFor(w, before.artistId);
      if (patch.projectId) await requireOpenProject(w, patch.projectId);
      if (venueId) p.venue = venueCopy(await requireVenue(w, venueId));
      if (venueId === null) p.venue = null;
      if (hostContactIds) {
        const h = hostContactIds.length ? await hostsOf(w, hostContactIds) : { hostContactIds: null, hostName: null };
        Object.assign(p, { hostContactIds: h.hostContactIds ?? null, hostName: h.hostName ?? null });
      }
      if (editionId) { const e = await requireEdition(w, editionId); Object.assign(p, { editionId: e.id, editionName: editionLabel(e) }); }
      if (editionId === null) Object.assign(p, { editionId: null, editionName: patch.editionName ?? null });
      const hasVenue = p.venue === undefined ? !!before.venue : !!p.venue;
      const hasPlace = p.place === undefined ? !!before.place : !!p.place;
      const hasEdition = p.editionId === undefined ? !!before.editionId : !!p.editionId;
      if (!hasVenue && !hasPlace && !hasEdition) throw new AppError("invalid_input", NO_PLACE, 400);
      if (patch.billedAs !== undefined && patch.billedAs !== null) {
        const cfg = configOf(artist, patch.billedAs);
        if (!patch.personnel) p.personnel = cfg?.musicianIds;
      }
      if (patch.status && patch.status !== before.status) p.statusHistory = historyWith(w, before, patch.status, patch.reason ?? undefined);
      const r = await w.update("shows", id, p);
      const after = (await w.get("shows", id))!;
      // A show on a tour keeps its entry on its date (at the end of the new day).
      if (patch.date && patch.date !== before.date && before.tourId) {
        const path = `tours/${before.tourId as string}/entries`;
        const all = await w.query(path);
        const last = Math.max(0, ...all.filter((e) => e.date === patch.date).map((e) => e.position as number));
        for (const e of all.filter((e) => e.kind === "show" && e.showId === id)) await w.update(path, e.id, { date: patch.date, position: last + 1 });
      }
      if (patch.dayOfContact?.contactId && after.venue?.id) {
        const venue = await w.get("venues", after.venue.id);
        if (venue && !venue.deletedAt) await tickDayOf(w, venue, artist.id, patch.dayOfContact.contactId);
      }
      return r;
    });
    await ensureBandsintownItem(ctx, id);
    return done(id);
  },
});

type StatusEntry = { status: string; reason?: string; by: string; at: string };
const historyWith = (w: Writer, before: Doc, status: string, reason?: string): StatusEntry[] =>
  [...((before.statusHistory as StatusEntry[] | undefined) ?? []), { status, ...(reason ? { reason } : {}), by: w.ctx.uid, at: w.now.toDate().toISOString() }];

const offInput = z.strictObject({ id: z.string().min(1), reason: z.string().optional() });
/** Change a show's status with an optional reason, recorded in statusHistory with who and when, in one write. A blank reason clears it. */
async function setStatus(ctx: Ctx, i: { id: string; reason?: string }, status: "hold" | "confirmed" | "canceled" | "dropped") {
  const reason = i.reason?.trim() || undefined;
  await run(ctx, async (w) => {
    const before = await requireShow(w, i.id);
    if (ctx.artistId && before.artistId && before.artistId !== ctx.artistId) throw new AppError("not_found", "Show not found", 404);
    return w.update("shows", i.id, { status, reason: reason ?? null, statusHistory: historyWith(w, before, status, reason) });
  });
  await ensureBandsintownItem(ctx, i.id);
  return done(i.id);
}
const setOff = (ctx: Ctx, i: z.infer<typeof offInput>, status: "canceled" | "dropped") => setStatus(ctx, i, status);

export const showsSetStatus = defineCommand({
  name: "shows.setStatus", roles: ["admin", "mcp"],
  description: "Change a show's status: hold (penciled in), confirmed, canceled (the venue called it off) or dropped (we called it off), with an optional reason. " +
    "Each change is kept in statusHistory with who and when. Its Calendar event stays on canceled or dropped until shows.calendar on:false.",
  input: z.strictObject({ id: z.string().min(1), status: z.enum(["hold", "confirmed", "canceled", "dropped"]), reason: z.string().optional() }),
  run: (ctx, i) => setStatus(ctx, i, i.status),
});

export const showsCancel = defineCommand({
  name: "shows.cancel", roles: ["admin", "mcp"], input: offInput,
  description: "Cancel a show: they called it off (dropped means we pulled out). Optional reason. Its Calendar event stays until shows.calendar on:false.",
  run: (ctx, i) => setOff(ctx, i, "canceled"),
});

export const showsDrop = defineCommand({
  name: "shows.drop", roles: ["admin", "mcp"], input: offInput,
  description: "Drop a show: we pulled out (canceled means they called it off). Optional reason. Its Calendar event stays until shows.calendar on:false.",
  run: (ctx, i) => setOff(ctx, i, "dropped"),
});

export const showsRemove = defineCommand({
  name: "shows.remove", roles: ["admin"], input: idInput,
  description: "Archive a show (and its deal) that was entered by mistake. A real cancellation is shows.cancel (they called it off) or shows.drop (we pulled out), which keep the history. " +
    "Takes it off the band calendar (history.undoRun puts the event back); if the calendar can't be reached, nothing is removed.",
  async run(ctx, { id }) {
    // The event first: a show gone from the app must not stay on everyone's calendar. The show keeps calendarEventId, so Undo can bring the event back.
    const before = await db.get("shows", id);
    if (before && !before.deletedAt) await deleteEvent(ctx, before);
    await run(ctx, async (w) => {
      await requireShow(w, id);
      await w.softDelete("shows", id);
      if (await w.get("showDeals", id)) await w.softDelete("showDeals", id);
    });
    return done(id);
  },
});

// ---------- checklists: see ./checklists.ts ----------

/** A show of the artist this call is for (any show, for scripts and tests with no artist). */
async function bandShow(w: Writer, id: string) {
  const s = await requireShow(w, id);
  if (w.ctx.artistId && s.artistId && s.artistId !== w.ctx.artistId) throw new AppError("not_found", "Show not found", 404);
  return s;
}

// ---------- comments (the whole band) ----------

/** The comment to change: the author's own, or any one for an admin. */
const changeableComment = async (w: Writer, showId: string, commentId: string) => {
  await requireShow(w, showId);
  const c = await w.get(`shows/${showId}/comments`, commentId);
  if (!c || c.deletedAt) throw new AppError("not_found", "Comment not found", 404);
  if (c.authorId !== w.ctx.uid && w.ctx.role !== "admin") throw new AppError("forbidden", "You can only change your own comments", 403);
  return c;
};
const commentAudience = z.enum(["band", "admins"]);
const noPrivateForMembers = (ctx: Ctx, audience?: string) => {
  if (audience === "admins" && ctx.role === "member") throw new AppError("forbidden", "Only admins can post private comments", 403);
};
export const showsComment = defineCommand({
  name: "shows.comment", roles: ["admin", "member", "mcp"],
  description: "Comment on a show. audience band: the whole band reads it; admins: Private, admins only. An admin's comment defaults to admins, everyone else's to band.",
  input: z.strictObject({ id: z.string().min(1), body: z.string().trim().min(1), audience: commentAudience.optional() }),
  run: (ctx, i) => run(ctx, async (w) => {
    noPrivateForMembers(ctx, i.audience);
    await requireShow(w, i.id);
    return w.create(`shows/${i.id}/comments`, { authorId: ctx.uid, body: i.body, audience: i.audience ?? (ctx.role === "admin" ? "admins" : "band") });
  }),
});
export const showsEditComment = defineCommand({
  name: "shows.editComment", roles: ["admin", "member", "mcp"],
  description: "Edit a comment on a show: its body (marks it edited) and/or its audience (band or admins = Private). Your own comments; admins can edit anyone's.",
  input: z.strictObject({ id: z.string().min(1), commentId: z.string().min(1), body: z.string().trim().min(1).optional(), audience: commentAudience.optional() }),
  run: (ctx, i) => run(ctx, async (w) => {
    noPrivateForMembers(ctx, i.audience);
    const c = await changeableComment(w, i.id, i.commentId);
    const patch: Record<string, unknown> = {};
    if (i.body !== undefined && i.body !== c.body) Object.assign(patch, { body: i.body, edited: true });
    if (i.audience && i.audience !== c.audience) patch.audience = i.audience;
    if (!Object.keys(patch).length) return { id: i.commentId };
    return w.update(`shows/${i.id}/comments`, i.commentId, patch);
  }),
});
export const showsRemoveComment = defineCommand({
  name: "shows.removeComment", roles: ["admin", "member", "mcp"], description: "Delete a comment on a show. Your own comments; admins can delete anyone's.",
  input: z.strictObject({ id: z.string().min(1), commentId: z.string().min(1) }),
  run: (ctx, i) => run(ctx, async (w) => { await changeableComment(w, i.id, i.commentId); return w.softDelete(`shows/${i.id}/comments`, i.commentId); }),
});

export const showsCalendarPreview = defineCommand({
  name: "shows.calendarPreview", roles: ["admin", "mcp"], input: idInput,
  description: "Read-only: the show's event as shows.calendar would send it to the band calendar: title, start and end, location, notes, who is invited (and who has no email), and whether it creates the event or updates the one there (unchanged: nothing changed since it was sent).",
  run: (ctx, { id }) => calendarPreview(ctx, "shows", id),
});

export const showsCalendarLink = defineCommand({
  name: "shows.calendarLink", roles: ["admin", "mcp"], input: z.strictObject({ id: z.string().min(1), eventId: z.string().min(1) }),
  description: "Link the show to an event someone already put on the band calendar (one of shows.calendarPreview's `existing`) instead of adding a second one. " +
    "Sends nothing: the event stays as it is until shows.calendar on:true updates it.",
  run: (ctx, i) => calendarLink(ctx, "shows", i.id, i.eventId),
});

export const showsCalendar = defineCommand({
  name: "shows.calendar", roles: ["admin", "mcp"], input: z.strictObject({ id: z.string().min(1), on: z.boolean(), restore: z.boolean().optional() }),
  description: "Send the show's event to the band's Google Calendar with invites (on:true: creates it, or updates the one there to match the show), or take it off (on:false). " +
    "Saving a show never does this: show the person shows.calendarPreview first. Written with the caller's own Google account, so it fails if they can't write to the band calendar. " +
    "If someone deleted the event in Calendar (the preview's deleted), on:true fails unless restore:true: ask the person before putting it back.",
  run: (ctx, i) => (i.on ? calendarSend(ctx, "shows", i.id, { restore: i.restore }) : calendarRemove(ctx, "shows", i.id)),
});

// ---------- deal (admin only) ----------

const dealPatch = z.strictObject({
  promoterId: z.string().nullable().optional(), editionId: z.string().nullable().optional(), contactIds: z.array(z.string()).optional(),
  deal: z.enum(["guarantee", "doorSplit", "flat", "tips", "free"]).optional(),
  doorSplitPct: z.number().int().min(0).max(100).nullable().optional(), ticketPrice: cents.nullable().optional(),
});
export const showDealsUpdate = defineCommand({
  name: "showDeals.update", roles: ["admin", "mcp"], input: z.strictObject({ id: z.string().min(1), patch: dealPatch }),
  description: "Edit the admin-only deal for a show (id is the show id): deal type, door split, ticket price, contacts. Money in is income.add (income.setReceived when it arrives).",
  run: (ctx, { id, patch }) => db.update(ctx, "showDeals", id, patch as Record<string, unknown>),
});

// ---------- after the show ----------

export const showsAfter = defineCommand({
  name: "shows.afterShow", roles: ["admin", "mcp"],
  description:
    "How'd it go? Rate the show and venue (1-5, both optional), notes, the crowd estimate (how many were in the room) " +
    "and paid attendance (the ticketed count). Something has to be filled in. A score left out keeps the one already " +
    "stored. Marks the show played. " +
    "A bare 'mark it played' with no rating or notes is shows.update {status:\"played\"} instead. Does NOT enter money: income is income.add, payouts payouts.add, expenses shows.setExpenses.",
  input: z.strictObject({
    id: z.string().min(1), show: z.number().int().min(1).max(5).optional(), venue: z.number().int().min(1).max(5).optional(),
    crowd: z.number().int().min(0).optional(), notes: z.string().optional(), paidAttendance: z.number().int().min(0).optional(),
  }),
  async run(ctx, i) {
    // Nothing to record is a mistake rather than a way to clear a rating (there is no "unrate"): the Accounting Form
    // import means stars are optional, so an empty save would otherwise mark a show played and store nothing.
    const notes = i.notes?.trim();
    if (i.show === undefined && i.venue === undefined && i.crowd === undefined && !notes && i.paidAttendance === undefined) {
      throw new AppError("invalid_input", "Fill in something first", 400);
    }
    await run(ctx, async (w) => {
      const s = await requireShow(w, i.id);
      if (isOff(s)) throw new AppError("invalid_state", `This show was ${s.status}`, 409);
      if (s.date > addDays(todayServer(), 1)) throw new AppError("too_early", "This show hasn't happened yet", 409);
      const deal = await w.get("showDeals", i.id);
      if (!deal) throw new AppError("not_found", "Show deal not found", 404);
      if (s.status !== "played") await w.update("shows", i.id, { status: "played" });
      // Merged onto what is there, so leaving a field out keeps its stored value instead of clearing it.
      await w.update("showDeals", i.id, {
        rating: {
          ...((deal.rating ?? {}) as Record<string, unknown>),
          ...(i.show !== undefined ? { show: i.show } : {}), ...(i.venue !== undefined ? { venue: i.venue } : {}),
          ...(notes ? { notes } : {}),
        },
        ...(i.crowd !== undefined ? { crowd: i.crowd } : {}),
        ...(i.paidAttendance !== undefined ? { paidAttendance: i.paidAttendance } : {}),
      });
    });
    await ensureBandsintownItem(ctx, i.id);
    return done(i.id);
  },
});

// ---------- custom fields ----------

export const showsSetFields = defineCommand({
  name: "shows.setFields", roles: ["admin"],
  description: "Set a show's custom field values (the artist's showFields, defined with artists.addShowField): fields is the whole list of [{fieldId, value}], so read the show's fields and the artist's showFields (records.get artists) first and resend the values you keep. A field the artist lacks is added with artists.addShowField first. A blank value, or a field left out, means no value. Unknown field ids are refused.",
  input: z.strictObject({ id: z.string().min(1), fields: z.array(z.strictObject({ fieldId: z.string().min(1), value: z.string() })) }),
  run: (ctx, i) => run(ctx, async (w) => {
    const show = await bandShow(w, i.id);
    const defs = ((await artistFor(w, show.artistId)).showFields ?? []) as { id: string }[];
    const seen = new Set<string>();
    const fields = i.fields.flatMap((f) => {
      if (!defs.some((d) => d.id === f.fieldId)) throw new AppError("invalid_input", `No such show field "${f.fieldId}"`, 400);
      if (seen.has(f.fieldId)) throw new AppError("invalid_input", "Give each field once", 400);
      seen.add(f.fieldId);
      const value = f.value.trim();
      return value ? [{ fieldId: f.fieldId, value }] : [];
    });
    return w.update("shows", i.id, { fields });
  }),
});

export const showCommands = [
  showsList, showsCreate, showsUpdate, showsSetStatus, showsCancel, showsDrop, showsRemove,
  showsSetFields, showsComment, showsEditComment, showsRemoveComment, showsCalendarPreview, showsCalendar, showsCalendarLink, showDealsUpdate, showsAfter,
  ...checklistCommands,
];
