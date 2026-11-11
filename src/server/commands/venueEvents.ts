/**
 * Venue calendars (issue #60): a venue's calendar setting, refreshing it, setting one up with Gemini's selectors, and the
 * band's take on each show. Roadie (the assistant) gets none of these (policy.ts): refreshing reads strangers' pages, and
 * a calendar setting is set up by hand with its preview.
 */
import { z } from "zod";
import { defineCommand } from "./types";
import { run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import { artistIdOf, callerArtistId } from "../venues";
import { lookAtCalendars } from "../prefs";
import { BAND_TIME_ZONE } from "@/lib/timezone";
import { EVENT_TAKES, VenueCalendar, selectorFields, venueEventNoteId, type Act } from "@/schema";
import { sortedDates } from "@/lib/booking";
import { fmtEventDay } from "@/lib/venueEvents";
import { flagPitch } from "./booking";
import { db } from "../db";
import { Net } from "../events/fetch";
import { readCalendar, refreshVenue } from "../events/refresh";
import { suggestSelectors } from "../events/suggest";

const PREVIEW_ROWS = 40;

async function venueTz(venueId: string | undefined) {
  if (!venueId) return BAND_TIME_ZONE;
  const v = await db.get("venues", venueId);
  if (!v || v.deletedAt) throw new AppError("not_found", "Venue not found", 404);
  return (v.timeZone as string | undefined) || BAND_TIME_ZONE;
}

export const venuesSetCalendar = defineCommand({
  name: "venues.setCalendar", roles: ["admin"],
  description: "Set (or clear, with null) where a venue's event calendar is and how to read it. Shared with every band.",
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
  run: (_ctx, { venueId }) => refreshVenue(venueId),
});

export const venueEventsPreview = defineCommand({
  name: "venueEvents.preview", roles: ["admin"],
  description: "Read a calendar setting without saving anything: the shows it would find.",
  input: z.strictObject({ venueId: z.string().min(1).optional(), calendar: VenueCalendar }),
  run: async (_ctx, { venueId, calendar }) => {
    const out = await readCalendar(calendar, { net: new Net(), tz: await venueTz(venueId), now: new Date() });
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
  run: async (_ctx, { venueId, url, hint, problems, previous }) => {
    const net = new Net();
    const s = await suggestSelectors(url, { net, hint, problems, previous });
    const calendar: VenueCalendar = { type: "selectors", url, item: s.config.item, fields: s.config.fields, ...(s.config.dateFormat ? { dateFormat: s.config.dateFormat } : {}) };
    const out = await readCalendar(calendar, { net, tz: await venueTz(venueId), now: new Date() });
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
    return w.create("venueEventNotes", { artistId, venueId: ev.venueId, eventId: ev.id, ...fields }, { id });
  }
  if (existing.deletedAt) await w.restore("venueEventNotes", id);
  return w.update("venueEventNotes", id, patch);
}
async function requireEvent(eventId: string) {
  const ev = await db.get("venueEvents", eventId);
  if (!ev) throw new AppError("not_found", "Show not found", 404);
  return ev;
}

export const venueEventsSetTake = defineCommand({
  name: "venueEvents.setTake", roles: ["admin"],
  description: "This band's take on one of a venue's shows: not a fit, interested or pitched (null clears it), and a note. Private to the band.",
  input: z.strictObject({ eventId: z.string().min(1), take: z.enum(EVENT_TAKES).nullable().optional(), note: z.string().nullable().optional(), pitchId: z.string().nullable().optional() }),
  run: (ctx, { eventId, take, note, pitchId }) => run(ctx, async (w) => {
    const ev = await requireEvent(eventId);
    return setEventNote(w, ev, { ...(take !== undefined ? { take } : {}), ...(note !== undefined ? { note: note?.trim() || null } : {}), ...(pitchId !== undefined ? { pitchId } : {}) });
  }),
});

/** What a show's pitch asks for (#79): to open for its headliner that night, or for a night of our own. */
export const PITCH_ASKS = ["open", "another"] as const;

export const venueEventsPitch = defineCommand({
  name: "venueEvents.pitch", roles: ["admin"],
  description: "Pitch a venue from one of its shows (#79): puts the venue on the Pitch List (or uses its open pitch), adds the show's date when asking to open for the headliner, logs what we're asking for on the pitch's timeline, sets our take on the show to Pitched and links the pitch to it.",
  input: z.strictObject({ eventId: z.string().min(1), ask: z.enum(PITCH_ASKS) }),
  run: (ctx, { eventId, ask }) => run(ctx, async (w) => {
    const ev = await requireEvent(eventId);
    const head = (ev.acts as Act[]).find((a) => a.role === "headliner")?.name ?? String(ev.title);
    const date = String(ev.date);
    const r = await flagPitch(w, ctx, { kind: "venue", id: String(ev.venueId), ...(ask === "open" ? { dates: [date] } : {}) });
    if (r.existing && ask === "open") {
      const p = await w.get("pitches", r.id);
      const dates = (p?.dates as string[] | undefined) ?? [];
      if (!dates.includes(date)) await w.update("pitches", r.id, { dates: sortedDates([...dates, date]) });
    }
    const day = fmtEventDay(date);
    await w.create(`pitches/${r.id}/activity`, {
      type: "note", text: ask === "open" ? `Asking to open for ${head} on ${day} (from the venue's calendar)` : `Saw ${head} on ${day} on the venue's calendar: asking to play another night`,
    });
    await setEventNote(w, ev, { take: "pitched", pitchId: r.id });
    return { pitchId: r.id, existing: r.existing };
  }),
});

export const venueEventsLooked = defineCommand({
  name: "venueEvents.looked", roles: ["admin", "member"], input: z.strictObject({}),
  description: "Remember that the caller just opened Booking's Venue calendars; returns when they last looked before (null the first time), for its New chips. Personal: nobody else's chips change.",
  async run(ctx) {
    const artistId = await callerArtistId(ctx);
    if (!artistId) throw new AppError("invalid_input", "Which artist? Open one first", 400);
    return { previous: await lookAtCalendars(ctx.uid, artistId, new Date().toISOString()) };
  },
});

export const venueEventCommands = [venueEventsLooked, venuesSetCalendar, venueEventsRefresh, venueEventsPreview, venueEventsSuggest, venueEventsSetTake, venueEventsPitch];
