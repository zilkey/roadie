/**
 * Google Calendar. Two implementations of CalendarService: the fake's HTTP client (fakes/fake-calendar; dev and tests) and
 * the Calendar API v3 (events.insert/patch/delete/get/list, sendUpdates=all so attendees get invites and changes), chosen
 * by calendarClient(). The real one writes to the band account's primary calendar (src/server/google/band.ts).
 * Start and end are local times ("2026-11-07T18:00:00") with a timeZone, as src/server/showSync.ts builds them.
 */
import { IntegrationError, jsonClient } from "./http";
import { googleJson, useRealGoogle, type TokenSource } from "./google";
import { bandToken } from "../google/band";

export interface CalAttendee { email: string; responseStatus: "needsAction" | "accepted" | "declined" | "tentative" }
export interface CalEvent { id: string; calendarId: string; title: string; start: string; end: string; location?: string; description?: string; timeZone?: string; attendees: CalAttendee[]; createdAt: string; updatedAt: string }
export interface CalEventInput { title: string; start: string; end: string; location?: string; description?: string; timeZone?: string; attendees?: string[]; calendarId?: string }

export interface CalendarService {
  create(input: CalEventInput): Promise<CalEvent>;
  update(id: string, patch: Partial<CalEventInput>): Promise<CalEvent>;
  delete(id: string): Promise<void>;
  get(id: string): Promise<CalEvent>;
  list(opts?: { from?: string; to?: string; calendarId?: string }): Promise<CalEvent[]>;
}

/** The real Calendar API when Google is configured and CALENDAR_BASE_URL isn't set (as the band account); otherwise the fake. A string is the fake's base URL (tests). */
export function calendarClient(opts: string | { artistId?: string } = {}): CalendarService {
  const baseUrl = typeof opts === "string" ? opts : undefined;
  if (useRealGoogle(process.env.CALENDAR_BASE_URL, baseUrl)) return googleCalendar((force) => bandToken((opts as { artistId?: string }).artistId, "calendar", force));
  return fakeCalendarClient(baseUrl ?? process.env.CALENDAR_BASE_URL ?? "http://127.0.0.1:3203");
}

export function fakeCalendarClient(baseUrl: string): CalendarService {
  const call = jsonClient("calendar", baseUrl);
  const e = (id: string) => `/events/${encodeURIComponent(id)}`;
  return {
    create: (input) => call("POST", "/events", { body: input }),
    update: (id, patch) => call("PATCH", e(id), { body: patch }),
    delete: async (id) => { await call("DELETE", e(id)); },
    get: (id) => call("GET", e(id)),
    list: (o = {}) => call("GET", "/events", { query: o }),
  };
}

// ---------- the Calendar API ----------

interface GTime { dateTime?: string; date?: string; timeZone?: string }
interface GEvent {
  id: string; status?: string; summary?: string; location?: string; description?: string; start?: GTime; end?: GTime;
  attendees?: { email: string; responseStatus?: CalAttendee["responseStatus"] }[]; created?: string; updated?: string;
}

const toEvent = (e: GEvent, calendarId: string): CalEvent => ({
  id: e.id, calendarId, title: e.summary ?? "", start: e.start?.dateTime ?? e.start?.date ?? "", end: e.end?.dateTime ?? e.end?.date ?? "",
  ...(e.location ? { location: e.location } : {}), ...(e.description ? { description: e.description } : {}), ...(e.start?.timeZone ? { timeZone: e.start.timeZone } : {}),
  attendees: (e.attendees ?? []).map((a) => ({ email: a.email, responseStatus: a.responseStatus ?? "needsAction" })), createdAt: e.created ?? "", updatedAt: e.updated ?? "",
});

/** RFC 3339 for timeMin/timeMax; a bare date means midnight UTC. */
const instant = (v?: string) => (v ? (v.includes("T") ? v : `${v}T00:00:00Z`) : undefined);

export function googleCalendar(token: TokenSource, defaultCalendarId = "primary", baseUrl = "https://www.googleapis.com/calendar/v3"): CalendarService {
  const call = googleJson("calendar", baseUrl, token);
  const events = (cal: string) => `/calendars/${encodeURIComponent(cal)}/events`;
  const e = (id: string, cal = defaultCalendarId) => `${events(cal)}/${encodeURIComponent(id)}`;
  // A deleted event answers 410 Gone; callers treat that as not found.
  const gone = (err: unknown): never => { throw err instanceof IntegrationError && err.status === 410 ? new IntegrationError("calendar", 404, err.message) : err; };
  const time = (dateTime: string, timeZone?: string): GTime => ({ dateTime, ...(timeZone ? { timeZone } : {}) });
  const get = async (id: string) => toEvent(await call<GEvent>("GET", e(id)).catch(gone), defaultCalendarId);

  return {
    async create(i) {
      const cal = i.calendarId ?? defaultCalendarId;
      const ev = await call<GEvent>("POST", events(cal), {
        query: { sendUpdates: "all" },
        body: {
          summary: i.title, location: i.location, description: i.description, start: time(i.start, i.timeZone), end: time(i.end, i.timeZone),
          attendees: (i.attendees ?? []).map((email) => ({ email })),
        },
      });
      return toEvent(ev, cal);
    },
    async update(id, p) {
      const cur = await get(id);
      const tz = p.timeZone ?? cur.timeZone;
      const body: Record<string, unknown> = {
        // The show still exists, so an event someone deleted in Calendar comes back.
        status: "confirmed",
        ...(p.title !== undefined ? { summary: p.title } : {}), ...(p.location !== undefined ? { location: p.location } : {}),
        ...(p.description !== undefined ? { description: p.description } : {}),
        ...(p.start !== undefined ? { start: time(p.start, tz) } : {}), ...(p.end !== undefined ? { end: time(p.end, tz) } : {}),
      };
      // Keep the answers people already gave.
      if (p.attendees !== undefined) body.attendees = p.attendees.map((email) => ({ email, responseStatus: cur.attendees.find((a) => a.email.toLowerCase() === email.toLowerCase())?.responseStatus ?? "needsAction" }));
      return toEvent(await call<GEvent>("PATCH", e(id), { query: { sendUpdates: "all" }, body }).catch(gone), defaultCalendarId);
    },
    async delete(id) {
      await call("DELETE", e(id), { query: { sendUpdates: "all" } }).catch(gone);
    },
    get,
    async list(o = {}) {
      const cal = o.calendarId ?? defaultCalendarId;
      const r = await call<{ items?: GEvent[] }>("GET", events(cal), {
        query: { timeMin: instant(o.from), timeMax: instant(o.to), singleEvents: "true", orderBy: "startTime", maxResults: "250" },
      });
      return (r.items ?? []).filter((x) => x.status !== "cancelled").map((x) => toEvent(x, cal));
    },
  };
}
