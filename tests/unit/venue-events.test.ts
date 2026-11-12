import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { splitTitle, isMusic, cleanTitle } from "@/server/events/bill";
import { parseDateText, parseTime, resolveStartsAt, todayIn } from "@/server/events/dates";
import { extract } from "@/server/events/selectors";
import { readCalendar, toDraft, eventId, markRuns, type EventDraft } from "@/server/events/refresh";
import { suggestSelectors } from "@/server/events/suggest";
import { Net, setFetcher, type RawPage } from "@/server/events/fetch";
import { billParts, byWhen, eventTime, fmtClock, fmtEventDay, fmtEventYear, isUpcoming, openerChance, booksOpeners, roomStats, MIN_BILLS, titleSaysMore, whenFrom, addMonths, latestFirst, showListed, genresMatch, genreOptions, readShowFilter, showFilterFromParams, showFilterToParams, DEFAULT_SHOW_FILTER, nextCalendarLimit, genreFit, tourStops, isColorado, showActLinks } from "@/lib/venueEvents";
import { parseIcs } from "@/server/events/readers/ics";
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

describe("splitTitle (prod titles)", () => {
  const roles = (t: string) => splitTitle(t).acts.map((a) => `${a.name}:${a.role}`);
  test("very special guest is a named support act", () => {
    assert.deepEqual(roles("Trace Bundy 18th Annual Acoustic Holiday With very special guest Andy McKee"), ["Trace Bundy:headliner", "Andy McKee:support"]);
  });
  test("musical guest", () => {
    assert.deepEqual(roles("Hazlett with musical guest lighthearted"), ["Hazlett:headliner", "lighthearted:support"]);
  });
  test("+ Special Guests Name", () => {
    assert.deepEqual(names("Catie Turner + Special Guests Kiss Bang"), ["Catie Turner", "Kiss Bang"]);
  });
  test("per-night dates are dropped from support names", () => {
    assert.deepEqual(names("Leftover Salmon Feat. Sam Bush with special guests Deer Creek Sharpshooters (11/27) and Tonewood (11/28)"),
      ["Leftover Salmon", "Sam Bush", "Deer Creek Sharpshooters", "Tonewood"]);
  });
  test("a band named Filmmaker Support Group", () => {
    const b = splitTitle("Filmmaker Support Group");
    assert.deepEqual(b.acts, [{ name: "Filmmaker Support Group", role: "headliner" }]);
    assert.equal(b.supportTba, false);
    assert.equal(isMusic("Filmmaker Support Group"), true);
  });
  test("feat. list drops guest musicians", () => {
    assert.deepEqual(names("Last Waltz Revisited feat. Polytoxic, The Denver Horns & Guest Musicians"), ["Last Waltz Revisited", "Polytoxic", "The Denver Horns"]);
  });
  test("RESCHEDULED prefix and An Evening with", () => {
    assert.equal(names("RESCHEDULED\u2013An Evening with Julian Lage Quartet feat. John Medeski, Jorge Roeder")[0], "Julian Lage Quartet");
  });
  test("a parenthetical after the headliner", () => {
    assert.deepEqual(names("Jim James (Solo Acoustic) with special guest Lauren Frihauf"), ["Jim James", "Lauren Frihauf"]);
  });
  test("a two-night-stand tail is dropped", () => {
    assert.deepEqual(names("Assembly of Dust | Reid Genauer's Epic Two-Night Stand (Night 2)"), ["Assembly of Dust"]);
  });
  test("special guests TBA / unnamed means support TBA, one act", () => {
    for (const t of ["Band with special guests TBA", "Headline Example Trio with special guests"]) {
      const b = splitTitle(t);
      assert.equal(b.acts.length, 1, t);
      assert.equal(b.supportTba, true, t);
    }
  });
});

describe("isMusic", () => {
  test("holiday greetings, drawing clubs and science on tap are not music", () => {
    for (const t of ["Merry Christmas!", "Dead Pen Drawing Club", "Science On Tap"]) assert.equal(isMusic(t), false, t);
    assert.equal(isMusic("Happy Hour with The Pine Hollows band"), true);
  });
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

describe("openerChance", () => {
  const act = (name: string, role: "headliner" | "support" | "unknown" = "headliner") => ({ name, role });
  const TODAY = "2026-11-11";
  const FAR = "2026-12-16"; // 5 weeks out
  const ev = (o: Record<string, unknown> = {}) => ({ acts: [act("A")], bill: "title" as const, title: "A", date: FAR, status: "onsale" as const, ...o }) as Parameters<typeof openerChance>[0];
  const has = (r: { reasons: string[] }, re: RegExp) => r.reasons.some((x) => re.test(x));

  test("cancelled, gone and past are unlikely, with the one stop reason", () => {
    assert.deepEqual(openerChance(ev({ status: "cancelled" }), null, TODAY).reasons, ["Cancelled"]);
    assert.deepEqual(openerChance(ev({ status: "gone" }), null, TODAY).reasons, ["No longer on the venue’s calendar"]);
    const past = openerChance(ev({ date: "2026-11-10" }), null, TODAY);
    assert.equal(past.chance, "unlikely");
    assert.deepEqual(past.reasons, ["Already happened"]);
    assert.equal(openerChance(ev({ status: "cancelled" }), null, TODAY).chance, "unlikely");
  });
  test("support already listed is unlikely", () => {
    const r = openerChance(ev({ acts: [act("A"), act("B", "support")], bill: "full" }), null, TODAY);
    assert.equal(r.chance, "unlikely");
    assert.ok(has(r, /Support already listed/));
  });
  test("support TBA and one act far out is likely", () => {
    const r = openerChance(ev({ supportTba: true }), null, TODAY);
    assert.equal(r.chance, "likely");
    assert.ok(has(r, /to be announced/));
  });
  test("a full-bill source with only a headliner 5 weeks out is likely", () => {
    const r = openerChance(ev({ bill: "full" }), null, TODAY);
    assert.equal(r.chance, "likely");
    assert.ok(has(r, /lists support acts/));
    assert.ok(has(r, /good time to ask/));
  });
  test("a title-only single act 5 weeks out is maybe", () => {
    const r = openerChance(ev(), null, TODAY);
    assert.equal(r.chance, "maybe");
    assert.ok(has(r, /One act listed/));
  });
  test("under 2 weeks out is unlikely", () => {
    const r = openerChance(ev({ date: "2026-11-20", bill: "full" }), null, TODAY);
    assert.equal(r.chance, "unlikely");
    assert.ok(has(r, /Under 2 weeks/));
  });
  test("the room's record lifts or drops the score", () => {
    const base = openerChance(ev(), null, TODAY);
    const often = openerChance(ev(), { supportShare: 0.6, billsSeen: 10 }, TODAY);
    const rarely = openerChance(ev(), { supportShare: 0.1, billsSeen: 10 }, TODAY);
    assert.equal(often.chance, "likely");
    assert.ok(has(often, /books openers often/));
    assert.equal(often.score, base.score + 1);
    assert.ok(has(rarely, /rarely books openers/));
    assert.equal(rarely.score, base.score - 1);
  });
  test("a record under MIN_BILLS is ignored", () => {
    const base = openerChance(ev(), null, TODAY);
    for (const share of [0.9, 0.0]) {
      const r = openerChance(ev(), { supportShare: share, billsSeen: MIN_BILLS - 1 }, TODAY);
      assert.equal(r.score, base.score);
      assert.ok(!has(r, /room (?:rarely )?books/i));
    }
  });
  test("themed titles carry a themed reason and are never likely", () => {
    const themed: [string, RegExp][] = [
      ["Emo Nite", /theme night/],
      ["Dear Creedence: A Tribute to Creedence Clearwater Revival", /tribute/],
      ["REPRISE: Recreating Iconic Phish Shows", /recreation/],
      ["Last Waltz Revisited feat. Polytoxic", /recreation/],
      ["Open Mic Night", /open mic/i],
      ["Residency Concert Series (every Wednesday)", /residency/],
      ["An Evening with Firefall", /An evening with/i],
      ["2000's Rave", /theme night/],
      ["DJ Meredith Marks", /DJ night/],
    ];
    for (const [title, re] of themed) {
      for (const o of [{}, { supportTba: true }, { bill: "full" as const }]) {
        const r = openerChance(ev({ title, ...o }), null, TODAY);
        assert.ok(has(r, re), `${title}: ${r.reasons.join("; ")}`);
        assert.notEqual(r.chance, "likely", title);
      }
    }
  });
  test("multi-night runs add a reason", () => {
    assert.ok(has(openerChance(ev({ nights: 2 }), null, TODAY), /multi-night run/));
    assert.ok(has(openerChance(ev({ title: "A (Night 2)" }), null, TODAY), /multi-night run/));
    assert.ok(!has(openerChance(ev(), null, TODAY), /multi-night run/));
  });
  test("a band called Filmmaker Support Group is not a listed support act", () => {
    const b = splitTitle("Filmmaker Support Group");
    const r = openerChance(ev({ title: "Filmmaker Support Group", acts: b.acts, supportTba: b.supportTba }), null, TODAY);
    assert.ok(!has(r, /Support already listed/));
    assert.ok(!has(r, /to be announced/));
  });
});

describe("booksOpeners and roomStats", () => {
  const TODAY = "2026-11-11";
  const h = (name: string) => ({ name, role: "headliner" as const });
  const s = (name: string) => ({ name, role: "support" as const });
  const show = (o: Record<string, unknown> = {}) => ({ acts: [h("A")], bill: "full" as const, title: "A", date: "2026-12-20", status: "onsale" as const, ...o }) as Parameters<typeof roomStats>[0][number];

  test("thresholds", () => {
    assert.equal(booksOpeners(null), "unknown");
    assert.equal(booksOpeners(undefined), "unknown");
    assert.equal(booksOpeners({ supportShare: 0.9, billsSeen: MIN_BILLS - 1 }), "unknown");
    assert.equal(booksOpeners({ billsSeen: 20 }), "unknown");
    assert.equal(booksOpeners({ supportShare: 0.5, billsSeen: MIN_BILLS }), "often");
    assert.equal(booksOpeners({ supportShare: 0.49, billsSeen: MIN_BILLS }), "sometimes");
    assert.equal(booksOpeners({ supportShare: 0.2, billsSeen: MIN_BILLS }), "sometimes");
    assert.equal(booksOpeners({ supportShare: 0.19, billsSeen: MIN_BILLS }), "rarely");
    assert.equal(booksOpeners({ supportShare: 0, billsSeen: MIN_BILLS }), "rarely");
  });
  test("only settled bills count: full-bill sources, under 2 weeks out, or past", () => {
    const r = roomStats([
      show({ acts: [h("A"), s("B")] }), // full bill, support
      show(), // full bill, none
      show({ bill: "title", date: "2026-12-20" }), // title-only far out: not settled
      show({ bill: "title", date: "2026-11-20", acts: [h("A"), s("B")] }), // under 2 weeks
      show({ bill: "title", date: "2026-10-01" }), // past
    ], TODAY);
    assert.equal(r.billsSeen, 4);
    assert.equal(r.supportShare, 0.5);
  });
  test("cancelled, gone, themed and act-less shows are skipped", () => {
    const r = roomStats([
      show({ status: "cancelled" }), show({ status: "gone" }), show({ title: "Emo Nite" }), show({ acts: [] }),
      show({ acts: [h("A"), s("B")] }),
    ], TODAY);
    assert.deepEqual(r, { billsSeen: 1, supportShare: 1 });
  });
  test("supportShare is rounded to 2 decimals", () => {
    const r = roomStats([show({ acts: [h("A"), s("B")] }), show(), show()], TODAY);
    assert.equal(r.supportShare, 0.33);
    const r2 = roomStats([show({ acts: [h("A"), s("B")] }), show({ acts: [h("A"), s("B")] }), show()], TODAY);
    assert.equal(r2.supportShare, 0.67);
  });
  test("no supportShare when nothing is settled", () => {
    const r = roomStats([], TODAY);
    assert.deepEqual(r, { billsSeen: 0 });
    assert.ok(!("supportShare" in r));
    assert.deepEqual(roomStats([show({ bill: "title" })], TODAY), { billsSeen: 0 });
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

describe("markRuns", () => {
  const d = (date: string, head: string, o: Record<string, unknown> = {}) => ({ date, title: head, acts: [{ name: head, role: "headliner" }], bill: "title", status: "onsale", ...o }) as unknown as EventDraft;
  test("the same headliner on nights in a row is a run", () => {
    const a = d("2026-11-27", "Leftover Salmon"), b = d("2026-11-28", "Leftover Salmon");
    markRuns([a, b]);
    assert.equal(a.nights, 2);
    assert.equal(b.nights, 2);
  });
  test("a weekly repeat is not a run", () => {
    const a = d("2026-11-04", "Open Jam"), b = d("2026-11-11", "Open Jam");
    markRuns([a, b]);
    assert.equal(a.nights, undefined);
    assert.equal(b.nights, undefined);
  });
  test("a cancelled night is skipped", () => {
    const a = d("2026-11-27", "Leftover Salmon"), b = d("2026-11-28", "Leftover Salmon", { status: "cancelled" });
    markRuns([a, b]);
    assert.equal(a.nights, undefined);
    assert.equal(b.nights, undefined);
  });
});

describe("parseIcs posters", () => {
  const cal = (extra: string) => `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nSUMMARY:A Band\r\nDTSTART:20261114T200000Z\r\n${extra}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  test("IMAGE;VALUE=URI", () => {
    assert.equal(parseIcs(cal("IMAGE;VALUE=URI:https://x.example.com/a.jpg"))[0].imageUrl, "https://x.example.com/a.jpg");
  });
  test("ATTACH with an image FMTTYPE", () => {
    assert.equal(parseIcs(cal("ATTACH;FMTTYPE=image/jpeg:https://x.example.com/b.jpg"))[0].imageUrl, "https://x.example.com/b.jpg");
  });
  test("a non-image ATTACH or inline base64 is not a poster", () => {
    assert.equal(parseIcs(cal("ATTACH;FMTTYPE=application/pdf:https://x.example.com/c.pdf"))[0].imageUrl, undefined);
    assert.equal(parseIcs(cal("ATTACH;FMTTYPE=image/png;ENCODING=BASE64;VALUE=BINARY:AAAA"))[0].imageUrl, undefined);
    assert.equal(parseIcs(cal("X-NOTHING:1"))[0].imageUrl, undefined);
  });
});

describe("splitTitle and isMusic: prod refresh follow-ups (#76)", () => {
  test("\"& Friends\" stays part of the act's name", () => {
    assert.deepEqual(names("Oteil & Friends featuring Steve Kimock"), ["Oteil & Friends", "Steve Kimock"]);
    assert.deepEqual(names("Angie Stevens and Friends"), ["Angie Stevens and Friends"]);
  });
  test("an annual event's name is kept when no guest follows", () => {
    assert.deepEqual(names("Dear Jack Foundation's 10th Annual VIP Night"), ["Dear Jack Foundation's 10th Annual VIP Night"]);
  });
  test("a happy hour with a band is music; a happy hour with hours is not", () => {
    assert.equal(isMusic("Happy Hour @ The Junkyard Social Club with Sol Aldinger"), true);
    assert.equal(isMusic("Happy Hour 3-6PM"), false);
    assert.equal(isMusic("Songwriters at the Speakeasy", [], "Happy hour drinks and a meetup of local songwriters"), true);
  });
});

describe("whenFrom (the When filter)", () => {
  test("all times starts today; 3 and 6 months out start on the same day of the month", () => {
    assert.equal(whenFrom("2026-11-11", "any"), "2026-11-11");
    assert.equal(whenFrom("2026-11-11", "3m"), "2027-02-11");
    assert.equal(whenFrom("2026-11-11", "6m"), "2027-05-11");
  });
  test("a day the later month lacks is that month's last day", () => {
    assert.equal(addMonths("2027-01-31", 1), "2027-02-28");
    assert.equal(addMonths("2027-11-30", 3), "2028-02-29");
  });
});

describe("show filters", () => {
  const TODAY = "2026-11-11";
  const ev = (date: string, actId = "a1", start?: string) => ({ date, start, acts: [{ name: "A", role: "headliner" as const, actId }, { name: "B", role: "support" as const, actId: "b1" }] });
  const acts = new Map<string, string[] | undefined>([["a1", ["indie folk"]], ["a2", ["death metal"]], ["b1", ["indie rock"]]]);
  const x = (o: Partial<Parameters<typeof showListed>[2]> = {}) => ({ from: TODAY, acts, chance: () => "likely" as const, ...o });
  test("furthest out first, then the later start on a day", () => {
    const rows = [ev("2026-12-01"), ev("2027-06-01"), ev("2027-01-01", "a1", "19:00"), ev("2027-01-01", "a1", "21:00")].sort(latestFirst);
    assert.deepEqual(rows.map((r) => `${r.date} ${r.start ?? ""}`.trim()), ["2027-06-01", "2027-01-01 21:00", "2027-01-01 19:00", "2026-12-01"]);
  });
  test("the default: likely only, not-a-fit hidden, any genre, all times", () => {
    assert.deepEqual(DEFAULT_SHOW_FILTER, { show: "likely", hideNotFit: true, genres: [], when: "any" });
    assert.deepEqual(readShowFilter({ show: "hide", when: "1m", genres: ["indie", 3] }), { ...DEFAULT_SHOW_FILTER, genres: ["indie"] });
  });
  test("in the URL: defaults left out, the rest round-trips, anything unknown is the default", () => {
    assert.equal(showFilterToParams(new URLSearchParams("tab=x&show=all"), DEFAULT_SHOW_FILTER).toString(), "tab=x");
    const f = { show: "all" as const, hideNotFit: false, genres: ["indie", "folk rock"], when: "6m" as const };
    const u = showFilterToParams(new URLSearchParams("region=denver"), f);
    assert.equal(u.toString(), "region=denver&show=all&notfit=show&genre=indie&genre=folk+rock&when=6m");
    assert.deepEqual(showFilterFromParams(u), f);
    assert.deepEqual(showFilterFromParams(new URLSearchParams("show=hide&when=1m&notfit=yes")), DEFAULT_SHOW_FILTER);
  });
  test("the filters add up: likely, not hidden, the main act's genre and far enough out", () => {
    const f = { ...DEFAULT_SHOW_FILTER, genres: ["indie"] };
    assert.equal(showListed(ev("2027-01-01"), f, x()), true);
    assert.equal(showListed(ev("2027-01-01"), f, x({ chance: () => "maybe" })), false);
    assert.equal(showListed(ev("2027-01-01"), { ...f, show: "all" }, x({ chance: () => "maybe" })), true);
    assert.equal(showListed(ev("2027-01-01"), f, x({ take: "notFit" })), false);
    assert.equal(showListed(ev("2027-01-01"), { ...f, hideNotFit: false }, x({ take: "notFit" })), true);
    // the support act's genre doesn't count: only the main act's
    assert.equal(showListed(ev("2027-01-01", "a2"), { ...f, genres: ["indie rock"] }, x()), false);
    assert.equal(showListed(ev("2027-01-01", "a2"), { ...f, genres: ["indie", "metal"] }, x()), true);
    assert.equal(showListed(ev("2027-01-01"), f, x({ from: whenFrom(TODAY, "3m") })), false);
    assert.equal(showListed(ev("2027-03-01"), f, x({ from: whenFrom(TODAY, "3m") })), true);
  });
  test("a picked genre covers the genres with all its words", () => {
    assert.equal(genresMatch([], undefined), true);
    assert.equal(genresMatch(["indie"], ["indie folk"]), true);
    assert.equal(genresMatch(["indie folk"], ["folk"]), false);
    assert.equal(genresMatch(["Indie"], ["indie-pop"]), true);
    assert.equal(genresMatch(["indie"], undefined), false);
  });
  test("genre choices: ours first, then the rest, most common first", () => {
    assert.deepEqual(genreOptions(["folk"], [["rock", "folk"], ["rock"], ["jazz"], undefined]), { ours: ["folk"], rest: ["rock", "jazz"] });
  });
});

describe("nextCalendarLimit (Venue calendars reading on past filtered-out shows)", () => {
  test("waits for the server's answer, stops at the end of the calendars or once a page matches, else doubles", () => {
    assert.equal(nextCalendarLimit(50, null, 0, 50), 50); // no server answer yet (or only the cache's)
    assert.equal(nextCalendarLimit(100, 50, 0, 50), 100); // a short read is the end
    assert.equal(nextCalendarLimit(50, 50, 50, 50), 50); // a page's worth matches
    assert.equal(nextCalendarLimit(50, 50, 3, 50), 100);
  });
  test("a sparse filter over a big calendar settles in a few reads, not one per page", () => {
    // 3,000 upcoming shows, one in 60 a likely opener slot (prod had ~40 reads of 50 for one click)
    const shows = Array.from({ length: 3000 }, (_, i) => i % 60 === 0);
    let limit = 50, reads = 0;
    for (;;) {
      const got = shows.slice(0, limit);
      reads++;
      const next = nextCalendarLimit(limit, got.length, got.filter(Boolean).length, 50);
      if (next === limit) break;
      limit = next;
      assert.ok(reads < 20, "the limit never settles");
    }
    assert.ok(reads <= 7, `took ${reads} reads`);
  });
});

describe("genre fit (#79)", () => {
  const TODAY = "2026-11-11";
  const ev = (o: Record<string, unknown> = {}) => ({ acts: [{ name: "A", role: "headliner", actId: "a1" }], bill: "title" as const, title: "A", date: "2026-12-16", status: "onsale" as const, ...o }) as Parameters<typeof openerChance>[0];
  const g = (ours: string[], theirs?: string[]) => ({ ours, acts: new Map([["a1", theirs]]) });
  test("an overlapping headliner moves the show up a step and says so", () => {
    const plain = openerChance(ev(), null, TODAY);
    assert.equal(plain.chance, "maybe");
    const fit = openerChance(ev(), null, TODAY, g(["americana", "folk"], ["indie folk", "rock"]));
    assert.equal(fit.chance, "likely");
    assert.equal(fit.score, plain.score);
    assert.match(fit.reasons.at(-1)!, /^Genre fit: they play indie folk, like us$/);
  });
  test("unlikely becomes maybe; likely stays likely", () => {
    const sup = ev({ acts: [{ name: "A", role: "headliner", actId: "a1" }, { name: "B", role: "support" }], bill: "full" });
    assert.equal(openerChance(sup, null, TODAY).chance, "unlikely");
    assert.equal(openerChance(sup, null, TODAY, g(["folk"], ["folk"])).chance, "maybe");
    assert.equal(openerChance(ev({ supportTba: true }), null, TODAY, g(["folk"], ["folk"])).chance, "likely");
  });
  test("no fit, no genres, no act id, or a stop reason: nothing changes", () => {
    assert.equal(openerChance(ev(), null, TODAY, g(["folk"], ["indie rock"])).chance, "maybe");
    assert.equal(openerChance(ev(), null, TODAY, g([], ["folk"])).chance, "maybe");
    assert.equal(openerChance(ev(), null, TODAY, g(["folk"])).chance, "maybe");
    assert.equal(openerChance(ev({ acts: [{ name: "A", role: "headliner" }] }), null, TODAY, g(["folk"], ["folk"])).chance, "maybe");
    assert.deepEqual(openerChance(ev({ status: "cancelled" }), null, TODAY, g(["folk"], ["folk"])), { chance: "unlikely", score: -99, reasons: ["Cancelled"] });
  });
  test("genres match on whole words, either way round, ignoring case", () => {
    assert.deepEqual(genreFit(ev(), g(["Indie Folk"], ["folk", "indie rock", "folk-pop"])), ["folk"]);
    assert.deepEqual(genreFit(ev(), g(["rock"], ["rockabilly", "indie rock"])), ["indie rock"]);
    assert.deepEqual(genreFit(ev({ acts: [{ name: "B", role: "support", actId: "a1" }] }), g(["folk"], ["folk"])), [], "only the headliner counts");
  });
});

describe("tourStops (#79)", () => {
  test("counts different rooms within the window, the show's own included", () => {
    const m = tourStops([
      { id: "a", venueId: "v1", date: "2027-01-10" },
      { id: "b", venueId: "v2", date: "2027-01-20" },
      { id: "c", venueId: "v3", date: "2027-02-05" },
      { id: "d", venueId: "v1", date: "2027-01-11" },
      { id: "e", venueId: "v4", date: "2027-06-01" },
    ]);
    assert.equal(m.get("a"), 2); // v1, v2 (c is 26 days on)
    assert.equal(m.get("b"), 3); // v1, v2, v3
    assert.equal(m.get("c"), 2); // v2, v3
    assert.equal(m.get("e"), 1);
  });
  test("two nights at one room is not a tour", () => {
    assert.equal(tourStops([{ id: "a", venueId: "v1", date: "2027-01-10" }, { id: "b", venueId: "v1", date: "2027-01-11" }]).get("a"), 1);
  });
  test("isColorado", () => {
    assert.equal(isColorado("CO"), true);
    assert.equal(isColorado(" colorado "), true);
    assert.equal(isColorado("WY"), false);
    assert.equal(isColorado(undefined), false);
  });
});

describe("showActLinks (Venue calendars' act cell)", () => {
  test("every linked act's links in ARTIST_LINKS order, bill order, each act once; acts with no record or links left out", () => {
    const links = new Map<string, Record<string, string> | undefined>([
      ["trio", { instagram: "https://instagram.com/trio", website: "https://trio.example", spotify: " " }],
      ["duo", {}],
      ["solo", { bandcamp: "https://solo.bandcamp.com" }],
    ]);
    const out = showActLinks([
      { name: "Trio", role: "headliner", actId: "trio" },
      { name: "Duo", role: "support", actId: "duo" },
      { name: "Unlinked", role: "support" },
      { name: "Gone", role: "support", actId: "gone" },
      { name: "Solo", role: "support", actId: "solo" },
      { name: "Trio again", role: "support", actId: "trio" },
    ], links);
    assert.deepEqual(out, [
      { actId: "trio", name: "Trio", links: [
        { key: "website", label: "Website", url: "https://trio.example" },
        { key: "instagram", label: "Instagram", url: "https://instagram.com/trio" },
      ] },
      { actId: "solo", name: "Solo", links: [{ key: "bandcamp", label: "Bandcamp", url: "https://solo.bandcamp.com" }] },
    ]);
    assert.deepEqual(showActLinks([], links), []);
  });
});
