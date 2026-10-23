import { defineFake, runIfMain, esc, need, required, type Route } from "../lib";

export interface BitEvent {
  id: string; artist: string; datetime: string; venueName: string; city: string; region?: string; country?: string;
  description?: string; ticketUrl?: string; status: "active"; createdAt: string; updatedAt: string;
}
export interface BitState { seq: number; events: BitEvent[] }
const ARTIST = "Ingrid Avison Band";

const routes: Route<BitState>[] = [
  ["POST", "/events", ({ body }, s) => {
    required(body, "datetime", "venueName", "city");
    const now = new Date().toISOString();
    const e: BitEvent = { id: `bit${++s.seq}`, artist: body.artist ?? ARTIST, datetime: body.datetime, venueName: body.venueName, city: body.city, region: body.region, country: body.country, description: body.description, ticketUrl: body.ticketUrl, status: "active", createdAt: now, updatedAt: now };
    s.events.push(e);
    return e;
  }],
  ["GET", "/events", ({ query }, s) => s.events.filter((e) => !query.get("artist") || e.artist === query.get("artist")).sort((a, b) => a.datetime.localeCompare(b.datetime))],
  ["GET", "/events/:id", ({ params }, s) => need(s.events.find((e) => e.id === params.id), "Event")],
  ["PATCH", "/events/:id", ({ params, body }, s) => {
    const e = need(s.events.find((x) => x.id === params.id), "Event");
    for (const k of ["datetime", "venueName", "city", "region", "country", "description", "ticketUrl"] as const) if (body[k] !== undefined) e[k] = body[k];
    e.updatedAt = new Date().toISOString();
    return e;
  }],
  ["DELETE", "/events/:id", ({ params }, s) => {
    need(s.events.find((x) => x.id === params.id), "Event");
    s.events = s.events.filter((x) => x.id !== params.id);
    return { ok: true };
  }],
];

export const fakeBandsintown = defineFake<BitState>({
  name: "fake-bandsintown", defaultPort: 3204, initial: () => ({ seq: 0, events: [] }), routes,
  page: (s) => `<p>Artist: ${ARTIST}</p><table><tr><th>Id</th><th>Date</th><th>Venue</th><th>City</th><th>Tickets</th></tr>${s.events.map((e) =>
    `<tr><td>${e.id}</td><td>${esc(e.datetime)}</td><td>${esc(e.venueName)}</td><td>${esc(e.city)}${e.region ? ", " + esc(e.region) : ""}</td><td>${esc(e.ticketUrl)}</td></tr>`).join("") || "<tr><td colspan=5>No events.</td></tr>"}</table>`,
});
runIfMain(import.meta, fakeBandsintown);
