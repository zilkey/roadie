import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Net, setFetcher, type RawPage } from "@/server/events/fetch";
import type { ReaderCtx } from "@/server/events/types";
import { readAeg } from "@/server/events/readers/aeg";
import { readPlot } from "@/server/events/readers/plot";
import { readVenueNetwork } from "@/server/events/readers/venueNetwork";
import { readEventbrite } from "@/server/events/readers/eventbrite";
import { readJsonLd } from "@/server/events/readers/jsonld";

const ctx = (): ReaderCtx => ({ net: new Net(), tz: "America/Denver", now: new Date("2026-11-10T18:00:00Z") });
const page = (url: string, body: string, type = "text/html"): RawPage => ({ url, status: 200, type, body });

/** Answer from a map of url → body (string or object as JSON); anything else is a 404. */
function serve(map: Record<string, unknown>) {
  const asked: string[] = [];
  setFetcher(async (u) => {
    asked.push(u);
    if (!(u in map)) throw new Error(`404 ${u}`);
    const b = map[u];
    return page(u, typeof b === "string" ? b : JSON.stringify(b));
  });
  return asked;
}
afterEach(() => setFetcher(null));

describe("aeg reader", () => {
  const ev = (id: string, over: Record<string, unknown> = {}) => ({
    eventId: id, active: true,
    title: { headlinersText: `Headliner ${id}`, supportingText: "Opener One, Opener Two" },
    eventDateTime: "2026-11-20T20:00:00", doorDateTime: "2026-11-20T19:00:00",
    ticketing: { status: "Buy Tickets", url: `https://tickets.example.com/${id}` },
    media: { 1: { width: 100, file_name: "https://img.example.com/small.jpg" }, 2: { width: 500, file_name: "https://img.example.com/big.jpg" } },
    ...over,
  });
  test("headliner, supports, times, widest image, and statuses; past and inactive rows are skipped", async () => {
    const asked = serve({
      "https://aegwebprod.blob.core.windows.net/json/events/9/events.json": { meta: {}, events: [
        ev("1"), ev("2", { ticketing: { status: "Cancelled", url: "https://tickets.example.com/2" } }), ev("3", { ticketing: { status: "Sold Out" } }),
        ev("4", { eventDateTime: "2026-11-01T20:00:00" }), ev("5", { active: false }), ev("6", { title: { headlinersText: "Solo", supportingText: null } }),
      ] },
    });
    const r = await readAeg({ type: "aeg", siteId: "9" }, ctx());
    assert.equal(asked.length, 1);
    assert.equal(r.bill, "full");
    assert.deepEqual(r.events.map((e) => e.sourceId), ["1", "2", "3", "6"]);
    const [a, b, c, d] = r.events;
    assert.deepEqual(a.acts, [{ name: "Headliner 1", role: "headliner" }, { name: "Opener One", role: "support" }, { name: "Opener Two", role: "support" }]);
    assert.equal(a.startsAt, "2026-11-20T20:00:00");
    assert.equal(a.doors, "19:00");
    assert.equal(a.imageUrl, "https://img.example.com/big.jpg");
    assert.equal(a.ticketUrl, "https://tickets.example.com/1");
    assert.equal(b.status, "cancelled");
    assert.equal(c.status, "soldout");
    assert.equal(d.acts?.length, 1);
  });
});

describe("plot reader", () => {
  const row = (id: number, day: string, extra: Record<string, unknown> = {}) => ({
    id, title: `Band A ${id} + Band B`, image: "https://img.example.com/p.jpg", day, startTime: "7pm", doors: "Doors: 6:30pm", maxPages: 2,
    ticket: { link: `https://tickets.example.com/${id}` }, lineup: { standard: [{ title: `Band A ${id}` }, { title: "Band B" }] }, ...extra,
  });
  test("pages through maxPages and reads the lineup in order", async () => {
    const asked = serve({
      "https://venue.example.com/api/plot/v1/listings": [row(1, "20261112"), row(2, "20261101")],
      "https://venue.example.com/api/plot/v1/listings?currentpage=2": [row(3, "20261201", { image: "" })],
    });
    const r = await readPlot({ type: "plot", url: "https://venue.example.com/api/plot/v1/listings" }, ctx());
    assert.equal(asked.length, 2);
    assert.deepEqual(r.events.map((e) => e.sourceId), ["1", "3"]);
    const e = r.events[0];
    assert.equal(e.date, "2026-11-12");
    assert.equal(e.timeText, "7pm");
    assert.equal(e.doorsText, "Doors: 6:30pm");
    assert.deepEqual(e.acts, [{ name: "Band A 1", role: "headliner" }, { name: "Band B", role: "support" }]);
    assert.equal(e.ticketUrl, "https://tickets.example.com/1");
    assert.equal(r.events[1].imageUrl, undefined);
    assert.equal(r.bill, "full");
  });
});

describe("venue.network reader", () => {
  const url = "https://venue.network/api/public/tickets/events?venue=room&offset=0";
  test("roles, times, promoter-only rows, and sold-out", async () => {
    serve({ [url]: { success: true, meta: { has_more: false }, data: [
      { id: 1, title: "A, B, C", date: "2026-11-14", start_time: "20:00:00", door_time: "19:00:00", ticketing_status: "on_sale", poster_11x17_thumbnail_url: "https://img.example.com/t.webp",
        artists: [{ name: "A", role: "headliner" }, { name: "B", role: "support" }, { name: "C", role: "opener" }] },
      { id: 2, title: "Private Night", date: "2026-11-15", start_time: null, ticketing_status: "sold_out", artists: [{ name: "Promoter Co", role: "promoter" }] },
      { id: 3, title: "Old", date: "2026-11-01", start_time: "20:00:00", artists: [] },
      { id: 4, title: "X, Y", date: "2026-11-16", start_time: "21:30:00", artists: [{ name: "X", role: "support" }, { name: "Y", role: "support" }] },
    ] } });
    const r = await readVenueNetwork({ type: "venue-network", slug: "room" }, ctx());
    assert.deepEqual(r.events.map((e) => e.sourceId), ["1", "2", "4"]);
    assert.deepEqual(r.events[0].acts, [{ name: "A", role: "headliner" }, { name: "B", role: "support" }, { name: "C", role: "support" }]);
    assert.equal(r.events[0].start, "20:00");
    assert.equal(r.events[0].doors, "19:00");
    assert.equal(r.events[0].imageUrl, "https://img.example.com/t.webp");
    assert.equal(r.events[1].acts, undefined);
    assert.equal(r.events[1].status, "soldout");
    assert.equal(r.events[2].acts?.[0].role, "headliner");
    assert.equal(r.bill, "full");
  });
  test("follows has_more by offset", async () => {
    const asked = serve({
      "https://venue.network/api/public/tickets/events?venue=room&offset=0": { meta: { has_more: true }, data: [{ id: 1, title: "One", date: "2026-11-14", artists: [] }] },
      "https://venue.network/api/public/tickets/events?venue=room&offset=1": { meta: { has_more: false }, data: [{ id: 2, title: "Two", date: "2026-11-15", artists: [] }] },
    });
    const r = await readVenueNetwork({ type: "venue-network", slug: "room" }, ctx());
    assert.equal(asked.length, 2);
    assert.equal(r.events.length, 2);
  });
});

describe("eventbrite reader", () => {
  const html = (events: unknown[]) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { upcomingEvents: events } } })}</script></html>`;
  test("reads upcoming events from the organizer page", async () => {
    serve({ "https://www.eventbrite.com/o/123": html([
      { id: "10", name: "Act One w Act Two", url: "https://www.eventbrite.com/e/act-one-10", start_date: "2026-11-12", start_time: "19:00:00", image: { url: "https://img.example.com/e.jpg" }, is_cancelled: false, ticket_availability: { is_sold_out: false } },
      { id: "11", name: "Sold Show", url: "https://www.eventbrite.com/e/sold-11", start_date: "2026-11-13", start_time: "20:00:00", ticket_availability: { is_sold_out: true } },
      { id: "12", name: "Called Off", url: "https://www.eventbrite.com/e/off-12", start_date: "2026-11-14", is_cancelled: true },
      { id: "13", name: "Past", url: "https://www.eventbrite.com/e/past-13", start_date: "2026-10-01", start_time: "20:00:00" },
    ]) });
    const r = await readEventbrite({ type: "eventbrite", organizerId: "123" }, ctx());
    assert.equal(r.bill, "title");
    assert.deepEqual(r.events.map((e) => [e.sourceId, e.status]), [["10", "onsale"], ["11", "soldout"], ["12", "cancelled"]]);
    assert.equal(r.events[0].startsAt, "2026-11-12T19:00:00");
    assert.equal(r.events[0].imageUrl, "https://img.example.com/e.jpg");
    assert.equal(r.events[0].ticketUrl, "https://www.eventbrite.com/e/act-one-10");
  });
  test("a page with no embedded data is an empty calendar", async () => {
    serve({ "https://www.eventbrite.com/o/123": "<html></html>" });
    assert.deepEqual((await readEventbrite({ type: "eventbrite", organizerId: "123" }, ctx())).events, []);
  });
});

describe("jsonld reader", () => {
  const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
  const doc = (...blocks: string[]) => `<html><head>${blocks.join("")}</head><body></body></html>`;
  const ev = (name: string, extra: Record<string, unknown> = {}) => ({ "@type": "MusicEvent", name, startDate: "2026-11-20T19:30:00-07:00", url: `https://x.example.com/events/${name.toLowerCase().replace(/\W+/g, "-")}`, ...extra });

  test("events in @graph, ItemList and arrays; image shapes, performers, offers, status", async () => {
    serve({ "https://x.example.com/events/": doc(
      ld({ "@context": "https://schema.org", "@graph": [{ "@type": "WebSite", name: "Site" }, ev("Graph Show", { image: { "@type": "ImageObject", url: "/img/g.jpg" }, performer: [{ name: "Lead" }, { name: "Second" }, { name: "Third" }], offers: { url: "https://tickets.example.com/g", availability: "https://schema.org/SoldOut" } })] }),
      ld({ "@type": "ItemList", itemListElement: [{ "@type": "ListItem", item: ev("List Show", { image: ["https://img.example.com/l.jpg"], eventStatus: "https://schema.org/EventCancelled" }) }] }),
      ld([ev("Array Show", { performer: { name: "Solo" } }), ev("Past Show", { startDate: "2026-10-01T19:00:00-06:00" })]),
    ) });
    const r = await readJsonLd({ type: "jsonld", url: "https://x.example.com/events/" }, ctx());
    assert.deepEqual(r.events.map((e) => e.title), ["Graph Show", "List Show", "Array Show"]);
    const [g, l, a] = r.events;
    assert.equal(g.imageUrl, "https://x.example.com/img/g.jpg");
    assert.deepEqual(g.acts, [{ name: "Lead", role: "headliner" }, { name: "Second", role: "support" }, { name: "Third", role: "support" }]);
    assert.equal(g.ticketUrl, "https://tickets.example.com/g");
    assert.equal(g.status, "soldout");
    assert.equal(l.imageUrl, "https://img.example.com/l.jpg");
    assert.equal(l.status, "cancelled");
    assert.equal(l.acts, undefined);
    assert.deepEqual(a.acts, [{ name: "Solo", role: "headliner" }]);
    assert.equal(r.bill, "headliner");
  });

  test("a leading date and a CANCELLED tag in the name", async () => {
    serve({ "https://x.example.com/events/": doc(ld([ev("November 13, Band with Guest"), ev("November 20th, Other (CANCELLED)"), ev("Third")])) });
    const r = await readJsonLd({ type: "jsonld", url: "https://x.example.com/events/" }, ctx());
    assert.equal(r.events[0].title, "Band with Guest");
    assert.equal(r.events[1].status, "cancelled");
  });

  test("a sitemap: follows page urls newest first, skips image urls and pages that fail", async () => {
    const sm = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
      <url><loc>https://x.example.com/event-details/old</loc><lastmod>2024-01-01</lastmod><image:image><image:loc>https://img.example.com/old.jpg</image:loc></image:image></url>
      <url><loc>https://x.example.com/event-details/new</loc><lastmod>2026-10-01</lastmod></url>
      <url><loc>https://x.example.com/event-details/broken</loc><lastmod>2026-09-01</lastmod></url></urlset>`;
    const asked = serve({
      "https://x.example.com/sitemap.xml": sm,
      "https://x.example.com/event-details/new": doc(ld(ev("New Show"))),
      "https://x.example.com/event-details/old": doc(ld(ev("Old Show", { startDate: "2024-01-05T19:00:00-07:00" }))),
    });
    const r = await readJsonLd({ type: "jsonld", url: "https://x.example.com/sitemap.xml" }, ctx());
    assert.deepEqual(r.events.map((e) => e.title), ["New Show"]);
    assert.deepEqual(asked, ["https://x.example.com/sitemap.xml", "https://x.example.com/event-details/new", "https://x.example.com/event-details/broken", "https://x.example.com/event-details/old"]);
  });

  test("a page with few events follows same-host event links; other hosts and itself are left alone", async () => {
    const asked = serve({
      "https://x.example.com/calendar": `<html><body><a href="/events/a">A</a><a href="https://x.example.com/events/b#top">B</a><a href="https://other.example.com/events/c">C</a><a href="/about">About</a><a href="/calendar">Cal</a>${doc(ld(ev("Own Show")))}</body></html>`,
      "https://x.example.com/events/a": doc(ld(ev("Show A"))),
      "https://x.example.com/events/b": doc(ld(ev("Show B", { startDate: "2026-11-22" }))),
    });
    const r = await readJsonLd({ type: "jsonld", url: "https://x.example.com/calendar" }, ctx());
    assert.deepEqual(r.events.map((e) => e.title).sort(), ["Own Show", "Show A", "Show B"]);
    assert.ok(!asked.some((u) => u.includes("other.example.com") || u.endsWith("/about")));
    assert.equal(r.events.find((e) => e.title === "Show B")?.startsAt, "2026-11-22");
  });

  test("a page with plenty of events does not follow links", async () => {
    const asked = serve({ "https://x.example.com/calendar": `<html>${doc(ld([ev("One"), ev("Two"), ev("Three")]))}<a href="/events/z">z</a></html>` });
    const r = await readJsonLd({ type: "jsonld", url: "https://x.example.com/calendar" }, ctx());
    assert.equal(r.events.length, 3);
    assert.equal(asked.length, 1);
    assert.equal(r.bill, "title");
  });
});
