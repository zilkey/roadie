/**
 * Google Calendar integration. Real implementation later: Calendar API v3 (events.insert/patch/delete/list,
 * sendUpdates=all) with scope calendar.events (see docs/FIREBASE-SETUP.md).
 */
import { jsonClient } from "./http";

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

export function calendarClient(baseUrl = process.env.CALENDAR_BASE_URL ?? "http://127.0.0.1:3203"): CalendarService {
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
