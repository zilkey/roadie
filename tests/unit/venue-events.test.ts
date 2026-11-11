import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { splitTitle, isMusic, cleanTitle } from "@/server/events/bill";
import { parseDateText, parseTime, resolveStartsAt, todayIn } from "@/server/events/dates";
import { extract } from "@/server/events/selectors";
import { readCalendar, toDraft, eventId } from "@/server/events/refresh";
import { suggestSelectors } from "@/server/events/suggest";
import { Net, setFetcher, type RawPage } from "@/server/events/fetch";
import { billParts, byWhen, eventTime, fmtClock, fmtEventDay, fmtEventYear, isUpcoming, openSlot, titleSaysMore } from "@/lib/venueEvents";
import { VenueCalendar } from "@/schema";

// suggestSelectors must never reach a real model here (the unit runner sets no NODE_ENV, and a Vertex key may be in the env).
process.env.ROADIE_MODEL = "fake";

const TZ = "America/Denver";
const NOW = new Date("2026-11-10T18:00:00Z");
afterEach(() => setFetcher(null));

const names = (t: string) => splitTitle(t).acts.map((a) => a.name);

describe("splitTitle", () => {
  test("headliner w/ support + support", () => {
    const b = splitTitle("The Pine Hollows w/ Marlow Creek + Tin Cup Jane");
    assert.deepEqual(b.acts, [
      { name: "The Pine Hollows", role: "headliner" },
      { name: "Marlow Creek", role: "support" },
      { name: "Tin Cup Jane", role: "support" },
    ]);
    assert.equal(b.supportTba, false);
  });
  test("with special guests means support TBA, headliner only", () => {
    const b = splitTitle("The Pine Hollows with special guests");
    assert.deepEqual(b.acts, [{ name: "The Pine Hollows", role: "headliner" }]);
    assert.equal(b.supportTba, true);
  });
  test("Presents prefix dropped", () => {
    assert.deepEqual(names("Z2 Presents: The Pine Hollows"), ["The Pine Hollows"]);
  });
  test("tour name after a dash dropped", () => {
    assert.deepEqual(names("The Pine Hollows - The Big Tour"), ["The Pine Hollows"]);
  });
  test("an ampersand is part of the name", () => {
    assert.deepEqual(names("Mumford & Sons"), ["Mumford & Sons"]);
    assert.deepEqual(names("Mumford & Sons w/ Tin Cup Jane"), ["Mumford & Sons", "Tin Cup Jane"]);
  });
  test("slash list is a co-bill", () => {
    const b = splitTitle("Alpha Act / Beta Band / Gamma Trio");
    assert.deepEqual(b.acts.map((a) => a.name), ["Alpha Act", "Beta Band", "Gamma Trio"]);
    assert.equal(b.acts[0].role, "headliner");
    assert.equal(b.acts[2].role, "support");
  });
  test("(CANCELLED) stripped", () => {
    assert.deepEqual(names("The Pine Hollows (CANCELLED)"), ["The Pine Hollows"]);
    assert.deepEqual(names("CANCELLED: The Pine Hollows"), ["The Pine Hollows"]);
  });
  test("html entities decoded and duplicates collapsed", () => {
    assert.equal(cleanTitle("Rock &amp; Roll&nbsp;Night <b>Live</b>"), "Rock & Roll Night Live");
    assert.deepEqual(names("Alpha w/ alpha"), ["Alpha"]);
  });
});

describe("isMusic", () => {
  test("trivia, yoga and the like are dropped", () => {
    for (const t of ["Tuesday Trivia Night", "Sunday Yoga", "Bingo with Bev", "Paint & Sip"]) assert.equal(isMusic(t), false, t);
  });
  test("a plain band name is music", () => assert.equal(isMusic("The Pine Hollows"), true));
  test("live music in the tasting room is kept", () => assert.equal(isMusic("Free Live Music in the Tasting Room with Tin Cup Jane"), true));
  test("tags that say music win; tags that say not music lose", () => {
    assert.equal(isMusic("Friday Night", ["Live Music"]), true);
    assert.equal(isMusic("Friday Night", ["Trivia"]), false);
  });
  test("description that is clearly not music drops an ambiguous title", () => {
    assert.equal(isMusic("Friday Night", [], "Join us for trivia and prizes"), false);
  });
});

describe("openSlot", () => {
  const act = (name: string, role: "headliner" | "support" | "unknown") => ({ name, role });
  test("full bill with only a headliner is open", () => assert.equal(openSlot({ acts: [act("A", "headliner")], bill: "full" }), true));
  test("title-only sources cannot tell", () => assert.equal(openSlot({ acts: [act("A", "headliner")], bill: "title" }), false));
  test("a support act fills it", () => assert.equal(openSlot({ acts: [act("A", "headliner"), act("B", "support")], bill: "full" }), false));
  test("support TBA is open even on a title source", () => assert.equal(openSlot({ acts: [act("A", "headliner")], bill: "title", supportTba: true }), true));
  test("cancelled and gone are never open", () => {
    assert.equal(openSlot({ acts: [], bill: "full", status: "cancelled" }), false);
    assert.equal(openSlot({ acts: [], bill: "full", supportTba: true, status: "gone" }), false);
  });
});

describe("how a show reads (Events tab, Booking's Venue calendars)", () => {
  const act = (name: string, role: "headliner" | "support") => ({ name, role });
  test("clock times", () => {
    assert.equal(fmtClock("20:00"), "8 PM");
    assert.equal(fmtClock("19:30"), "7:30 PM");
    assert.equal(fmtClock("00:15"), "12:15 AM");
    assert.equal(fmtClock("12:00"), "12 PM");
    assert.equal(fmtClock(undefined), "");
  });
  test("start and doors", () => {
    assert.equal(eventTime({ start: "20:00", doors: "19:00" }), "8 PM · doors 7 PM");
    assert.equal(eventTime({ doors: "19:00" }), "doors 7 PM");
    assert.equal(eventTime({}), "");
  });
  test("calendar days carry no zone", () => {
    assert.equal(fmtEventDay("2031-03-14"), "Fri, Mar 14");
    assert.equal(fmtEventYear("2020-02-08"), "Sat, Feb 8, 2020");
  });
  test("headliners, then everyone else", () =>
    assert.deepEqual(billParts([act("A", "headliner"), act("B", "support"), act("C", "support")]), { head: ["A"], rest: ["B", "C"] }));
  test("the title shows only when it says more than the acts", () => {
    assert.equal(titleSaysMore({ title: "The Example Band with Sample Support", acts: [act("The Example Band", "headliner"), act("Sample Support", "support")] }), false);
    assert.equal(titleSaysMore({ title: "The Example Band: Album Release Party", acts: [act("The Example Band", "headliner")] }), true);
    assert.equal(titleSaysMore({ title: "Open mic", acts: [] }), false);
  });
  test("soonest first, by date then start; a show with no time first on its day", () => {
    const rows = [{ date: "2031-03-14", start: "21:00" }, { date: "2031-03-14" }, { date: "2031-03-01", start: "20:00" }, { date: "2031-03-14", start: "19:00" }];
    assert.deepEqual([...rows].sort(byWhen), [{ date: "2031-03-01", start: "20:00" }, { date: "2031-03-14" }, { date: "2031-03-14", start: "19:00" }, { date: "2031-03-14", start: "21:00" }]);
  });
  test("upcoming: today or later and still on the calendar", () => {
    assert.equal(isUpcoming({ date: "2026-11-10", status: "onsale" }, "2026-11-10"), true);
    assert.equal(isUpcoming({ date: "2026-11-09", status: "onsale" }, "2026-11-10"), false);
    assert.equal(isUpcoming({ date: "2026-12-01", status: "gone" }, "2026-11-10"), false);
    assert.equal(isUpcoming({ date: "2026-12-01", status: "cancelled" }, "2026-11-10"), true);
  });
});

describe("dates", () => {
  test("parseTime", () => {
    assert.equal(parseTime("8pm"), "20:00");
    assert.equal(parseTime("Doors 7:30 PM"), "19:30");
    assert.equal(parseTime("8 p.m."), "20:00");
    assert.equal(parseTime("12 AM"), "00:00");
    assert.equal(parseTime("12:15 pm"), "12:15");
    assert.equal(parseTime("20:00"), "20:00");
    assert.equal(parseTime("no time here"), undefined);
    assert.equal(parseTime(undefined), undefined);
  });
  test("parseTime: ranges and labels", () => {
    assert.equal(parseTime("6:00 - 7:00 PM"), "18:00");
    assert.equal(parseTime("8-11pm"), "20:00");
    assert.equal(parseTime("11 - 1 PM"), "11:00");
    assert.equal(parseTime("Doors: 7 pm Show: 8 pm", "doors"), "19:00");
    assert.equal(parseTime("Doors: 7 pm Show: 8 pm", "show"), "20:00");
    assert.equal(parseTime("Doors 7 / 8pm", "show"), "20:00");
  });
  test("no year: next matching date, weekday checked", () => {
    assert.deepEqual(parseDateText("Sat, Nov 14 · 8pm", { tz: TZ, now: NOW }), { date: "2026-11-14", time: "20:00" });
    // Nov 14 is a Saturday in 2026 only; a "Fri, Nov 14" resolves to the next year it is a Friday (2031 is beyond the window: falls back to the next date)
    assert.equal(parseDateText("Nov 14", { tz: TZ, now: NOW })!.date, "2026-11-14");
  });
  test("year boundary", () => {
    const dec = new Date("2026-12-28T18:00:00Z");
    assert.equal(parseDateText("Fri, Jan 1", { tz: TZ, now: dec })!.date, "2027-01-01");
    // a show a few days ago still resolves to this year, not next
    assert.equal(parseDateText("Mon, Dec 21", { tz: TZ, now: dec })!.date, "2026-12-21");
    // early January looking back at a December date picks last year while it is inside the 7-day grace
    assert.equal(parseDateText("Sat, Dec 26", { tz: TZ, now: new Date("2027-01-02T18:00:00Z") })!.date, "2026-12-26");
    // and next year once it is older than that
    assert.equal(parseDateText("Sat, Dec 25", { tz: TZ, now: new Date("2027-01-10T18:00:00Z") })!.date, "2027-12-25");
  });
  test("a date from last month stays last month; a far one rolls to next year", () => {
    assert.equal(parseDateText("Oct 28", { tz: TZ, now: NOW })!.date, "2026-10-28");
    assert.equal(parseDateText("Mar 3", { tz: TZ, now: NOW })!.date, "2027-03-03");
  });
  test("numeric with year and time", () => {
    assert.deepEqual(parseDateText("11/14/2026 7:30 PM", { tz: TZ, now: NOW }), { date: "2026-11-14", time: "19:30" });
  });
  test("day-first format hint", () => {
    assert.equal(parseDateText("14/11/2026", { tz: TZ, now: NOW, format: "D/M/YYYY" })!.date, "2026-11-14");
  });
  test("ISO with offset is converted to the venue's zone", () => {
    assert.deepEqual(parseDateText("2026-11-15T03:00:00Z", { tz: TZ, now: NOW }), { date: "2026-11-14", time: "20:00" });
    assert.deepEqual(parseDateText("2026-11-14T20:00:00-07:00", { tz: TZ, now: NOW }), { date: "2026-11-14", time: "20:00" });
    assert.deepEqual(resolveStartsAt("2026-07-04T02:00:00Z", TZ), { date: "2026-07-03", time: "20:00" }); // daylight time, -06:00
  });
  test("local date-time without offset is as written; date alone has no time", () => {
    assert.deepEqual(resolveStartsAt("2026-11-14T20:00", TZ), { date: "2026-11-14", time: "20:00" });
    assert.deepEqual(resolveStartsAt("2026-11-14 20:00:00", TZ), { date: "2026-11-14", time: "20:00" });
    assert.deepEqual(resolveStartsAt("2026-11-14", TZ), { date: "2026-11-14" });
    assert.equal(resolveStartsAt("garbage", TZ), undefined);
  });
  test("long month names, ordinals and day-month order", () => {
    assert.equal(parseDateText("Saturday, November 14th", { tz: TZ, now: NOW })!.date, "2026-11-14");
    assert.equal(parseDateText("14 Nov 2026", { tz: TZ, now: NOW })!.date, "2026-11-14");
  });
  test("rubbish and impossible dates", () => {
    assert.equal(parseDateText("TBA", { tz: TZ, now: NOW }), undefined);
    assert.equal(parseDateText("", { tz: TZ, now: NOW }), undefined);
    assert.equal(parseDateText("2/30/2026", { tz: TZ, now: NOW }), undefined);
  });
  test("todayIn uses the venue's zone", () => {
    assert.equal(todayIn(TZ, new Date("2026-11-10T03:00:00Z")), "2026-11-09");
  });
});

const PAGE = `<html><body><ul>
  <li class="ev"><a class="t" href="/events/pine-hollows"><span class="name">The Pine Hollows w/ Marlow Creek</span></a>
    <time datetime="2026-11-14T20:00:00-07:00">Sat Nov 14</time><span class="when">Sat, Nov 14 · 8pm</span><span class="dr">Doors 7pm</span>
    <img src="/img/a.jpg"><span class="room">Main Room</span></li>
  <li class="ev"><a class="t" href="https://tix.example.com/e/2"><span class="name">Tuesday Trivia</span></a><span class="when">Tue, Nov 17</span></li>
  <li class="ev"><a class="t" href="/events/lazy"><span class="name">Lazy Band</span></a><span class="when">Fri, Nov 20 8pm</span>
    <img src="data:image/gif;base64,AAA" data-src="//cdn.example.com/lazy.jpg"></li>
  <li class="ev"><a class="t" href="/events/srcset"><span class="name">Srcset Band</span></a><span class="when">Sat, Nov 21</span>
    <img srcset="/img/s1.jpg 1x, /img/s2.jpg 2x"></li>
  <li class="ev"><a class="t" href="/events/bg"><span class="name">Background Band</span></a><span class="when">Sat, Nov 28</span>
    <div class="pic" style="background-image: url('/img/bg.png')"></div></li>
  <li class="ev"><span class="name">No Link Band</span><span class="when">Sun, Nov 22</span> <span class="st">SOLD OUT</span></li>
  <li class="ev"><span class="name">Bad Date Band</span><span class="when">soon</span></li>
  <li class="ev"><span class="when">no title</span></li>
</ul>
<div class="card"><a class="whole" href="/c/1">Card Band</a><ul class="lineup"><li>Head Act</li><li>Open Act</li></ul></div>
</body></html>`;
const URL0 = "https://venue.example.com/calendar/";
const cfg = { item: "li.ev", fields: { title: ".name", date: ".when", url: "a.t", image: "img", time: ".when", doors: ".dr", venue: ".room", status: ".st" } };

describe("extract", () => {
  const rows = extract(PAGE, URL0, cfg);
  const by = (t: string) => rows.find((r) => r.title === t)!;
  test("rows with no title are skipped", () => assert.equal(rows.length, 7));
  test("relative urls resolve against the page, absolute stay", () => {
    assert.equal(by("The Pine Hollows w/ Marlow Creek").ticketUrl, "https://venue.example.com/events/pine-hollows");
    assert.equal(by("Tuesday Trivia").ticketUrl, "https://tix.example.com/e/2");
    assert.equal(by("The Pine Hollows w/ Marlow Creek").sourceId, undefined); // toDraft adds the date: one url may serve every date of a run
  });
  test("text fields", () => {
    const r = by("The Pine Hollows w/ Marlow Creek");
    assert.equal(r.dateText, "Sat, Nov 14 · 8pm");
    assert.equal(r.doorsText, "Doors 7pm");
    assert.equal(r.venueName, "Main Room");
    assert.equal(r.imageUrl, "https://venue.example.com/img/a.jpg");
  });
  test("images: data-src (skipping data: uri), srcset first entry, background-image", () => {
    assert.equal(by("Lazy Band").imageUrl, "https://cdn.example.com/lazy.jpg");
    assert.equal(by("Srcset Band").imageUrl, "https://venue.example.com/img/s1.jpg");
    const bg = extract(PAGE, URL0, { item: "li.ev", fields: { title: ".name", image: ".pic" } }).find((r) => r.title === "Background Band")!;
    assert.equal(bg.imageUrl, "https://venue.example.com/img/bg.png");
  });
  test("status", () => assert.equal(by("No Link Band").status, "soldout"));
  test("attr fields", () => {
    const r = extract(PAGE, URL0, { item: "li.ev", fields: { title: ".name", date: { sel: "time", attr: "datetime" } } });
    assert.equal(r[0].dateText, "2026-11-14T20:00:00-07:00");
    assert.equal(r[1].dateText, undefined);
  });
  test('"" selects the item itself', () => {
    const r = extract(PAGE, URL0, { item: ".card", fields: { title: "", url: { sel: "", attr: "href" } } });
    assert.match(r[0].title, /^Card Band\s*Head Act\s*Open Act$/);
    const r2 = extract(PAGE, URL0, { item: ".card", fields: { title: "a.whole", url: "" } });
    assert.equal(r2[0].ticketUrl, "https://venue.example.com/c/1"); // item has no href itself: falls to its first link
  });
  test("acts list: each match is an act, first is the headliner", () => {
    const r = extract(PAGE, URL0, { item: ".card", fields: { title: "a.whole", acts: ".lineup li" } });
    assert.deepEqual(r[0].acts, [{ name: "Head Act", role: "headliner" }, { name: "Open Act", role: "support" }]);
  });
  test("javascript: urls are not kept", () => {
    const r = extract(`<div class="e"><a href="javascript:void(0)">X Band</a></div>`, URL0, { item: ".e", fields: { title: "a" } });
    assert.equal(r[0].ticketUrl, undefined);
  });
});

describe("toDraft", () => {
  const ctx = { tz: TZ, now: NOW, bill: "title" as const };
  test("dateText and timeText, doors", () => {
    const d = toDraft({ title: "A w/ B", dateText: "Sat, Nov 14", timeText: "8pm", doorsText: "7pm" }, ctx);
    assert.ok(typeof d === "object");
    assert.equal(d.date, "2026-11-14"); assert.equal(d.start, "20:00"); assert.equal(d.doors, "19:00");
    assert.equal(d.sourceId, "2026-11-14|a w/ b");
    const u = toDraft({ title: "A", dateText: "Sat, Nov 14", ticketUrl: "https://t.example.com/a" }, ctx);
    assert.ok(typeof u === "object");
    assert.equal(u.sourceId, "https://t.example.com/a|2026-11-14");
    assert.equal(d.status, "onsale");
  });
  test("midnight start is dropped", () => {
    const d = toDraft({ title: "A", startsAt: "2026-11-14T00:00:00" }, ctx);
    assert.ok(typeof d === "object");
    assert.equal(d.start, undefined);
  });
  test("source acts on a title-only source make the bill headliner", () => {
    const d = toDraft({ title: "A", date: "2026-11-14", acts: [{ name: "A", role: "headliner" }] }, ctx);
    assert.ok(typeof d === "object");
    assert.equal(d.bill, "headliner");
  });
  test("unparsed and empty", () => {
    assert.equal(toDraft({ title: "A", dateText: "soon" }, ctx), "unparsed");
    assert.equal(toDraft({ title: "  ", date: "2026-11-14" }, ctx), "empty");
  });
  test("eventId is stable and per venue", () => {
    assert.equal(eventId("v1", "s"), eventId("v1", "s"));
    assert.notEqual(eventId("v1", "s"), eventId("v2", "s"));
    assert.match(eventId("v1", "s"), /^v1__[0-9a-f]{16}$/);
  });
});

function serve(html: string) {
  setFetcher(async (u: string): Promise<RawPage> => ({ url: u, status: 200, type: "text/html", body: html }));
}
const sel = (extra: Record<string, unknown> = {}) =>
  VenueCalendar.parse({ type: "selectors", url: URL0, item: "li.ev", fields: { title: ".name", date: ".when", url: "a.t", venue: ".room" }, ...extra });
const rc = () => ({ net: new Net(), tz: TZ, now: NOW });

describe("readCalendar", () => {
  test("drops non-music, counts unparsed, sorts by date", async () => {
    serve(PAGE);
    const o = await readCalendar(sel(), rc());
    assert.equal(o.raw, 7);
    assert.equal(o.unparsed, 1); // Bad Date Band
    assert.equal(o.dropped, 1); // Tuesday Trivia
    assert.equal(o.events.length, 5);
    const dates = o.events.map((e) => e.date);
    assert.deepEqual(dates, [...dates].sort());
    assert.equal(o.events[0].acts.length, 2);
    assert.equal(o.events[0].start, "20:00"); // the time in the date text
  });
  test("filter.venueName keeps only that room", async () => {
    serve(PAGE);
    const o = await readCalendar(sel({ filter: { venueName: "main room" } }), rc());
    assert.deepEqual(o.events.map((e) => e.title), ["The Pine Hollows w/ Marlow Creek"]);
    const none = await readCalendar(sel({ filter: { venueName: "Patio" } }), rc());
    assert.equal(none.events.length, 0);
  });
  test("include overrides the music guess; exclude drops", async () => {
    serve(PAGE);
    const inc = await readCalendar(sel({ filter: { include: "trivia" } }), rc());
    assert.deepEqual(inc.events.map((e) => e.title), ["Tuesday Trivia"]);
    const exc = await readCalendar(sel({ filter: { exclude: "lazy|srcset" } }), rc());
    assert.ok(!exc.events.some((e) => /Lazy|Srcset/.test(e.title)));
    assert.ok(exc.events.some((e) => e.title === "Lazy Band") === false);
  });
  test("a bad regex in the filter is ignored", async () => {
    serve(PAGE);
    const o = await readCalendar(sel({ filter: { exclude: "(" } }), rc());
    assert.ok(o.events.length > 0);
  });
  test("filter.venueName strips a trailing \"at <room>\" from act names", async () => {
    serve(`<ul><li class="ev"><span class="name">Alpha w/ Beta at Main Room</span><span class="when">Sat, Nov 14</span><span class="room">Main Room</span></li></ul>`);
    const o = await readCalendar(sel({ filter: { venueName: "Main Room" } }), rc());
    assert.deepEqual(o.events[0].acts.map((a) => a.name), ["Alpha", "Beta"]);
  });
  test("dedupe by sourceId", async () => {
    const dup = `<ul><li class="ev"><a class="t" href="/e/1"><span class="name">Dup Band</span></a><span class="when">Sat, Nov 14</span></li>
      <li class="ev"><a class="t" href="/e/1"><span class="name">Dup Band</span></a><span class="when">Sat, Nov 14</span></li>
      <li class="ev"><a class="t" href="/e/2"><span class="name">Dup Band</span></a><span class="when">Sat, Nov 14</span></li></ul>`;
    serve(dup);
    const o = await readCalendar(sel(), rc());
    assert.equal(o.events.length, 2);
  });
  test("manual calendars read nothing", async () => {
    const o = await readCalendar({ type: "manual", note: "Instagram only" }, rc());
    assert.deepEqual([o.events.length, o.raw], [0, 0]);
  });
  test("a selectors calendar with no selectors is an error", async () => {
    serve(PAGE);
    await assert.rejects(readCalendar(VenueCalendar.parse({ type: "selectors", url: URL0 }), rc()), /no selectors/i);
  });
});

describe("suggestSelectors (fake model)", () => {
  test("returns a config and rows from the page", async () => {
    serve(`<div class="event"><a href="/e/1"><span class="title">Pine Hollows</span></a><time datetime="2026-11-14T20:00:00-07:00">Nov 14</time><img src="/i.jpg"></div>
           <div class="event"><a href="/e/2"><span class="title">Marlow Creek</span></a><time datetime="2026-11-15">Nov 15</time></div>`);
    const s = await suggestSelectors(URL0);
    assert.equal(s.model, "fake");
    assert.equal(s.config.item, ".event");
    assert.equal(s.rows.length, 2);
    assert.equal(s.rows[0].title, "Pine Hollows");
    assert.equal(s.rows[0].ticketUrl, "https://venue.example.com/e/1");
    assert.equal(s.rows[0].imageUrl, "https://venue.example.com/i.jpg");
  });
  test("a page with no events gives no rows, not an error", async () => {
    serve("<p>nothing</p>");
    const s = await suggestSelectors(URL0);
    assert.deepEqual(s.rows, []);
  });
});

describe("reconcileActs", () => {
  test("a set-order lineup missing an act takes the title's order and names", async () => {
    const { reconcileActs } = await import("@/server/events/bill");
    const r = reconcileActs([{ name: "Third Example", role: "headliner" }, { name: "Second Example", role: "support" }], "First Example + Second Example + Third Example");
    assert.deepEqual(r.acts.map((a) => `${a.name}:${a.role}`), ["First Example:headliner", "Second Example:support", "Third Example:support"]);
  });
  test("a source support act the title doesn't name is kept from the source", async () => {
    const { reconcileActs } = await import("@/server/events/bill");
    const r = reconcileActs([{ name: "Example Headliner", role: "headliner" }, { name: "Example Opener", role: "support" }], "Example Headliner");
    assert.deepEqual(r.acts.map((a) => a.name), ["Example Headliner", "Example Opener"]);
  });
  test("\"w\" without a slash splits the bill", () => {
    assert.deepEqual(splitTitle("Example Band w Other Example").acts.map((a) => a.role), ["headliner", "support"]);
  });
});
