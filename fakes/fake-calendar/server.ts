import { defineFake, runIfMain, esc, need, required, type Route } from "../lib";

export interface CalAttendee { email: string; responseStatus: "needsAction" | "accepted" | "declined" | "tentative" }
export interface CalEvent {
  id: string; calendarId: string; title: string; start: string; end: string; location?: string; description?: string; timeZone?: string;
  attendees: CalAttendee[]; createdAt: string; updatedAt: string;
}
export interface CalState { seq: number; events: CalEvent[] }

const att = (v: unknown): CalAttendee[] => (Array.isArray(v) ? v : []).map((a) => typeof a === "string" ? { email: a, responseStatus: "needsAction" as const } : { email: a.email, responseStatus: a.responseStatus ?? "needsAction" });

const routes: Route<CalState>[] = [
  ["POST", "/events", ({ body }, s) => {
    required(body, "title", "start", "end");
    const now = new Date().toISOString();
    const e: CalEvent = { id: `ev${++s.seq}`, calendarId: body.calendarId ?? "primary", title: body.title, start: body.start, end: body.end, timeZone: body.timeZone, location: body.location, description: body.description, attendees: att(body.attendees), createdAt: now, updatedAt: now };
    s.events.push(e);
    return e;
  }],
  ["GET", "/events", ({ query }, s) => {
    const from = query.get("from"), to = query.get("to"), cal = query.get("calendarId");
    return s.events.filter((e) => (!cal || e.calendarId === cal) && (!from || e.end >= from) && (!to || e.start <= to)).sort((a, b) => a.start.localeCompare(b.start));
  }],
  ["GET", "/events/:id", ({ params }, s) => need(s.events.find((e) => e.id === params.id), "Event")],
  ["PATCH", "/events/:id", ({ params, body }, s) => {
    const e = need(s.events.find((x) => x.id === params.id), "Event");
    for (const k of ["title", "start", "end", "timeZone", "location", "description"] as const) if (body[k] !== undefined) (e as unknown as Record<string, unknown>)[k] = body[k];
    if (body.attendees !== undefined) e.attendees = att(body.attendees);
    e.updatedAt = new Date().toISOString();
    return e;
  }],
  ["DELETE", "/events/:id", ({ params }, s) => {
    need(s.events.find((x) => x.id === params.id), "Event");
    s.events = s.events.filter((x) => x.id !== params.id);
    return { ok: true };
  }],
];

export const fakeCalendar = defineFake<CalState>({
  name: "fake-calendar", defaultPort: 3203, initial: () => ({ seq: 0, events: [] }), routes,
  page: (s) => `<table><tr><th>Id</th><th>Title</th><th>When</th><th>Where</th><th>Attendees</th></tr>${s.events.map((e) =>
    `<tr><td>${e.id}</td><td>${esc(e.title)}</td><td>${esc(e.start)} to ${esc(e.end)}</td><td>${esc(e.location)}</td><td>${esc(e.attendees.map((a) => `${a.email} (${a.responseStatus})`).join(", "))}</td></tr>`).join("") || "<tr><td colspan=5>No events.</td></tr>"}</table>`,
});
runIfMain(import.meta, fakeCalendar);
