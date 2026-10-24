import { randomUUID } from "node:crypto";
import { dateInBandZone } from "@/lib/timezone";
import { z } from "zod";
import { defineCommand } from "./types";
import { idInput } from "./util";
import { db, run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import { syncShow, type SyncResult } from "../showSync";
import { noteOf } from "../venues";
import { addDays, buildChecklist, joinNames, mergeChecklist, showCity, showFilter, showName, SHOW_FILTERS, type ArtistLike, type ChecklistItem, type GearItem, type TemplateLike } from "@/lib/shows";
import { dateStr, timeStr, sound as soundSchema, cents, ChecklistTemplateInput, showKind } from "@/schema";
import { patchInput } from "./util";

const newId = () => randomUUID().slice(0, 8);
const todayServer = () => dateInBandZone();

const times = z.strictObject({
  loadIn: timeStr.optional(), soundcheck: timeStr.optional(), doors: timeStr.optional(), set: timeStr.optional(), setLength: z.number().int().min(1).optional(),
});
const needs = z.strictObject({ poster: z.boolean(), backline: z.boolean(), merch: z.boolean() });
const checklistItem = z.strictObject({ id: z.string().min(1).optional(), label: z.string().min(1), done: z.boolean().default(false), ownerId: z.string().min(1).optional(), due: dateStr.optional() });
const gearItem = z.strictObject({ id: z.string().min(1).optional(), label: z.string().min(1), musicianId: z.string().min(1).optional(), packed: z.boolean().default(false) });

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
const NO_PLACE = "Choose a venue, or give the city for a house concert";
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
async function templates(w: Writer): Promise<TemplateLike[]> {
  return (await w.query("checklistTemplates")) as unknown as TemplateLike[];
}
const done = (id: string, sync: SyncResult) => ({ id, warnings: sync.warnings, calendar: sync.calendar, bandsintown: sync.bandsintown });

// ---------- list ----------

export const showsList = defineCommand({
  name: "shows.list", roles: ["admin", "mcp"],
  description:
    "List shows by filter: upcoming, played (or confirmed with the date passed), canceled, or dropped (a hold whose date passed unconfirmed). " +
    "Always returns counts for every filter, so 'how many shows were canceled?' is one call. Without a filter, rows are every show. Upcoming soonest first, the rest newest first.",
  input: z.strictObject({ filter: z.enum(SHOW_FILTERS).optional(), limit: z.number().int().min(1).max(200).default(50) }),
  async run(_ctx, i) {
    const today = todayServer();
    const shows = (await db.list("shows")).map((s) => ({ s, f: showFilter(s as never, today) }));
    const counts = Object.fromEntries(SHOW_FILTERS.map((f) => [f, shows.filter((x) => x.f === f).length]));
    const rows = shows.filter((x) => !i.filter || x.f === i.filter)
      .sort((a, b) => (i.filter === "upcoming" ? a.s.date.localeCompare(b.s.date) : b.s.date.localeCompare(a.s.date)));
    return {
      today, filter: i.filter ?? null, counts, count: rows.length,
      shows: rows.slice(0, i.limit).map(({ s, f }) => ({ id: s.id, name: showName(s as never), date: s.date, status: s.status, filter: f, city: showCity(s as never) })),
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
    "Create a show (and its admin-only showDeal) in one step. With pitchId it is the pitch's 'Booked it': links pitch.showIds and sets the pitch to booked. " +
    "Where: venueId, or for a house concert hostContactIds (contacts) + place {city, address?} (no venue). kind: venue|house|festival|radio|other (default from the rest). " +
    "editionId links a festival year (sets editionName). " +
    "billedAs (configuration id) fills personnel; gear starts empty (shows.setGear adds it); sound defaults from the venue; needs (poster/backline/merch) and sound build the checklist from checklistTemplates. " +
    "addToCalendar (default true) adds a Google Calendar event for everyone playing. Public confirmed shows are listed on Bandsintown.",
  input: z.strictObject({
    pitchId: z.string().min(1).optional(), date: dateStr, status: z.enum(["hold", "confirmed"]).default("confirmed"),
    kind: showKind.optional(), venueId: z.string().min(1).optional(), place: place.optional(), hostContactIds: z.array(z.string().min(1)).optional(),
    editionId: z.string().min(1).optional(), editionName: z.string().optional(), times: times.default({}),
    billedAs: z.string().min(1).optional(), personnel: z.array(z.string().min(1)).optional(),
    sound: soundSchema.optional(), needs: needs.default({ poster: false, backline: false, merch: false }),
    public: z.boolean().default(false), ticketUrl: z.string().optional(), bandNotes: z.string().optional(), setlistId: z.string().min(1).optional(),
    addToCalendar: z.boolean().default(true), deal: DealIn.default({ deal: "guarantee" }),
  }),
  async run(ctx, i) {
    const id = await run(ctx, async (w) => {
      if (!i.venueId && !i.place) throw new AppError("invalid_input", NO_PLACE, 400);
      const venue = i.venueId ? await requireVenue(w, i.venueId) : null;
      const hosts = i.hostContactIds?.length ? await hostsOf(w, i.hostContactIds) : null;
      const pitch = i.pitchId ? await w.get("pitches", i.pitchId) : null;
      if (i.pitchId && (!pitch || pitch.deletedAt)) throw new AppError("not_found", "Pitch not found", 404);
      if (pitch && ctx.artistId && pitch.artistId !== ctx.artistId) throw new AppError("not_found", "Pitch not found", 404);
      const artist = await artistFor(w, pitch?.artistId);
      const billedAs = i.billedAs ?? pitch?.pitchedAs ?? undefined;
      const cfg = configOf(artist, billedAs);
      const personnel = i.personnel ?? (i.billedAs ? cfg?.musicianIds : pitch?.personnel?.length ? pitch.personnel : cfg?.musicianIds) ?? [];
      const pitchEdition = (pitch?.target as { kind: string; id: string } | undefined)?.kind === "edition" ? (pitch!.target as { id: string }).id : undefined;
      const editionId = i.editionId ?? i.deal.editionId ?? pitchEdition;
      const edition = editionId ? await requireEdition(w, editionId) : null;
      const kind = i.kind ?? (hosts && !venue ? "house" : edition ? "festival" : venue ? "venue" : "other");
      // Most house concerts run on the band's own PA.
      const snd = i.sound ?? venue?.sound ?? { provider: kind === "house" ? "bandProvided" as const : "venueProvided" as const };
      const show = { date: i.date, sound: snd, needs: i.needs };
      const r = await w.create("shows", {
        date: i.date, status: i.status, kind, venue: venue ? venueCopy(venue) : undefined, place: venue ? undefined : i.place, ...hosts,
        editionId: edition?.id, editionName: i.editionName ?? (edition ? editionLabel(edition) : undefined), times: i.times, artistId: artist.id,
        billedAs, personnel, sound: snd, needs: i.needs,
        checklist: buildChecklist(await templates(w), show, newId), gear: [],
        setlistId: i.setlistId, docs: [], public: i.public, ticketUrl: i.ticketUrl, listings: {}, bandNotes: i.bandNotes,
      });
      const d = i.deal;
      const target = pitch?.target as { kind: string; id: string } | undefined;
      await w.create("showDeals", {
        pitchId: i.pitchId, promoterId: d.promoterId ?? (target?.kind === "promoter" ? target.id : undefined),
        editionId: edition?.id ?? (target?.kind === "edition" ? target.id : undefined),
        contactIds: d.contactIds ?? (venue ? (await noteOf(w, venue, artist.id)).fields.contactIds : undefined) ?? hosts?.hostContactIds ?? [], deal: d.deal, guarantee: d.guarantee,
        doorSplitPct: d.doorSplitPct, ticketPrice: d.ticketPrice, settled: false,
      }, { id: r.id });
      if (pitch && i.pitchId) {
        await w.update("pitches", i.pitchId, { showIds: [...(pitch.showIds as string[]), r.id], ...(pitch.status === "booked" ? {} : { status: "booked" }) });
        if (pitch.status !== "booked") await w.create(`pitches/${i.pitchId}/activity`, { type: "status", fromStatus: pitch.status, toStatus: "booked", text: "Booked it" });
        for (const av of await w.query("availability", (q) => q.where("pitchId", "==", i.pitchId))) {
          if (!av.showId && av.date === i.date) await w.update("availability", av.id, { showId: r.id });
        }
      }
      if (i.setlistId) await w.update("setlists", i.setlistId, { showId: r.id });
      return r.id;
    });
    return done(id, await syncShow(ctx, id, { createCalendar: i.addToCalendar }));
  },
});

// ---------- update ----------

const SHOW_SYNC_FIELDS = ["date", "status", "venue", "place", "hostName", "times", "personnel", "billedAs", "public", "ticketUrl", "sound", "editionName", "bandNotes"];
const showPatch = z.strictObject({
  date: dateStr.optional(), status: z.enum(["hold", "confirmed", "played", "canceled"]).optional(), kind: showKind.optional(),
  venueId: z.string().min(1).nullable().optional(), place: place.nullable().optional(), hostContactIds: z.array(z.string().min(1)).optional(),
  editionId: z.string().min(1).nullable().optional(), editionName: z.string().nullable().optional(), times: times.optional(), billedAs: z.string().min(1).nullable().optional(),
  personnel: z.array(z.string().min(1)).optional(), sound: soundSchema.optional(), needs: needs.optional(),
  setlistId: z.string().min(1).nullable().optional(), docs: z.array(z.strictObject({ title: z.string(), driveFileId: z.string(), url: z.string() })).optional(),
  public: z.boolean().optional(), ticketUrl: z.string().nullable().optional(), bandNotes: z.string().nullable().optional(),
  addMissingChecklist: z.boolean().optional(),
});

export const showsUpdate = defineCommand({
  name: "shows.update", roles: ["admin", "mcp"],
  description:
    "Edit a show. Patch: date, status (hold|confirmed|played|canceled), kind, venueId (null = no venue: needs place), place {city, address?} (null clears), " +
    "hostContactIds ([] clears), editionId (null unlinks; sets editionName), times, billedAs (also refills personnel unless personnel is given), personnel, sound, needs, setlistId, docs, public, ticketUrl, bandNotes. " +
    "addMissingChecklist adds template items for the current sound/needs. " +
    "Changing date, time, venue, people, status or public re-syncs Google Calendar and Bandsintown (canceled removes both).",
  input: z.strictObject({ id: z.string().min(1), patch: showPatch }),
  async run(ctx, { id, patch }) {
    let touchesSync = false;
    await run(ctx, async (w) => {
      const before = await requireShow(w, id);
      const { venueId, hostContactIds, editionId, addMissingChecklist, ...rest } = patch;
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
      if (!hasVenue && !hasPlace) throw new AppError("invalid_input", NO_PLACE, 400);
      if (patch.billedAs !== undefined && patch.billedAs !== null) {
        const cfg = configOf(artist, patch.billedAs);
        if (!patch.personnel) p.personnel = cfg?.musicianIds;
      }
      const sound = (patch.sound ?? before.sound) as { provider: "venueProvided" | "bandProvided" };
      const billedAs = patch.billedAs === undefined ? before.billedAs : patch.billedAs ?? undefined;
      if (addMissingChecklist || patch.needs || patch.sound || patch.date) {
        const next = { date: (patch.date ?? before.date) as string, sound: { provider: sound.provider }, needs: (patch.needs ?? before.needs) as { poster: boolean; backline: boolean; merch: boolean } };
        let list = before.checklist as ChecklistItem[];
        if (patch.date && patch.date !== before.date) {
          const shift = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
          const by = shift(before.date, patch.date);
          list = list.map((c) => (c.due && !c.done ? { ...c, due: addDays(c.due, by) } : c));
        }
        p.checklist = addMissingChecklist || patch.needs || patch.sound ? mergeChecklist(list, buildChecklist(await templates(w), next, newId)) : list;
      }
      const r = await w.update("shows", id, p);
      const after = (await w.get("shows", id))!;
      touchesSync = SHOW_SYNC_FIELDS.some((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]));
      if ("setlistId" in patch && patch.setlistId !== before.setlistId) {
        if (patch.setlistId) await w.update("setlists", patch.setlistId, { showId: id });
      }
      return r;
    });
    return done(id, touchesSync ? await syncShow(ctx, id) : { warnings: [] });
  },
});

export const showsCancel = defineCommand({
  name: "shows.cancel", roles: ["admin", "mcp"], input: idInput,
  description: "Cancel a show. Removes its Google Calendar event and Bandsintown listing.",
  async run(ctx, { id }) {
    await run(ctx, async (w) => { await requireShow(w, id); return w.update("shows", id, { status: "canceled" }); });
    return done(id, await syncShow(ctx, id));
  },
});

export const showsRemove = defineCommand({
  name: "shows.remove", roles: ["admin"], input: idInput,
  description: "Archive a show (and its deal). Removes its Calendar event and Bandsintown listing.",
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
  input: z.strictObject({ id: z.string().min(1), calendar: z.boolean().optional() }),
  description: "Re-sync a show with Bandsintown (and its Calendar event). calendar:true also creates the event if it has none. Use after an error.",
  async run(ctx, i) { return done(i.id, await syncShow(ctx, i.id, { createCalendar: i.calendar })); },
});

// ---------- checklist and gear ----------

export const showsSetChecklist = defineCommand({
  name: "shows.setChecklist", roles: ["admin", "mcp"], description: "Replace a show's checklist (check off, rename, give an owner or due date, add or remove items). Items without an id get one.",
  input: z.strictObject({ id: z.string().min(1), checklist: z.array(checklistItem) }),
  run: (ctx, i) => run(ctx, async (w) => {
    await requireShow(w, i.id);
    return w.update("shows", i.id, { checklist: i.checklist.map((c) => ({ ...c, id: c.id ?? newId() })) });
  }),
});

export const showsSetGear = defineCommand({
  name: "shows.setGear", roles: ["admin", "mcp"], description: "Replace a show's gear list (edit labels, who brings what, packed). Items without an id get one.",
  input: z.strictObject({ id: z.string().min(1), gear: z.array(gearItem) }),
  run: (ctx, i) => run(ctx, async (w) => {
    await requireShow(w, i.id);
    return w.update("shows", i.id, { gear: i.gear.map((g) => ({ ...g, id: g.id ?? newId() })) });
  }),
});

export const showsPackGear = defineCommand({
  name: "shows.packGear", roles: ["admin", "member", "mcp"], description: "Mark one gear item packed or not. Members can only mark gear they are bringing.",
  input: z.strictObject({ id: z.string().min(1), itemId: z.string().min(1), packed: z.boolean() }),
  run: (ctx, i) => run(ctx, async (w) => {
    const s = await requireShow(w, i.id);
    const gear = s.gear as GearItem[];
    const item = gear.find((g) => g.id === i.itemId);
    if (!item) throw new AppError("not_found", "No such gear item", 404);
    if (ctx.role === "member" && (!ctx.musicianId || item.musicianId !== ctx.musicianId)) throw new AppError("forbidden", "You can only mark your own gear", 403);
    return w.update("shows", i.id, { gear: gear.map((g) => (g.id === i.itemId ? { ...g, packed: i.packed } : g)) });
  }),
});

export const showsCalendar = defineCommand({
  name: "shows.calendar", roles: ["admin", "mcp"], input: z.strictObject({ id: z.string().min(1), on: z.boolean() }),
  description: "Add the show to Google Calendar for everyone playing (on:true) or take it off (on:false).",
  async run(ctx, i) { return done(i.id, await syncShow(ctx, i.id, i.on ? { createCalendar: true } : { removeCalendar: true })); },
});

// ---------- deal (admin only) ----------

const dealPatch = z.strictObject({
  promoterId: z.string().nullable().optional(), editionId: z.string().nullable().optional(), contactIds: z.array(z.string()).optional(),
  deal: z.enum(["guarantee", "doorSplit", "flat", "tips", "free"]).optional(), guarantee: cents.nullable().optional(),
  doorSplitPct: z.number().int().min(0).max(100).nullable().optional(), ticketPrice: cents.nullable().optional(),
});
export const showDealsUpdate = defineCommand({
  name: "showDeals.update", roles: ["admin", "mcp"], input: z.strictObject({ id: z.string().min(1), patch: dealPatch }),
  description: "Edit the admin-only deal for a show (id is the show id): deal type, guarantee, door split, ticket price, day-of contacts.",
  run: (ctx, { id, patch }) => db.update(ctx, "showDeals", id, patch as Record<string, unknown>),
});

// ---------- after the show ----------

export const showsAfter = defineCommand({
  name: "shows.afterShow", roles: ["admin", "mcp"],
  description:
    "How'd it go? Rate the show and venue (1-5), optional crowd size and notes, and paid attendance. Marks the show played. " +
    "Does NOT enter money: use shows.settle for that.",
  input: z.strictObject({
    id: z.string().min(1), show: z.number().int().min(1).max(5), venue: z.number().int().min(1).max(5),
    crowd: z.number().int().min(0).optional(), notes: z.string().optional(), paidAttendance: z.number().int().min(0).optional(),
  }),
  async run(ctx, i) {
    await run(ctx, async (w) => {
      const s = await requireShow(w, i.id);
      if (s.status === "canceled") throw new AppError("invalid_state", "This show was canceled", 409);
      if (s.date > addDays(todayServer(), 1)) throw new AppError("too_early", "This show hasn't happened yet", 409);
      const deal = await w.get("showDeals", i.id);
      if (!deal) throw new AppError("not_found", "Show deal not found", 404);
      if (s.status !== "played") await w.update("shows", i.id, { status: "played" });
      await w.update("showDeals", i.id, {
        rating: { show: i.show, venue: i.venue, ...(i.crowd !== undefined ? { crowd: i.crowd } : {}), ...(i.notes?.trim() ? { notes: i.notes.trim() } : {}) },
        ...(i.paidAttendance !== undefined ? { paidAttendance: i.paidAttendance } : {}),
      });
    });
    return done(i.id, await syncShow(ctx, i.id));
  },
});

// ---------- checklist templates ----------

export const checklistTemplatesCreate = defineCommand({
  name: "checklistTemplates.create", roles: ["admin", "mcp"], input: ChecklistTemplateInput,
  description: "Add a checklist template: label, when (always|bandSound|venueSound|poster|backline|merch), daysBefore the show.",
  run: (ctx, input) => db.create(ctx, "checklistTemplates", input),
});
export const checklistTemplatesUpdate = defineCommand({
  name: "checklistTemplates.update", roles: ["admin", "mcp"], input: patchInput(ChecklistTemplateInput), description: "Edit a checklist template.",
  run: (ctx, { id, patch }) => db.update(ctx, "checklistTemplates", id, patch as Record<string, unknown>),
});
export const checklistTemplatesRemove = defineCommand({
  name: "checklistTemplates.remove", roles: ["admin", "mcp"], input: idInput, description: "Delete a checklist template.",
  run: (ctx, { id }) => db.softDelete(ctx, "checklistTemplates", id),
});

export const showCommands = [
  showsList, showsCreate, showsUpdate, showsCancel, showsRemove, showsSync, showsSetChecklist, showsSetGear, showsPackGear, showsCalendar,
  showDealsUpdate, showsAfter, checklistTemplatesCreate, checklistTemplatesUpdate, checklistTemplatesRemove,
];
