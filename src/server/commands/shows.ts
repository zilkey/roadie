import { randomUUID } from "node:crypto";
import { dateInBandZone } from "@/lib/timezone";
import { z } from "zod";
import { defineCommand } from "./types";
import { idInput } from "./util";
import { db, run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { syncShow, type SyncResult } from "../showSync";
import { calendarPreview, calendarRemove, calendarSend } from "../calendarSync";
import { noteOf } from "../venues";
import { addDays, calendarInvitees, checklistsOf, isOff, joinNames, showCity, showFilter, showName, SHOW_FILTERS, type ArtistLike, type ChecklistItem, type ChecklistLike } from "@/lib/shows";
import { dateStr, timeStr, sound as soundSchema, cents, showKind, incomeCategory, payMethod } from "@/schema";
import { refreshDealTotals } from "../dealTotals";

const newId = () => randomUUID().slice(0, 8);
const todayServer = () => dateInBandZone();

const times = z.strictObject({
  loadIn: timeStr.optional(), soundcheck: timeStr.optional(), doors: timeStr.optional(), showStart: timeStr.optional(), set: timeStr.optional(),
  setLengthSec: z.number().int().min(1).optional(),
});
const needs = z.strictObject({ poster: z.boolean(), backline: z.boolean(), merch: z.boolean() });
const checklistItem = z.strictObject({ id: z.string().min(1).optional(), label: z.string().trim().min(1), done: z.boolean().default(false), ownerId: z.string().min(1).optional() });
const checklistIn = z.strictObject({ id: z.string().min(1).optional(), name: z.string().trim().min(1), templateId: z.string().min(1).nullable().optional(), items: z.array(checklistItem) });
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
    const c = await w.get("contacts", id);
    if (!c || c.deletedAt) throw new AppError("not_found", "Host contact not found", 404);
    names.push(c.name as string);
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
const done = (id: string, sync: SyncResult) => ({ id, warnings: sync.warnings, bandsintown: sync.bandsintown });

// ---------- list ----------

export const showsList = defineCommand({
  name: "shows.list", roles: ["admin", "mcp"],
  description:
    "List shows by filter: upcoming, played (or confirmed with the date passed), canceled (they called it off), or dropped (we pulled out, or a hold whose date passed unconfirmed). " +
    "Optional narrowing: venueId, from / to (YYYY-MM-DD, inclusive, on the show date), city (case-insensitive exact match). " +
    "Rows carry reason (why it was canceled or dropped) when one was given, and totals {income, expenses, net} in cents when the show has a deal with money entered. " +
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
      const t = d.totals as { income: number; expenses: number } | undefined;
      return t ? [[d.id, { income: t.income, expenses: t.expenses, net: t.income - t.expenses }] as const] : [];
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

export const showsCreate = defineCommand({
  name: "shows.create", roles: ["admin", "mcp"],
  description:
    "Create a show (and its admin-only showDeal) in one step. 'We booked X on DATE' = shows.create with pitchId + date; it is the pitch's 'Booked it' (links pitch.showIds, sets the pitch to booked). " +
    "The pitch does not supply the place: still give venueId, or for a house concert hostContactIds (contacts) + place {city, address?}. billedAs and personnel fall back to the pitch's. " +
    "status hold|confirmed (default confirmed); kind: venue|house|festival|radio|other (default from the rest). editionId links a festival year (sets editionName). " +
    "billedAs is a configuration id (context.now artist.configurations; null = none, no personnel) and fills personnel; sound defaults from the venue; needs (poster/backline/merch). " +
    "times: loadIn, soundcheck, doors, showStart, set (HH:MM) and setLengthSec (seconds). deal.guarantee is cents and becomes the deal's first income line (not received). " +
    "The show starts with no checklists (shows.addChecklist). copyPitchComments (needs pitchId) copies the pitch's comments onto the show. " +
    "It never touches Google Calendar (that is shows.calendar, on purpose). sendInvites decides who the calendar event will invite when it is sent: true only the configuration's members on the team with an email, false nobody; omitted everyone in personnel with an email. publishToBandsintown lists the show on Bandsintown once confirmed.",
  input: z.strictObject({
    pitchId: z.string().min(1).optional(), date: dateStr, status: z.enum(["hold", "confirmed"]).default("confirmed"),
    kind: showKind.optional(), venueId: z.string().min(1).optional(), place: place.optional(), hostContactIds: z.array(z.string().min(1)).optional(),
    editionId: z.string().min(1).optional(), editionName: z.string().optional(), times: times.default({}),
    billedAs: z.string().min(1).nullable().optional(), personnel: z.array(z.string().min(1)).optional(), sendInvites: z.boolean().optional(),
    sound: soundSchema.optional(), needs: needs.default({ poster: false, backline: false, merch: false }),
    publishToBandsintown: z.boolean().default(false), ticketUrl: z.string().optional(), dayOfContact: dayOfContact.optional(),
    copyPitchComments: z.boolean().default(false), deal: DealIn.default({ deal: "guarantee" }),
  }),
  async run(ctx, i) {
    const id = await run(ctx, async (w) => {
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
      const r = await w.create("shows", {
        date: i.date, status: i.status, kind, venue: venue ? venueCopy(venue) : undefined, place: venue ? undefined : i.place, ...hosts,
        editionId: edition?.id, editionName: i.editionName ?? (edition ? editionLabel(edition) : undefined), times: i.times, artistId: artist.id,
        billedAs, personnel, calendarInviteeIds, sound: snd, needs: i.needs,
        checklists: [],
        docs: [], publishToBandsintown: i.publishToBandsintown, ticketUrl: i.ticketUrl, listings: {}, dayOfContact: i.dayOfContact,
        statusHistory: [{ status: i.status, by: ctx.uid, at: w.now.toDate().toISOString() }],
      });
      const d = i.deal;
      const target = pitch?.target as { kind: string; id: string } | undefined;
      await w.create("showDeals", {
        pitchId: i.pitchId, promoterId: d.promoterId ?? (target?.kind === "promoter" ? target.id : undefined),
        editionId: edition?.id ?? (target?.kind === "edition" ? target.id : undefined),
        contactIds: d.contactIds ?? (venue ? (await noteOf(w, venue, artist.id)).fields.contactIds : undefined) ?? hosts?.hostContactIds ?? [], deal: d.deal,
        doorSplitPct: d.doorSplitPct, ticketPrice: d.ticketPrice,
        income: d.guarantee ? [{ id: newId(), category: "guarantee", amount: d.guarantee, received: false }] : [],
      }, { id: r.id });
      if (d.guarantee) await refreshDealTotals(w, r.id);
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
    });
    return done(id, await syncShow(ctx, id));
  },
});

// ---------- update ----------

const SHOW_SYNC_FIELDS = ["date", "status", "venue", "place", "hostName", "times", "personnel", "billedAs", "publishToBandsintown", "public", "ticketUrl", "sound", "editionName", "dayOfContact"];
const showPatch = z.strictObject({
  date: dateStr.optional(), status: z.enum(["hold", "confirmed", "played", "canceled", "dropped"]).optional(), reason: z.string().nullable().optional(), kind: showKind.optional(),
  venueId: z.string().min(1).nullable().optional(), place: place.nullable().optional(), hostContactIds: z.array(z.string().min(1)).optional(),
  editionId: z.string().min(1).nullable().optional(), editionName: z.string().nullable().optional(), times: times.optional(), billedAs: z.string().min(1).nullable().optional(),
  personnel: z.array(z.string().min(1)).optional(), sound: soundSchema.optional(), needs: needs.optional(),
  docs: z.array(z.strictObject({ title: z.string(), driveFileId: z.string(), url: z.string() })).optional(),
  publishToBandsintown: z.boolean().optional(), ticketUrl: z.string().nullable().optional(), dayOfContact: dayOfContact.nullable().optional(),
});

export const showsUpdate = defineCommand({
  name: "shows.update", roles: ["admin", "mcp"],
  description:
    "Edit a show. Patch: date, status (hold|confirmed|played|canceled|dropped; to cancel or drop use shows.setStatus / shows.cancel / shows.drop, which ask first; 'played' is set here or by shows.afterShow), reason (why it was canceled or dropped; null clears), kind, " +
    "venueId (from a venue search; null = no venue: needs place), place {city, address?} (null clears), hostContactIds ([] clears), editionId (null unlinks; sets editionName), " +
    "times {loadIn, soundcheck, doors, showStart, set, setLengthSec (seconds)} and sound REPLACE the whole object: send every key you want to keep. personnel and docs REPLACE the lists: read the show first and resend them all. " +
    "billedAs is a configuration id (context.now artist.configurations; also refills personnel unless personnel is given), needs, publishToBandsintown (listed once confirmed), ticketUrl, dayOfContact {name, phone?, contactId?} (null clears). A status change is added to statusHistory. " +
    "Checklists are not touched (use the shows.*Checklist* commands). " +
    "Changing date, time, venue, people, status or publishToBandsintown re-syncs Bandsintown (canceled or dropped takes it off). Google Calendar is never touched: resend the event with shows.calendar.",
  input: z.strictObject({ id: z.string().min(1), patch: showPatch }),
  async run(ctx, { id, patch }) {
    let touchesSync = false;
    await run(ctx, async (w) => {
      const before = await requireShow(w, id);
      const { venueId, hostContactIds, editionId, ...rest } = patch;
      const p: Record<string, unknown> = { ...rest };
      if (ctx.artistId && before.artistId && before.artistId !== ctx.artistId) throw new AppError("not_found", "Show not found", 404);
      const artist = await artistFor(w, before.artistId);
      if (venueId) p.venue = venueCopy(await requireVenue(w, venueId));
      if (venueId === null) p.venue = null;
      if (hostContactIds) {
        const h = hostContactIds.length ? await hostsOf(w, hostContactIds) : { hostContactIds: null, hostName: null };
        Object.assign(p, { hostContactIds: h.hostContactIds ?? null, hostName: h.hostName ?? null });
      }
      if (editionId) { const e = await requireEdition(w, editionId); Object.assign(p, { editionId: e.id, editionName: patch.editionName ?? editionLabel(e) }); }
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
      if (patch.publishToBandsintown !== undefined && before.public !== undefined) p.public = null;
      const r = await w.update("shows", id, p);
      const after = (await w.get("shows", id))!;
      touchesSync = SHOW_SYNC_FIELDS.some((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]));
      return r;
    });
    return done(id, touchesSync ? await syncShow(ctx, id) : { warnings: [] });
  },
});

/** Checklists written back in the new shape: a not-yet-migrated show drops its legacy checklist and gear in the same write. */
function listsPatch(before: Doc, lists: ChecklistLike[]) {
  return { checklists: lists, ...(before.checklist ? { checklist: null } : {}), ...(before.gear ? { gear: null } : {}) };
}
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
  return done(i.id, await syncShow(ctx, i.id));
}
const setOff = (ctx: Ctx, i: z.infer<typeof offInput>, status: "canceled" | "dropped") => setStatus(ctx, i, status);

export const showsSetStatus = defineCommand({
  name: "shows.setStatus", roles: ["admin", "mcp"],
  description: "Change a show's status: hold (penciled in), confirmed, canceled (the venue called it off) or dropped (we called it off), with an optional reason. " +
    "Each change is kept in statusHistory with who and when. Canceled or dropped takes it off Bandsintown; its Calendar event stays until shows.calendar on:false.",
  input: z.strictObject({ id: z.string().min(1), status: z.enum(["hold", "confirmed", "canceled", "dropped"]), reason: z.string().optional() }),
  run: (ctx, i) => setStatus(ctx, i, i.status),
});

export const showsCancel = defineCommand({
  name: "shows.cancel", roles: ["admin", "mcp"], input: offInput,
  description: "Cancel a show: they called it off (dropped means we pulled out). Optional reason. Takes it off Bandsintown; its Calendar event stays until shows.calendar on:false.",
  run: (ctx, i) => setOff(ctx, i, "canceled"),
});

export const showsDrop = defineCommand({
  name: "shows.drop", roles: ["admin", "mcp"], input: offInput,
  description: "Drop a show: we pulled out (canceled means they called it off). Optional reason. Takes it off Bandsintown; its Calendar event stays until shows.calendar on:false.",
  run: (ctx, i) => setOff(ctx, i, "dropped"),
});

export const showsRemove = defineCommand({
  name: "shows.remove", roles: ["admin"], input: idInput,
  description: "Archive a show (and its deal) that was entered by mistake. A real cancellation is shows.cancel (they called it off) or shows.drop (we pulled out), which keep the history. Takes it off Bandsintown; remove its Calendar event first (shows.calendar on:false).",
  async run(ctx, { id }) {
    await run(ctx, async (w) => {
      await requireShow(w, id);
      await w.softDelete("shows", id);
      if (await w.get("showDeals", id)) await w.softDelete("showDeals", id);
    });
    return done(id, await syncShow(ctx, id));
  },
});

export const showsSync = defineCommand({
  name: "shows.sync", roles: ["admin", "mcp"],
  input: z.strictObject({ id: z.string().min(1) }),
  description: "Retry the Bandsintown sync after an error or warning (if publishToBandsintown). To list or unlist on Bandsintown set publishToBandsintown with shows.update. Google Calendar is shows.calendar.",
  async run(ctx, i) { return done(i.id, await syncShow(ctx, i.id)); },
});

// ---------- checklists ----------
// Members can tick, add, edit and remove to-dos on any show; lists themselves (new, rename, delete, reorder) and templates are admins'.

/** A show of the artist this call is for (any show, for scripts and tests with no artist). */
async function bandShow(w: Writer, id: string) {
  const s = await requireShow(w, id);
  if (w.ctx.artistId && s.artistId && s.artistId !== w.ctx.artistId) throw new AppError("not_found", "Show not found", 404);
  return s;
}
function listOf(lists: ChecklistLike[], listId: string) {
  const l = lists.find((x) => x.id === listId);
  if (!l) throw new AppError("not_found", "No such checklist", 404);
  return l;
}
function itemOf(list: ChecklistLike, itemId: string) {
  const i = list.items.find((x) => x.id === itemId);
  if (!i) throw new AppError("not_found", "No such checklist item", 404);
  return i;
}
/** Change one list (by id) and write every list back. */
async function editList(w: Writer, show: Doc, listId: string, f: (l: ChecklistLike) => ChecklistLike | null) {
  const lists = checklistsOf(show as never);
  listOf(lists, listId);
  const next = lists.flatMap((l) => (l.id !== listId ? [l] : (f(l) ?? [])));
  return w.update("shows", show.id, listsPatch(show, next));
}
const editItem = (w: Writer, show: Doc, listId: string, itemId: string, f: (i: ChecklistItem) => ChecklistItem | null) =>
  editList(w, show, listId, (l) => { itemOf(l, itemId); return { ...l, items: l.items.flatMap((i) => (i.id !== itemId ? [i] : (f(i) ?? []))) }; });
async function requireMusician(w: Writer, id: string) {
  const m = await w.get("musicians", id);
  if (!m || m.deletedAt) throw new AppError("not_found", "Musician not found", 404);
}
/** A live template of the artist this call (or this show) is for. */
async function requireTemplate(w: Writer, id: string, artistId = w.ctx.artistId) {
  const t = await w.get("checklistTemplates", id);
  if (!t || t.deletedAt || (artistId && t.artistId !== artistId)) throw new AppError("not_found", "Checklist template not found", 404);
  return t;
}
const liveTemplates = async (w: Writer, artistId: string) =>
  (await w.query("checklistTemplates", (q) => q.where("artistId", "==", artistId))).sort((a, b) => (a.order as number) - (b.order as number));
const nextOrder = (ts: Doc[]) => Math.max(-1, ...ts.map((t) => t.order as number)) + 1;
const listInput = { id: z.string().min(1), listId: z.string().min(1) };
const itemInput = { ...listInput, itemId: z.string().min(1) };
const ownerIn = z.string().min(1).nullable().optional();

export const showsSetChecklists = defineCommand({
  name: "shows.setChecklists", roles: ["admin", "mcp"],
  description: "Replaces every list on the show: prefer the per-list and per-item commands (shows.addChecklist, addChecklistItem, editChecklistItem, checkItem...). In order: [{id?, name, templateId? (the checklist template it came from; null = none), items: [{id?, label, done, ownerId? (musician; none = unassigned)}]}]. Lists and items without an id get one.",
  input: z.strictObject({ id: z.string().min(1), checklists: z.array(checklistIn) }),
  run: (ctx, i) => run(ctx, async (w) => {
    const before = await bandShow(w, i.id);
    const was = new Map(checklistsOf(before as never).flatMap((l) => l.items.map((c) => [c.id, c] as const)));
    const stamp = (c: z.infer<typeof checklistItem>) => {
      const old = c.id ? was.get(c.id) : undefined;
      if (!c.done) return {};
      return old?.done && old.doneAt ? { doneAt: old.doneAt, doneBy: old.doneBy } : { doneAt: w.now.toDate().toISOString(), doneBy: ctx.uid };
    };
    const lists = i.checklists.map((l) => ({ ...l, id: l.id ?? newId(), templateId: l.templateId ?? null, items: l.items.map((c) => ({ ...c, id: c.id ?? newId(), ...stamp(c) })) }));
    return w.update("shows", i.id, listsPatch(before, lists));
  }),
});

export const showsAddChecklist = defineCommand({
  name: "shows.addChecklist", roles: ["admin"],
  description: "Add a list at the end of a show's checklists: from a template (its name and items, not done, unassigned; templateId set), or a blank list by name. The same template can be added more than once.",
  input: z.union([
    z.strictObject({ id: z.string().min(1), templateId: z.string().min(1) }),
    z.strictObject({ id: z.string().min(1), name: z.string().trim().min(1) }),
  ]),
  run: (ctx, i) => run(ctx, async (w) => {
    const show = await bandShow(w, i.id);
    const listId = newId();
    let list: ChecklistLike = { id: listId, name: "", templateId: null, items: [] };
    if ("templateId" in i) {
      const t = await requireTemplate(w, i.templateId, show.artistId);
      list = { ...list, name: t.name as string, templateId: t.id, items: (t.items as { label: string }[]).map((x) => ({ id: newId(), label: x.label, done: false })) };
    } else list = { ...list, name: i.name };
    await w.update("shows", i.id, listsPatch(show, [...checklistsOf(show as never), list]));
    return { id: i.id, listId };
  }),
});

export const showsRenameChecklist = defineCommand({
  name: "shows.renameChecklist", roles: ["admin"], description: "Rename one of a show's checklists.",
  input: z.strictObject({ ...listInput, name: z.string().trim().min(1) }),
  run: (ctx, i) => run(ctx, async (w) => editList(w, await bandShow(w, i.id), i.listId, (l) => ({ ...l, name: i.name }))),
});

export const showsRemoveChecklist = defineCommand({
  name: "shows.removeChecklist", roles: ["admin"], description: "Delete one of a show's checklists and its items (Undo puts it back).",
  input: z.strictObject(listInput),
  run: (ctx, i) => run(ctx, async (w) => editList(w, await bandShow(w, i.id), i.listId, () => null)),
});

export const showsReorderChecklists = defineCommand({
  name: "shows.reorderChecklists", roles: ["admin"], description: "Put a show's checklists in this order: listIds is every list's id, once.",
  input: z.strictObject({ id: z.string().min(1), listIds: z.array(z.string().min(1)) }),
  run: (ctx, i) => run(ctx, async (w) => {
    const show = await bandShow(w, i.id);
    const lists = checklistsOf(show as never);
    const same = i.listIds.length === lists.length && new Set(i.listIds).size === lists.length && lists.every((l) => i.listIds.includes(l.id));
    if (!same) throw new AppError("invalid_input", "Give every list on the show once (someone may have just added or deleted one)", 409);
    return w.update("shows", i.id, listsPatch(show, i.listIds.map((lid) => listOf(lists, lid))));
  }),
});

export const showsAddChecklistItem = defineCommand({
  name: "shows.addChecklistItem", roles: ["admin", "member"], description: "Add a to-do at the end of one of a show's checklists, optionally assigned to a musician.",
  input: z.strictObject({ ...listInput, label: z.string().trim().min(1), ownerId: ownerIn }),
  run: (ctx, i) => run(ctx, async (w) => {
    const show = await bandShow(w, i.id);
    if (i.ownerId) await requireMusician(w, i.ownerId);
    const itemId = newId();
    await editList(w, show, i.listId, (l) => ({ ...l, items: [...l.items, { id: itemId, label: i.label, done: false, ...(i.ownerId ? { ownerId: i.ownerId } : {}) }] }));
    return { id: i.id, listId: i.listId, itemId };
  }),
});

export const showsEditChecklistItem = defineCommand({
  name: "shows.editChecklistItem", roles: ["admin", "member"], description: "Change a to-do's text and who it's assigned to. Always send both label and ownerId: ownerId is required, a musician id assigns and null unassigns (omitting it is refused, so resend the current owner to keep it).",
  input: z.strictObject({ ...itemInput, label: z.string().trim().min(1), ownerId: z.string().min(1).nullable() }),
  run: (ctx, i) => run(ctx, async (w) => {
    const show = await bandShow(w, i.id);
    if (i.ownerId) await requireMusician(w, i.ownerId);
    return editItem(w, show, i.listId, i.itemId, ({ ownerId: _o, ...c }) => ({ ...c, label: i.label, ...(i.ownerId ? { ownerId: i.ownerId } : {}) }));
  }),
});

export const showsRemoveChecklistItem = defineCommand({
  name: "shows.removeChecklistItem", roles: ["admin", "member"], description: "Remove one to-do from a show's checklist.",
  input: z.strictObject(itemInput),
  run: (ctx, i) => run(ctx, async (w) => editItem(w, await bandShow(w, i.id), i.listId, i.itemId, () => null)),
});

export const showsCheckItem = defineCommand({
  name: "shows.checkItem", roles: ["admin", "member", "mcp"], description: "Tick one checklist item done or not. Anyone in the band can tick any item; ticking records who and when.",
  input: z.strictObject({ ...itemInput, done: z.boolean() }),
  run: (ctx, i) => run(ctx, async (w) => editItem(w, await bandShow(w, i.id), i.listId, i.itemId, ({ doneAt: _a, doneBy: _b, ...c }) => (
    i.done ? { ...c, done: true, doneAt: w.now.toDate().toISOString(), doneBy: ctx.uid } : { ...c, done: false }
  ))),
});

export const showsSaveChecklistAsTemplate = defineCommand({
  name: "shows.saveChecklistAsTemplate", roles: ["admin"],
  description: "Make a new checklist template (last in order) from one of a show's lists: its name and item text (no assignees, nothing done). The list is linked to it (templateId).",
  input: z.strictObject(listInput),
  run: (ctx, i) => run(ctx, async (w) => {
    const show = await bandShow(w, i.id);
    const list = listOf(checklistsOf(show as never), i.listId);
    const artistId = (await artistFor(w, show.artistId)).id;
    const t = await w.create("checklistTemplates", { artistId, name: list.name, order: nextOrder(await liveTemplates(w, artistId)), items: list.items.map((c) => ({ id: newId(), label: c.label })) });
    await editList(w, show, i.listId, (l) => ({ ...l, templateId: t.id }));
    return { id: i.id, listId: i.listId, templateId: t.id };
  }),
});

export const showsUpdateTemplateFromChecklist = defineCommand({
  name: "shows.updateTemplateFromChecklist", roles: ["admin"],
  description: "Overwrite the template a show's list came from with that list's name and item text (no assignees, nothing done). Other shows' lists are not touched.",
  input: z.strictObject(listInput),
  run: (ctx, i) => run(ctx, async (w) => {
    const show = await bandShow(w, i.id);
    const list = listOf(checklistsOf(show as never), i.listId);
    if (!list.templateId) throw new AppError("invalid_state", "This list isn't from a template: save it as one instead", 409);
    const t = await requireTemplate(w, list.templateId, show.artistId);
    await w.update("checklistTemplates", t.id, { name: list.name, items: list.items.map((c) => ({ id: newId(), label: c.label })) });
    return { id: i.id, listId: i.listId, templateId: t.id };
  }),
});

// ---------- comments (the whole band) ----------

const ownComment = async (w: Writer, showId: string, commentId: string) => {
  await requireShow(w, showId);
  const c = await w.get(`shows/${showId}/comments`, commentId);
  if (!c || c.deletedAt) throw new AppError("not_found", "Comment not found", 404);
  if (c.authorId !== w.ctx.uid) throw new AppError("forbidden", "You can only change your own comments", 403);
  return c;
};
export const showsComment = defineCommand({
  name: "shows.comment", roles: ["admin", "member", "mcp"], description: "Comment on a show. The whole band reads it (audience band).",
  input: z.strictObject({ id: z.string().min(1), body: z.string().trim().min(1) }),
  run: (ctx, i) => run(ctx, async (w) => { await requireShow(w, i.id); return w.create(`shows/${i.id}/comments`, { authorId: ctx.uid, body: i.body, audience: "band" }); }),
});
export const showsEditComment = defineCommand({
  name: "shows.editComment", roles: ["admin", "member", "mcp"], description: "Edit your own comment on a show.",
  input: z.strictObject({ id: z.string().min(1), commentId: z.string().min(1), body: z.string().trim().min(1) }),
  run: (ctx, i) => run(ctx, async (w) => { await ownComment(w, i.id, i.commentId); return w.update(`shows/${i.id}/comments`, i.commentId, { body: i.body }); }),
});
export const showsRemoveComment = defineCommand({
  name: "shows.removeComment", roles: ["admin", "member", "mcp"], description: "Delete your own comment on a show.",
  input: z.strictObject({ id: z.string().min(1), commentId: z.string().min(1) }),
  run: (ctx, i) => run(ctx, async (w) => { await ownComment(w, i.id, i.commentId); return w.softDelete(`shows/${i.id}/comments`, i.commentId); }),
});

export const showsCalendarPreview = defineCommand({
  name: "shows.calendarPreview", roles: ["admin", "mcp"], input: idInput,
  description: "Read-only: the show's event as shows.calendar would send it to the band calendar: title, start and end, location, notes, who is invited (and who has no email), and whether it creates the event or updates the one there (unchanged: nothing changed since it was sent).",
  run: (ctx, { id }) => calendarPreview(ctx, "shows", id),
});

export const showsCalendar = defineCommand({
  name: "shows.calendar", roles: ["admin", "mcp"], input: z.strictObject({ id: z.string().min(1), on: z.boolean() }),
  description: "Send the show's event to the band's Google Calendar with invites (on:true: creates it, or updates the one there to match the show), or take it off (on:false). " +
    "Saving a show never does this: show the person shows.calendarPreview first. Written with the caller's own Google account, so it fails if they can't write to the band calendar.",
  run: (ctx, i) => (i.on ? calendarSend(ctx, "shows", i.id) : calendarRemove(ctx, "shows", i.id)),
});

// ---------- deal (admin only) ----------

const dealPatch = z.strictObject({
  promoterId: z.string().nullable().optional(), editionId: z.string().nullable().optional(), contactIds: z.array(z.string()).optional(),
  deal: z.enum(["guarantee", "doorSplit", "flat", "tips", "free"]).optional(),
  doorSplitPct: z.number().int().min(0).max(100).nullable().optional(), ticketPrice: cents.nullable().optional(),
});
export const showDealsUpdate = defineCommand({
  name: "showDeals.update", roles: ["admin", "mcp"], input: z.strictObject({ id: z.string().min(1), patch: dealPatch }),
  description: "Edit the admin-only deal for a show (id is the show id): deal type, door split, ticket price, contacts. Money in is showDeals.setIncome.",
  run: (ctx, { id, patch }) => db.update(ctx, "showDeals", id, patch as Record<string, unknown>),
});

export const showDealsSetIncome = defineCommand({
  name: "showDeals.setIncome", roles: ["admin", "mcp"],
  description: "Replaces the whole list of a show's income lines (admin-only; id is the show id): read records.get showDeals first and resend every line you keep (with its id), or they are lost. Lines: [{id?, category: guarantee|door|tips|merch|other, amount (cents), method?: cash|venmo|check|square|card|bank|other, received}], and incomeNotes (null clears). Lines without an id get one.",
  input: z.strictObject({
    id: z.string().min(1),
    income: z.array(z.strictObject({ id: z.string().min(1).optional(), category: incomeCategory, amount: cents.nonnegative(), method: payMethod.optional(), received: z.boolean() })),
    incomeNotes: z.string().nullable().optional(),
  }),
  run: (ctx, i) => run(ctx, async (w) => {
    await requireShow(w, i.id);
    if (!(await w.get("showDeals", i.id))) throw new AppError("not_found", "Show deal not found", 404);
    const notes = i.incomeNotes === undefined ? {} : { incomeNotes: i.incomeNotes?.trim() || null };
    const r = await w.update("showDeals", i.id, { income: i.income.map((l) => ({ ...l, id: l.id ?? newId() })), ...notes });
    await refreshDealTotals(w, i.id);
    return r;
  }),
});

// ---------- after the show ----------

export const showsAfter = defineCommand({
  name: "shows.afterShow", roles: ["admin", "mcp"],
  description:
    "How'd it go? Rate the show and venue (1-5, both optional), notes, the crowd estimate (how many were in the room) " +
    "and paid attendance (the ticketed count). Something has to be filled in. A score left out keeps the one already " +
    "stored. Marks the show played. " +
    "A bare 'mark it played' with no rating or notes is shows.update {status:\"played\"} instead. Does NOT enter money: income lines are showDeals.setIncome, expenses shows.setExpenses.",
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
      // `crowd` sits beside paidAttendance now; a pre-migration rating.crowd is carried along so it isn't resurrected.
      const { crowd: oldCrowd, ...cur } = (deal.rating ?? {}) as Record<string, unknown>;
      await w.update("showDeals", i.id, {
        rating: {
          ...cur,
          ...(i.show !== undefined ? { show: i.show } : {}), ...(i.venue !== undefined ? { venue: i.venue } : {}),
          ...(notes ? { notes } : {}),
        },
        ...(i.crowd !== undefined ? { crowd: i.crowd } : oldCrowd !== undefined && deal.crowd === undefined ? { crowd: oldCrowd } : {}),
        ...(i.paidAttendance !== undefined ? { paidAttendance: i.paidAttendance } : {}),
      });
    });
    return done(i.id, await syncShow(ctx, i.id));
  },
});

// ---------- checklist templates (admins of the artist) ----------

const templateItems = z.array(z.strictObject({ id: z.string().min(1).optional(), label: z.string().trim().min(1) }));
const withItemIds = (items: z.infer<typeof templateItems>) => items.map((x) => ({ id: x.id ?? newId(), label: x.label }));

export const checklistTemplatesList = defineCommand({
  name: "checklistTemplates.list", roles: ["admin", "mcp"], input: z.strictObject({}),
  description: "This artist's checklist templates in order (the 'New list' choices on a show): [{id, name, order, items: [{id, label}]}].",
  run: (ctx) => run(ctx, async (w) => {
    const ts = await liveTemplates(w, (await artistFor(w)).id);
    return { templates: ts.map((t) => ({ id: t.id, name: t.name, order: t.order, items: t.items })) };
  }),
});
export const checklistTemplatesCreate = defineCommand({
  name: "checklistTemplates.create", roles: ["admin", "mcp"],
  description: "Add a checklist template (last in order): name and items [{label}]. Shows can then add it as a new list.",
  input: z.strictObject({ name: z.string().trim().min(1), items: templateItems.default([]) }),
  run: (ctx, i) => run(ctx, async (w) => {
    const artistId = (await artistFor(w)).id;
    return w.create("checklistTemplates", { artistId, name: i.name, order: nextOrder(await liveTemplates(w, artistId)), items: withItemIds(i.items) });
  }),
});
export const checklistTemplatesUpdate = defineCommand({
  name: "checklistTemplates.update", roles: ["admin", "mcp"],
  description: "Edit a checklist template: name, items (the whole list, in order: [{id?, label}]). Call checklistTemplates.list first and keep each existing item's id, or the item is recreated with a new one. Lists already on shows are not touched.",
  input: z.strictObject({ id: z.string().min(1), patch: z.strictObject({ name: z.string().trim().min(1).optional(), items: templateItems.optional() }) }),
  run: (ctx, { id, patch }) => run(ctx, async (w) => {
    await requireTemplate(w, id);
    return w.update("checklistTemplates", id, { ...(patch.name ? { name: patch.name } : {}), ...(patch.items ? { items: withItemIds(patch.items) } : {}) });
  }),
});
export const checklistTemplatesReorder = defineCommand({
  name: "checklistTemplates.reorder", roles: ["admin", "mcp"], description: "Put this artist's checklist templates in this order: ids is every template's id, once.",
  input: z.strictObject({ ids: z.array(z.string().min(1)) }),
  run: (ctx, i) => run(ctx, async (w) => {
    const ts = await liveTemplates(w, (await artistFor(w)).id);
    const same = i.ids.length === ts.length && new Set(i.ids).size === ts.length && ts.every((t) => i.ids.includes(t.id));
    if (!same) throw new AppError("invalid_input", "Give every template once (someone may have just added or deleted one)", 409);
    for (const [n, tid] of i.ids.entries()) if (ts.find((t) => t.id === tid)!.order !== n) await w.update("checklistTemplates", tid, { order: n });
    return { ids: i.ids };
  }),
});
export const checklistTemplatesRemove = defineCommand({
  name: "checklistTemplates.remove", roles: ["admin", "mcp"], input: idInput, description: "Delete a checklist template. Lists already made from it stay on their shows.",
  run: (ctx, { id }) => run(ctx, async (w) => { await requireTemplate(w, id); return w.softDelete("checklistTemplates", id); }),
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
  showsList, showsCreate, showsUpdate, showsSetStatus, showsCancel, showsDrop, showsRemove, showsSync,
  showsSetChecklists, showsAddChecklist, showsRenameChecklist, showsRemoveChecklist, showsReorderChecklists,
  showsAddChecklistItem, showsEditChecklistItem, showsRemoveChecklistItem, showsCheckItem, showsSaveChecklistAsTemplate, showsUpdateTemplateFromChecklist,
  showsSetFields, showsComment, showsEditComment, showsRemoveComment, showsCalendarPreview, showsCalendar, showDealsUpdate, showDealsSetIncome, showsAfter,
  checklistTemplatesList, checklistTemplatesCreate, checklistTemplatesUpdate, checklistTemplatesReorder, checklistTemplatesRemove,
];
