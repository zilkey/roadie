import { randomUUID } from "node:crypto";
import { dateInBandZone } from "@/lib/timezone";
import { z } from "zod";
import { defineCommand } from "./types";
import { idInput } from "./util";
import { db, run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { syncShow, type SyncResult } from "../showSync";
import { noteOf } from "../venues";
import { addDays, buildChecklist, calendarInvitees, checklistsOf, isOff, joinNames, mergeIntoGigPrep, showCity, showFilter, showName, SHOW_FILTERS, type ArtistLike, type ChecklistLike, type TemplateLike } from "@/lib/shows";
import { dateStr, timeStr, sound as soundSchema, cents, ChecklistTemplateInput, showKind, incomeCategory, payMethod } from "@/schema";
import { refreshDealTotals } from "../dealTotals";
import { patchInput } from "./util";

const newId = () => randomUUID().slice(0, 8);
const todayServer = () => dateInBandZone();

const times = z.strictObject({
  loadIn: timeStr.optional(), soundcheck: timeStr.optional(), doors: timeStr.optional(), showStart: timeStr.optional(), set: timeStr.optional(),
  setLengthSec: z.number().int().min(1).optional(),
});
const needs = z.strictObject({ poster: z.boolean(), backline: z.boolean(), merch: z.boolean() });
const checklistItem = z.strictObject({ id: z.string().min(1).optional(), label: z.string().trim().min(1), done: z.boolean().default(false), ownerId: z.string().min(1).optional(), due: dateStr.optional() });
const checklistIn = z.strictObject({ id: z.string().min(1).optional(), name: z.string().trim().min(1), items: z.array(checklistItem) });
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
    "List shows by filter: upcoming, played (or confirmed with the date passed), canceled (they called it off), or dropped (we pulled out, or a hold whose date passed unconfirmed). " +
    "Rows carry reason (why it was canceled or dropped) when one was given. " +
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
      shows: rows.slice(0, i.limit).map(({ s, f }) => ({ id: s.id, name: showName(s as never), date: s.date, status: s.status, filter: f, city: showCity(s as never), ...(s.reason ? { reason: s.reason } : {}) })),
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
    "billedAs (configuration id) fills personnel; sound defaults from the venue; needs (poster/backline/merch) and sound build the Gig prep checklist from checklistTemplates. " +
    "times: loadIn, soundcheck, doors, showStart, set (HH:MM) and setLengthSec (seconds). deal.guarantee (cents) becomes the deal's first income line (not received). " +
    "copyPitchComments (needs pitchId) copies the pitch's comments onto the show (shows/{id}/comments), keeping each one's author and time. " +
    "billedAs null means explicitly no configuration (no fallback to the pitch's, no personnel); omitted falls back to the pitch's. " +
    "addToCalendar (default true) adds a Google Calendar event. sendInvites true invites only the configuration's members who are on the team and have an email, false invites nobody (the choice sticks on later syncs); omitted invites everyone in personnel with an email. publishToBandsintown lists the show on Bandsintown once it is confirmed.",
  input: z.strictObject({
    pitchId: z.string().min(1).optional(), date: dateStr, status: z.enum(["hold", "confirmed"]).default("confirmed"),
    kind: showKind.optional(), venueId: z.string().min(1).optional(), place: place.optional(), hostContactIds: z.array(z.string().min(1)).optional(),
    editionId: z.string().min(1).optional(), editionName: z.string().optional(), times: times.default({}),
    billedAs: z.string().min(1).nullable().optional(), personnel: z.array(z.string().min(1)).optional(), sendInvites: z.boolean().optional(),
    sound: soundSchema.optional(), needs: needs.default({ poster: false, backline: false, merch: false }),
    publishToBandsintown: z.boolean().default(false), ticketUrl: z.string().optional(), setlistId: z.string().min(1).optional(), dayOfContact: dayOfContact.optional(),
    addToCalendar: z.boolean().default(true), copyPitchComments: z.boolean().default(false), deal: DealIn.default({ deal: "guarantee" }),
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
      const billedAs = i.billedAs === null ? undefined : i.billedAs ?? pitch?.pitchedAs ?? undefined;
      const cfg = configOf(artist, billedAs);
      const personnel = i.personnel ?? (i.billedAs !== undefined ? cfg?.musicianIds : pitch?.personnel?.length ? pitch.personnel : cfg?.musicianIds) ?? [];
      const calendarInviteeIds = i.sendInvites === undefined ? undefined
        : i.sendInvites ? calendarInvitees(cfg?.musicianIds ?? [], await w.query("musicians"), await w.query("users"), artist.id) : [];
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
        billedAs, personnel, calendarInviteeIds, sound: snd, needs: i.needs,
        checklists: mergeIntoGigPrep([], buildChecklist(await templates(w), show, newId), newId),
        setlistId: i.setlistId, docs: [], publishToBandsintown: i.publishToBandsintown, ticketUrl: i.ticketUrl, listings: {}, dayOfContact: i.dayOfContact,
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
      if (i.setlistId) await w.update("setlists", i.setlistId, { showId: r.id });
      return r.id;
    });
    return done(id, await syncShow(ctx, id, { createCalendar: i.addToCalendar }));
  },
});

// ---------- update ----------

const SHOW_SYNC_FIELDS = ["date", "status", "venue", "place", "hostName", "times", "personnel", "billedAs", "publishToBandsintown", "public", "ticketUrl", "sound", "editionName", "dayOfContact"];
const showPatch = z.strictObject({
  date: dateStr.optional(), status: z.enum(["hold", "confirmed", "played", "canceled", "dropped"]).optional(), reason: z.string().nullable().optional(), kind: showKind.optional(),
  venueId: z.string().min(1).nullable().optional(), place: place.nullable().optional(), hostContactIds: z.array(z.string().min(1)).optional(),
  editionId: z.string().min(1).nullable().optional(), editionName: z.string().nullable().optional(), times: times.optional(), billedAs: z.string().min(1).nullable().optional(),
  personnel: z.array(z.string().min(1)).optional(), sound: soundSchema.optional(), needs: needs.optional(),
  setlistId: z.string().min(1).nullable().optional(), docs: z.array(z.strictObject({ title: z.string(), driveFileId: z.string(), url: z.string() })).optional(),
  publishToBandsintown: z.boolean().optional(), ticketUrl: z.string().nullable().optional(), dayOfContact: dayOfContact.nullable().optional(),
  addMissingChecklist: z.boolean().optional(),
});

export const showsUpdate = defineCommand({
  name: "shows.update", roles: ["admin", "mcp"],
  description:
    "Edit a show. Patch: date, status (hold|confirmed|played|canceled|dropped; prefer shows.cancel / shows.drop), reason (why it was canceled or dropped; null clears), kind, venueId (null = no venue: needs place), place {city, address?} (null clears), " +
    "hostContactIds ([] clears), editionId (null unlinks; sets editionName), times {loadIn, soundcheck, doors, showStart, set, setLengthSec}, billedAs (also refills personnel unless personnel is given), personnel, sound, needs, setlistId, docs, publishToBandsintown (listed once confirmed), ticketUrl, " +
    "dayOfContact {name, phone?, contactId?} (null clears). A status change is added to statusHistory. " +
    "addMissingChecklist adds template items for the current sound/needs to the Gig prep list. " +
    "Changing date, time, venue, people, status or publishToBandsintown re-syncs Google Calendar and Bandsintown (canceled or dropped removes both).",
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
        let lists = checklistsOf(before as never);
        if (patch.date && patch.date !== before.date) {
          const shift = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
          const by = shift(before.date, patch.date);
          lists = lists.map((l) => ({ ...l, items: l.items.map((c) => (c.due && !c.done ? { ...c, due: addDays(c.due, by) } : c)) }));
        }
        if (addMissingChecklist || patch.needs || patch.sound) lists = mergeIntoGigPrep(lists, buildChecklist(await templates(w), next, newId), newId);
        Object.assign(p, listsPatch(before, lists));
      }
      if (patch.status && patch.status !== before.status) p.statusHistory = historyWith(w, before, patch.status, patch.reason ?? undefined);
      if (patch.publishToBandsintown !== undefined && before.public !== undefined) p.public = null;
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
    "Each change is kept in statusHistory with who and when. Canceled or dropped removes its Calendar event and Bandsintown listing.",
  input: z.strictObject({ id: z.string().min(1), status: z.enum(["hold", "confirmed", "canceled", "dropped"]), reason: z.string().optional() }),
  run: (ctx, i) => setStatus(ctx, i, i.status),
});

export const showsCancel = defineCommand({
  name: "shows.cancel", roles: ["admin", "mcp"], input: offInput,
  description: "Cancel a show: they called it off (dropped means we pulled out). Optional reason. Removes its Google Calendar event and Bandsintown listing.",
  run: (ctx, i) => setOff(ctx, i, "canceled"),
});

export const showsDrop = defineCommand({
  name: "shows.drop", roles: ["admin", "mcp"], input: offInput,
  description: "Drop a show: we pulled out (canceled means they called it off). Optional reason. Removes its Calendar event and Bandsintown listing.",
  run: (ctx, i) => setOff(ctx, i, "dropped"),
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

// ---------- checklists ----------

export const showsSetChecklists = defineCommand({
  name: "shows.setChecklists", roles: ["admin", "mcp"],
  description: "Replace all of a show's checklists: [{id?, name, items: [{id?, label, done, ownerId? (musician), due?}]}]. Gear is a checklist named Gear (ownerId = who brings it). Lists and items without an id get one.",
  input: z.strictObject({ id: z.string().min(1), checklists: z.array(checklistIn) }),
  run: (ctx, i) => run(ctx, async (w) => {
    const before = await requireShow(w, i.id);
    const lists = i.checklists.map((l) => ({ ...l, id: l.id ?? newId(), items: l.items.map((c) => ({ ...c, id: c.id ?? newId() })) }));
    return w.update("shows", i.id, listsPatch(before, lists));
  }),
});

export const showsCheckItem = defineCommand({
  name: "shows.checkItem", roles: ["admin", "member", "mcp"], description: "Tick one checklist item done (or packed) or not. Members can only tick items assigned to them.",
  input: z.strictObject({ id: z.string().min(1), listId: z.string().min(1), itemId: z.string().min(1), done: z.boolean() }),
  run: (ctx, i) => run(ctx, async (w) => {
    const s = await requireShow(w, i.id);
    const lists = checklistsOf(s as never);
    const item = lists.find((l) => l.id === i.listId)?.items.find((c) => c.id === i.itemId);
    if (!item) throw new AppError("not_found", "No such checklist item", 404);
    if (ctx.role === "member" && (!ctx.musicianId || item.ownerId !== ctx.musicianId)) throw new AppError("forbidden", "You can only tick items assigned to you", 403);
    return w.update("shows", i.id, listsPatch(s, lists.map((l) => (l.id !== i.listId ? l : { ...l, items: l.items.map((c) => (c.id === i.itemId ? { ...c, done: i.done } : c)) }))));
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

export const showsCalendar = defineCommand({
  name: "shows.calendar", roles: ["admin", "mcp"], input: z.strictObject({ id: z.string().min(1), on: z.boolean() }),
  description: "Add the show to Google Calendar for everyone playing (on:true) or take it off (on:false).",
  async run(ctx, i) { return done(i.id, await syncShow(ctx, i.id, i.on ? { createCalendar: true } : { removeCalendar: true })); },
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
  description: "Replace a show's income lines (admin-only; id is the show id): [{id?, category: guarantee|door|tips|merch|other, amount (cents), method?: cash|venmo|check|square|card|bank|other, received}], and incomeNotes (null clears). Lines without an id get one.",
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
    "How'd it go? Rate the show and venue (1-5), optional crowd size and notes, and paid attendance. Marks the show played. " +
    "Does NOT enter money: income lines are showDeals.setIncome, expenses shows.setExpenses.",
  input: z.strictObject({
    id: z.string().min(1), show: z.number().int().min(1).max(5), venue: z.number().int().min(1).max(5),
    crowd: z.number().int().min(0).optional(), notes: z.string().optional(), paidAttendance: z.number().int().min(0).optional(),
  }),
  async run(ctx, i) {
    await run(ctx, async (w) => {
      const s = await requireShow(w, i.id);
      if (isOff(s)) throw new AppError("invalid_state", `This show was ${s.status}`, 409);
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
  showsList, showsCreate, showsUpdate, showsSetStatus, showsCancel, showsDrop, showsRemove, showsSync, showsSetChecklists, showsCheckItem,
  showsComment, showsEditComment, showsRemoveComment, showsCalendar, showDealsUpdate, showDealsSetIncome, showsAfter, checklistTemplatesCreate, checklistTemplatesUpdate, checklistTemplatesRemove,
];
