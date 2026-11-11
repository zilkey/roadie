/**
 * Venue calendars (issue #60): a venue's calendar setting, refreshing it, setting one up with Gemini's selectors, and the
 * band's take on each show. Roadie (the assistant) gets none of these (policy.ts): refreshing reads strangers' pages, and
 * a calendar setting is set up by hand with its preview.
 */
import { z } from "zod";
import { defineCommand } from "./types";
import { run } from "../db";
import { AppError } from "../errors";
import { artistIdOf } from "../venues";
import { BAND_TIME_ZONE } from "@/lib/timezone";
import { EVENT_TAKES, VenueCalendar, selectorFields, venueEventNoteId } from "@/schema";
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

export const venueEventsSetTake = defineCommand({
  name: "venueEvents.setTake", roles: ["admin"],
  description: "This band's take on one of a venue's shows: not a fit, interested or pitched (null clears it), and a note. Private to the band.",
  input: z.strictObject({ eventId: z.string().min(1), take: z.enum(EVENT_TAKES).nullable().optional(), note: z.string().nullable().optional(), pitchId: z.string().nullable().optional() }),
  run: (ctx, { eventId, take, note, pitchId }) => run(ctx, async (w) => {
    const ev = await db.get("venueEvents", eventId);
    if (!ev) throw new AppError("not_found", "Show not found", 404);
    const artistId = await artistIdOf(w);
    const id = venueEventNoteId(artistId, eventId);
    const existing = await w.get("venueEventNotes", id);
    const patch = { ...(take !== undefined ? { take } : {}), ...(note !== undefined ? { note: note?.trim() || null } : {}), ...(pitchId !== undefined ? { pitchId } : {}) };
    if (!existing) {
      const fields = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null));
      return w.create("venueEventNotes", { artistId, venueId: ev.venueId, eventId, ...fields }, { id });
    }
    if (existing.deletedAt) await w.restore("venueEventNotes", id);
    return w.update("venueEventNotes", id, patch);
  }),
});

export const venueEventCommands = [venuesSetCalendar, venueEventsRefresh, venueEventsPreview, venueEventsSuggest, venueEventsSetTake];
