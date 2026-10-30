import { defineFake, runIfMain, esc, need, required, HttpError, type Route } from "../lib";

export interface CalAttendee { email: string; responseStatus: "needsAction" | "accepted" | "declined" | "tentative" }
export interface CalEvent {
  id: string; calendarId: string; title: string; start: string; end: string; location?: string; description?: string; timeZone?: string;
  attendees: CalAttendee[]; createdAt: string; updatedAt: string;
  /** Deleted, like Google: still answers GET until purged, never listed; a PATCH with status "confirmed" brings it back. */
  cancelled?: boolean;
}
/** A calendar in the signed-in account's list, with that account's access to it (Google's calendarList.accessRole). */
export interface CalInfo { id: string; name: string; accessRole: "owner" | "writer" | "reader" | "freeBusyReader"; primary?: boolean }
export interface CalState { seq: number; events: CalEvent[]; calendars?: CalInfo[] }

/** The seed's band calendar is fake-band-calendar (scripts/seed.ts); the view-only one is for "no access" tests. */
export const BAND_CALENDAR_ID = "fake-band-calendar";
export const READONLY_CALENDAR_ID = "fake-readonly-calendar";
const CALENDARS: CalInfo[] = [
  { id: "primary", name: "Jeff Dean", accessRole: "owner", primary: true },
  { id: BAND_CALENDAR_ID, name: "Ingrid Avison Band", accessRole: "writer" },
  { id: READONLY_CALENDAR_ID, name: "Boulder Venues (view only)", accessRole: "reader" },
];
const calendarsOf = (s: CalState) => s.calendars ?? CALENDARS;

const att = (v: unknown): CalAttendee[] => (Array.isArray(v) ? v : []).map((a) => typeof a === "string" ? { email: a, responseStatus: "needsAction" as const } : { email: a.email, responseStatus: a.responseStatus ?? "needsAction" });

/** Like Google: writing needs writer or owner on the calendar; one the account doesn't have is not found. */
function canWrite(s: CalState, calendarId: string) {
  const c = calendarsOf(s).find((x) => x.id === calendarId);
  if (!c) throw new HttpError(404, `Calendar ${calendarId} not found`);
  if (c.accessRole !== "owner" && c.accessRole !== "writer") throw new HttpError(403, "You need to have writer access to this calendar.");
}

const routes: Route<CalState>[] = [
  ["GET", "/calendars", (_, s) => calendarsOf(s)],
  ["GET", "/calendars/:id", ({ params }, s) => need(calendarsOf(s).find((c) => c.id === params.id), "Calendar")],
  ["POST", "/events", ({ body }, s) => {
    required(body, "title", "start", "end");
    canWrite(s, body.calendarId ?? "primary");
    const now = new Date().toISOString();
    const e: CalEvent = { id: `ev${++s.seq}`, calendarId: body.calendarId ?? "primary", title: body.title, start: body.start, end: body.end, timeZone: body.timeZone, location: body.location, description: body.description, attendees: att(body.attendees), createdAt: now, updatedAt: now };
    s.events.push(e);
    return e;
  }],
  ["GET", "/events", ({ query }, s) => {
    const from = query.get("from"), to = query.get("to"), cal = query.get("calendarId");
    return s.events.filter((e) => !e.cancelled && (!cal || e.calendarId === cal) && (!from || e.end >= from) && (!to || e.start <= to)).sort((a, b) => a.start.localeCompare(b.start));
  }],
  ["GET", "/events/:id", ({ params }, s) => need(s.events.find((e) => e.id === params.id), "Event")],
  ["PATCH", "/events/:id", ({ params, body }, s) => {
    const e = need(s.events.find((x) => x.id === params.id), "Event");
    canWrite(s, e.calendarId);
    for (const k of ["title", "start", "end", "timeZone", "location", "description"] as const) if (body[k] !== undefined) (e as unknown as Record<string, unknown>)[k] = body[k];
    if (body.attendees !== undefined) e.attendees = att(body.attendees);
    if (body.status === "confirmed") delete e.cancelled;
    e.updatedAt = new Date().toISOString();
    return e;
  }],
  ["DELETE", "/events/:id", ({ params }, s) => {
    const e = need(s.events.find((x) => x.id === params.id && !x.cancelled), "Event");
    canWrite(s, e.calendarId);
    e.cancelled = true;
    return { ok: true };
  }],
];

export const fakeCalendar = defineFake<CalState>({
  name: "fake-calendar", defaultPort: 3203, initial: () => ({ seq: 0, events: [], calendars: CALENDARS }), routes,
  page: (s) => `<table><tr><th>Id</th><th>Calendar</th><th>Title</th><th>When</th><th>Where</th><th>Attendees</th></tr>${s.events.filter((e) => !e.cancelled).map((e) =>
    `<tr><td>${e.id}</td><td>${esc(e.calendarId)}</td><td>${esc(e.title)}</td><td>${esc(e.start)} to ${esc(e.end)}</td><td>${esc(e.location)}</td><td>${esc(e.attendees.map((a) => `${a.email} (${a.responseStatus})`).join(", "))}</td></tr>`).join("") || "<tr><td colspan=6>No events.</td></tr>"}</table>`,
});
runIfMain(import.meta, fakeCalendar);
