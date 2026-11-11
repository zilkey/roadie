import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Net, setFetcher, type FetchOpts, type RawPage } from "@/server/events/fetch";
import { readSquarespace } from "@/server/events/readers/squarespace";
import { readTribe } from "@/server/events/readers/tribe";
import { readIcs, parseIcs } from "@/server/events/readers/ics";
import { readWix } from "@/server/events/readers/wix";

const NOW = new Date("2026-11-10T18:00:00Z");
const ctx = () => ({ net: new Net(), tz: "America/Denver", now: NOW });
const ms = (iso: string) => Date.parse(iso);

/** Answers each URL from a table; the URLs asked for are recorded. */
function fake(answers: Record<string, string | ((u: string) => string)>) {
  const asked: string[] = [];
  setFetcher(async (u: string, _o?: FetchOpts): Promise<RawPage> => {
    asked.push(u);
    const key = Object.keys(answers).find((k) => u.startsWith(k));
    if (!key) throw new Error(`unexpected fetch ${u}`);
    const a = answers[key];
    return { url: u, status: 200, type: "", body: typeof a === "function" ? a(u) : a };
  });
  return asked;
}
afterEach(() => setFetcher(null));

describe("squarespace", () => {
  const item = (id: string, title: string, start: string, extra: object = {}) => ({
    id, title, startDate: ms(start), endDate: ms(start) + 3_600_000, assetUrl: `https://img.example.com/${id}.jpg`, fullUrl: `/events/${id}`,
    tags: ["music"], categories: ["Live"], excerpt: "<p>Doors at <b>7</b></p>", ...extra,
  });

  test("reads upcoming, absolute urls, drops past, pages by offset", async () => {
    const asked = fake({
      "https://www.example.com/events?format=json&offset=": JSON.stringify({ upcoming: [item("c", "Third Act", "2026-12-20T02:00:00Z")], pagination: { nextPage: false } }),
      "https://www.example.com/events?format=json": JSON.stringify({
        upcoming: [item("a", "The Example Band", "2026-11-15T02:00:00Z"), item("old", "Long Ago", "2026-10-01T02:00:00Z"), item("b", "Other Act", "2026-11-16T02:00:00Z")],
        past: [item("p", "Past", "2026-01-01T02:00:00Z")], pagination: { nextPage: true, nextPageOffset: 123 },
      }),
    });
    const r = await readSquarespace({ type: "squarespace", url: "https://www.example.com/events" }, ctx());
    assert.deepEqual(r.events.map((e) => e.sourceId), ["a", "b", "c"]);
    assert.equal(r.bill, "title");
    const a = r.events[0];
    assert.equal(a.startsAt, "2026-11-15T02:00:00.000Z");
    assert.equal(a.imageUrl, "https://img.example.com/a.jpg");
    assert.equal(a.ticketUrl, "https://www.example.com/events/a");
    assert.deepEqual(a.tags, ["music", "Live"]);
    assert.equal(a.description, "Doors at 7");
    assert.ok(asked.some((u) => u.includes("offset=123")));
  });

  test("a calendar-style collection reads this and the next two months", async () => {
    const asked = fake({
      "https://www.example.com/events?format=json&month=": (u) => JSON.stringify({ items: [item(new URL(u).searchParams.get("month")!, "Monthly", "2026-11-20T02:00:00Z")] }),
      "https://www.example.com/events?format=json": JSON.stringify({ calendarView: true, items: [item("m0", "Now", "2026-11-12T02:00:00Z")] }),
    });
    const r = await readSquarespace({ type: "squarespace", url: "https://www.example.com/events?format=json" }, ctx());
    assert.equal(r.events.length, 4);
    assert.ok(asked.some((u) => u.includes("month=12-2026")) && asked.some((u) => u.includes("month=01-2027")));
  });

  test("the calendar API url is read for three months", async () => {
    const asked = fake({ "https://www.example.com/api/open/GetItemsByMonth": (u) => JSON.stringify([item(new URL(u).searchParams.get("month")!, "Gig", "2026-11-20T02:00:00Z")]) });
    const r = await readSquarespace({ type: "squarespace", url: "https://www.example.com/api/open/GetItemsByMonth?month=11-2026&collectionId=abc" }, ctx());
    assert.equal(r.events.length, 3);
    assert.deepEqual(asked.map((u) => new URL(u).searchParams.get("month")), ["11-2026", "12-2026", "01-2027"]);
  });

  test("a plain page gives nothing", async () => {
    fake({ "https://www.example.com/": JSON.stringify({ collection: { typeName: "page" }, mainContent: "<div/>" }) });
    const r = await readSquarespace({ type: "squarespace", url: "https://www.example.com/" }, ctx());
    assert.deepEqual(r.events, []);
  });
});

describe("tribe", () => {
  const ev = (id: number, title: string, start: string, extra: object = {}) => ({
    id, title, start_date: start, utc_start_date: "x", url: `https://example.com/event/${id}/`, image: { url: `https://example.com/i${id}.jpg` },
    categories: [{ name: "Live Music" }], tags: [{ name: "Rock &amp; Roll" }], description: "<p>Bring a friend</p>", ...extra,
  });

  test("follows next_rest_url, decodes titles, keeps local time and the category", async () => {
    const asked = fake({
      "https://example.com/wp-json/tribe/events/v1/events?page=2": JSON.stringify({ events: [ev(2, "Second Show", "2026-11-21 19:00:00")] }),
      "https://example.com/wp-json/tribe/events/v1/events?per_page=50": JSON.stringify({
        events: [ev(1, "Cats &#038; Dogs", "2026-11-14 20:00:00", { image: false })],
        next_rest_url: "https://example.com/wp-json/tribe/events/v1/events?page=2",
      }),
    });
    const r = await readTribe({ type: "tribe", baseUrl: "https://example.com/", category: "live-music" }, ctx());
    assert.ok(asked[0].includes("start_date=2026-11-10") && asked[0].includes("categories=live-music"));
    assert.equal(r.events.length, 2);
    assert.equal(r.events[0].title, "Cats & Dogs");
    assert.equal(r.events[0].startsAt, "2026-11-14 20:00:00");
    assert.equal(r.events[0].imageUrl, undefined);
    assert.equal(r.events[1].imageUrl, "https://example.com/i2.jpg");
    assert.equal(r.events[1].ticketUrl, "https://example.com/event/2/");
    assert.deepEqual(r.events[1].tags, ["Live Music", "Rock & Roll"]);
    assert.equal(r.events[1].description, "Bring a friend");
    assert.equal(r.events[1].sourceId, "2");
  });
});

describe("ics", () => {
  const FEED = [
    "BEGIN:VCALENDAR", "VERSION:2.0",
    "BEGIN:VEVENT", "UID:u1@example.com", "DTSTART:20261114T030000Z", "SUMMARY:The Example Band\\, live", "URL:https://example.com/e/1",
    "DESCRIPTION:Line one\\nLine two with a very lo", " ng continuation", "END:VEVENT",
    "BEGIN:VEVENT", "UID:u2@example.com", "DTSTART;TZID=America/Denver:20261120T200000", "SUMMARY:Local Time Act ***SOLD OUT***", "END:VEVENT",
    "BEGIN:VEVENT", "UID:u3@example.com", "DTSTART;VALUE=DATE:20261201", "SUMMARY:All Day Fest", "STATUS:CANCELLED", "END:VEVENT",
    "BEGIN:VEVENT", "UID:u4@example.com", "DTSTART:20260101T030000Z", "SUMMARY:Way Past", "END:VEVENT",
    "BEGIN:VEVENT", "UID:u5@example.com", "DTSTART:20261104T030000Z", "SUMMARY:Last Week Show", "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  test("parses the forms of DTSTART, unfolds and unescapes, reads status", () => {
    const e = parseIcs(FEED);
    assert.equal(e.length, 5);
    assert.deepEqual([e[0].startsAt, e[1].startsAt, e[2].startsAt], ["2026-11-14T03:00:00Z", "2026-11-20T20:00:00", "2026-12-01"]);
    assert.equal(e[0].title, "The Example Band, live");
    assert.equal(e[0].ticketUrl, "https://example.com/e/1");
    assert.equal(e[0].description, "Line one Line two with a very long continuation");
    assert.equal(e[1].title, "Local Time Act");
    assert.equal(e[1].status, "soldout");
    assert.equal(e[2].status, "cancelled");
  });

  test("keeps events from a week ago on", async () => {
    fake({ "https://example.com/feed.ics": FEED });
    const r = await readIcs({ type: "ics", url: "https://example.com/feed.ics" }, ctx());
    assert.deepEqual(r.events.map((e) => e.sourceId), ["u1@example.com", "u2@example.com", "u3@example.com", "u5@example.com"]);
  });
});

describe("wix", () => {
  const blob = (events: object[]) => `<html><script type="application/json" id="wix-warmup-data">${JSON.stringify({ appsWarmupData: { x: { w: { events: { events } } } } })}</script></html>`;
  const wev = (id: string, title: string, start: string, extra: object = {}) => ({
    id, title, slug: `slug-${id}`, status: 1, scheduling: { config: { startDate: start, scheduleTbd: false } },
    mainImage: { id: `${id}~mv2.png`, url: `https://static.wixstatic.com/media/${id}~mv2.png` }, location: { name: "The Room" }, description: "A show", ...extra,
  });

  test("finds events anywhere in the embedded json", async () => {
    fake({ "https://www.example.com/calendar": blob([wev("1", "The Example Band", "2026-11-15T02:00:00.000Z"), wev("1", "The Example Band", "2026-11-15T02:00:00.000Z"), wev("2", "Called Off", "2026-11-18T02:00:00.000Z", { status: 4 }), wev("3", "Old", "2026-10-01T02:00:00.000Z"), wev("4", "TBD", "2026-11-19T02:00:00.000Z", { scheduling: { config: { startDate: "2026-11-19T02:00:00.000Z", scheduleTbd: true } } })]) });
    const r = await readWix({ type: "wix", url: "https://www.example.com/calendar" }, ctx());
    assert.deepEqual(r.events.map((e) => e.sourceId), ["1", "2"]);
    assert.equal(r.events[0].startsAt, "2026-11-15T02:00:00.000Z");
    assert.equal(r.events[0].ticketUrl, "https://www.example.com/event-details/slug-1");
    assert.equal(r.events[0].imageUrl, "https://static.wixstatic.com/media/1~mv2.png");
    assert.equal(r.events[0].venueName, "The Room");
    assert.equal(r.events[1].status, "cancelled");
  });

  test("falls back to JSON-LD, and to nothing", async () => {
    fake({
      "https://www.example.com/ld": `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Event", name: "Linked Act", startDate: "2026-11-22T19:00:00-07:00", url: "https://example.com/e", image: ["https://img.example.com/x.jpg"] })}</script>`,
      "https://www.example.com/none": "<html><body>No events</body></html>",
    });
    const ld = await readWix({ type: "wix", url: "https://www.example.com/ld" }, ctx());
    assert.equal(ld.events.length, 1);
    assert.equal(ld.events[0].imageUrl, "https://img.example.com/x.jpg");
    const none = await readWix({ type: "wix", url: "https://www.example.com/none" }, ctx());
    assert.deepEqual(none.events, []);
  });
});
