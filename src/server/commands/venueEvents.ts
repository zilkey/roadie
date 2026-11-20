/**
 * Venue calendars (issue #60): a venue's calendar setting, refreshing it, setting one up with Gemini's selectors, and the
 * band's take on each show. Roadie (the assistant) gets none of these (policy.ts): refreshing reads strangers' pages, and
 * a calendar setting is set up by hand with its preview.
 */
import { spend } from "../usage";
import { z } from "zod";
import { defineCommand } from "./types";
import { SHARED_EDIT_NOTE } from "../platform";
import { run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import { artistIdOf } from "../venues";
import { pathOf } from "@/schema/owners";
import type { Ctx } from "../ctx";
import { lookAtCalendars } from "../prefs";
import { venueZoneOr, zoneOf } from "../zone";
import { SHOW_TAKES, VenueCalendar, selectorFields, venueEventNoteId, type Act, type OpenerSlot } from "@/schema";
import { firestore } from "../admin";
import { sortedDates } from "@/lib/booking";
import { fmtEventDay } from "@/lib/venueEvents";
import { flagPitch } from "./booking";
import { db } from "../db";
import { Net } from "../events/fetch";
import { readCalendar, refreshVenue } from "../events/refresh";
import { suggestSelectors } from "../events/suggest";

const PREVIEW_ROWS = 40;

async function venueTz(ctx: Ctx, venueId: string | undefined) {
  if (!venueId) return zoneOf(ctx);
  const v = await db.get(ctx, "venues", venueId);
  if (!v || v.deletedAt) throw new AppError("not_found", "Venue not found", 404);
  return venueZoneOr(v, await zoneOf(ctx));
}

export const venuesSetCalendar = defineCommand({
  name: "venues.setCalendar", roles: ["admin"],
  description: "Set (or clear, with null) where a venue's event calendar is and how to read it. Shared with every band." + SHARED_EDIT_NOTE,
  input: z.strictObject({ id: z.string().min(1), calendar: VenueCalendar.nullable() }),
  run: (ctx, { id, calendar }) => run(ctx, async (w) => {
    const v = await w.get("venues", id);
    if (!v || v.deletedAt) throw new AppError("not_found", "Venue not found", 404);
    return w.update("venues", id, { calendar });
  }),
});

export const venueEventsRefresh = defineCommand({
  name: "venueEvents.refresh", roles: ["admin", "member"],
  description: "Read a venue's calendar now and update its upcoming shows.",
  input: z.strictObject({ venueId: z.string().min(1) }),
  // A press of Refresh reads the calendar (and may ask the model): one web lookup for the artist (the nightly/system refresh isn't charged).
  run: async (ctx, { venueId }) => { await spend(ctx, "webLookups"); return refreshVenue(venueId); },
});

export const venueEventsPreview = defineCommand({
  name: "venueEvents.preview", roles: ["admin"],
  description: "Read a calendar setting without saving anything: the shows it would find.",
  input: z.strictObject({ venueId: z.string().min(1).optional(), calendar: VenueCalendar }),
  run: async (ctx, { venueId, calendar }) => {
    const out = await readCalendar(calendar, { net: new Net(), tz: await venueTz(ctx, venueId), now: new Date() });
    return { count: out.events.length, unparsed: out.unparsed, dropped: out.dropped, raw: out.raw, events: out.events.slice(0, PREVIEW_ROWS) };
  },
});

export const venueEventsSuggest = defineCommand({
  name: "venueEvents.suggestSelectors", roles: ["admin"],
  description: "Fetch a calendar page and have Gemini propose CSS selectors for it; returns them with the shows they find.",
  input: z.strictObject({
    venueId: z.string().min(1).optional(), url: z.string().url(), hint: z.string().max(500).optional(), problems: z.string().max(1000).optional(),
    previous: z.strictObject({ item: z.string(), fields: selectorFields, dateFormat: z.string().optional() }).optional(),
  }),
  run: async (ctx, { venueId, url, hint, problems, previous }) => {
    await spend(ctx, "webLookups");
    const net = new Net();
    const s = await suggestSelectors(url, { net, hint, problems, previous });
    const calendar: VenueCalendar = { type: "selectors", url, item: s.config.item, fields: s.config.fields, ...(s.config.dateFormat ? { dateFormat: s.config.dateFormat } : {}) };
    const out = await readCalendar(calendar, { net, tz: await venueTz(ctx, venueId), now: new Date() });
    return { calendar, notes: s.notes, model: s.model, count: out.events.length, unparsed: out.unparsed, dropped: out.dropped, raw: out.raw, events: out.events.slice(0, PREVIEW_ROWS) };
  },
});

/** Upsert this band's note on a show (venueEventNotes/{artistId}__{eventId}): nulls clear a field, undefined leaves it. */
async function setEventNote(w: Writer, ev: Doc, patch: Record<string, unknown>) {
  const artistId = await artistIdOf(w);
  const id = venueEventNoteId(artistId, ev.id);
  const existing = await w.get("venueEventNotes", id);
  if (!existing) {
    const fields = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null));
    return w.create("venueEventNotes", { venueId: ev.venueId, eventId: ev.id, ...fields }, { id });
  }
  if (existing.deletedAt) await w.restore("venueEventNotes", id);
  return w.update("venueEventNotes", id, patch);
}
async function requireEvent(ctx: Ctx, eventId: string) {
  const ev = await db.get(ctx, "venueEvents", eventId);
  if (!ev) throw new AppError("not_found", "Show not found", 404);
  return ev;
}

export const venueEventsSetTake = defineCommand({
  name: "venueEvents.setTake", roles: ["admin"],
  description: "This band's take on one of a venue's shows: notFit (null clears it), and a note. Private to the band. We pitch the venue, not the show: venueEvents.pitch adds the show to the venue's pitch.",
  input: z.strictObject({ eventId: z.string().min(1), take: z.enum(SHOW_TAKES).nullable().optional(), note: z.string().nullable().optional(), pitchId: z.string().nullable().optional() }),
  run: (ctx, { eventId, take, note, pitchId }) => run(ctx, async (w) => {
    const ev = await requireEvent(ctx, eventId);
    return setEventNote(w, ev, { ...(take !== undefined ? { take } : {}), ...(note !== undefined ? { note: note?.trim() || null } : {}), ...(pitchId !== undefined ? { pitchId } : {}) });
  }),
});

/** "Tin Cup Jane": the show's headliner, else its listed title. */
const showName = (ev: Doc) => (ev.acts as Act[]).find((a) => a.role === "headliner")?.name ?? String(ev.title);

export const venueEventsPitch = defineCommand({
  name: "venueEvents.pitch", roles: ["admin"],
  description: "Pitch this: add one of a venue's shows to the venue's pitch. Puts the venue on the Pitch List when it isn't (or uses its open pitch), " +
    "adds the show's date to the pitch's dates, logs it on the pitch's timeline and links the pitch to the show (clearing a Not a fit take). " +
    "campaignId: the booking campaign a new pitch goes in (never moves the venue's existing pitch; pitches.setCampaign does). Returns { pitchId, existing, campaignId } (the pitch's campaign).",
  input: z.strictObject({ eventId: z.string().min(1), campaignId: z.string().min(1).optional() }),
  run: (ctx, { eventId, campaignId }) => run(ctx, async (w) => {
    const ev = await requireEvent(ctx, eventId);
    const date = String(ev.date);
    const r = await flagPitch(w, ctx, { kind: "venue", id: String(ev.venueId), dates: [date], ...(campaignId ? { campaignId } : {}) });
    if (r.existing) {
      const p = await w.get("pitches", r.id);
      const dates = (p?.dates as string[] | undefined) ?? [];
      if (!dates.includes(date)) await w.update("pitches", r.id, { dates: sortedDates([...dates, date]) });
    }
    await w.create(pathOf("activity", { artistId: w.ctx.artistId, parent: { kind: "pitches", id: r.id } }), { type: "note", text: `Added ${showName(ev)} on ${fmtEventDay(date)} (from the venue's calendar)` });
    const note = await w.get("venueEventNotes", venueEventNoteId(await artistIdOf(w), eventId));
    await setEventNote(w, ev, { pitchId: r.id, ...(note?.take ? { take: null } : {}) });
    return { pitchId: r.id, existing: r.existing, campaignId: r.campaignId };
  }),
});

export const venueEventsUnpitch = defineCommand({
  name: "venueEvents.unpitch", roles: ["admin"],
  description: "Take one of a venue's shows off the venue's pitch: unlinks it, takes its date off the pitch's dates (unless another show on the pitch is that day) and logs it. The pitch stays on the Pitch List (pitches.remove takes it off).",
  input: z.strictObject({ eventId: z.string().min(1) }),
  run: (ctx, { eventId }) => run(ctx, async (w) => {
    const ev = await requireEvent(ctx, eventId);
    const artistId = await artistIdOf(w);
    const note = await w.get("venueEventNotes", venueEventNoteId(artistId, eventId));
    const pitchId = note?.pitchId as string | undefined;
    if (!pitchId) return { pitchId: null };
    const p = await w.get("pitches", pitchId);
    if (p && !p.deletedAt) {
      const date = String(ev.date);
      const others = (await w.query("venueEventNotes", (q) => q.where("pitchId", "==", pitchId)))
        .filter((n) => n.eventId !== eventId && !n.deletedAt);
      const othersOnDay = (await Promise.all(others.map((n) => w.get("venueEvents", String(n.eventId))))).some((o) => o?.date === date);
      const dates = (p.dates as string[] | undefined) ?? [];
      if (!othersOnDay && dates.includes(date)) await w.update("pitches", pitchId, { dates: dates.filter((d) => d !== date) });
      await w.create(pathOf("activity", { artistId: w.ctx.artistId, parent: { kind: "pitches", id: pitchId } }), { type: "note", text: `Took ${showName(ev)} on ${fmtEventDay(date)} off the pitch` });
    }
    await setEventNote(w, ev, { pitchId: null });
    return { pitchId };
  }),
});

export const venueEventsSetOpenerSlot = defineCommand({
  name: "venueEvents.setOpenerSlot", roles: ["admin"],
  description: "Say whether one of a venue's shows has an opener slot to pitch (the badge's x is false, \"+ Opener slot\" is true). " +
    "Shared: every band sees the show's badge. A refresh never changes what a person set.",
  input: z.strictObject({ eventId: z.string().min(1), open: z.boolean() }),
  run: async (ctx, { eventId, open }) => {
    await requireEvent(ctx, eventId);
    // A fact about the show, not the room's house facts: written like refresh writes the show (no shared-edit approval, no History).
    const openerSlot: OpenerSlot = { open, by: "person", at: new Date().toISOString() };
    await firestore().doc(`venueEvents/${eventId}`).update({ openerSlot });
    return { eventId, openerSlot };
  },
});

export const venueEventsLooked = defineCommand({
  name: "venueEvents.looked", roles: ["admin", "member"], input: z.strictObject({}),
  description: "Remember that the caller just opened Booking's Venue calendars; returns when they last looked before (null the first time), for its New chips. Personal: nobody else's chips change.",
  async run(ctx) {
    return { previous: await lookAtCalendars(ctx.uid, ctx.artistId, new Date().toISOString()) };
  },
});

export const venueEventCommands = [venueEventsLooked, venuesSetCalendar, venueEventsRefresh, venueEventsPreview, venueEventsSuggest, venueEventsSetTake, venueEventsSetOpenerSlot, venueEventsPitch, venueEventsUnpitch];
