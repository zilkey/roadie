/** The day-of banner's pure logic (#66): the window, the order rows stack in, what a row says, pruneDismissed. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayOfAfter, dayOfAsk, dayOfCongrats, dayOfDates, dayOfDismissLabel, dayOfItems, dayOfKey, dayOfText, pruneDismissed, rehearsalItem, showItem, zonedInstant, type DayOfRehearsal, type DayOfShow } from "@/lib/dayOf";

/** An instant from a Denver wall clock in November (MST, UTC-7): at("2026-11-10", "14:00"). */
const at = (date: string, time: string) => Date.parse(`${date}T${time}:00-07:00`);
const show = (id: string, times: DayOfShow["times"], extra: Partial<DayOfShow> = {}): DayOfShow =>
  ({ id, date: "2026-11-10", status: "confirmed", artistId: "a1", venue: { id: `v-${id}`, name: `Venue ${id}`, city: "Provo" }, times, ...extra });
const reh = (id: string, extra: Partial<DayOfRehearsal> = {}): DayOfRehearsal => ({ id, date: "2026-11-10", ...extra });
const on = (item: { start: number; end: number }, t: number) => item.start <= t && t < item.end;

// ---------- the window ----------

test("zonedInstant: a wall clock in a zone, in winter and summer time", () => {
  assert.equal(zonedInstant("2026-11-10", 17 * 60, "America/Denver"), Date.parse("2026-11-11T00:00:00Z"));
  assert.equal(zonedInstant("2026-07-10", 17 * 60, "America/Denver"), Date.parse("2026-07-10T23:00:00Z"));
  assert.equal(zonedInstant("2026-11-10", 17 * 60, "America/Chicago"), Date.parse("2026-11-10T23:00:00Z"));
  assert.equal(zonedInstant("2026-11-10", 24 * 60 + 30, "America/Denver"), Date.parse("2026-11-11T07:30:00Z"), "minutes past 1440 are the next day");
  // The night the clocks go back (Nov 1, 2026): 9 pm is already on winter time.
  assert.equal(zonedInstant("2026-11-01", 21 * 60, "America/Denver"), Date.parse("2026-11-02T04:00:00Z"));
});

test("a show: from 3 hours before load-in until 3 hours after its last time", () => {
  const s = showItem(show("s1", { loadIn: "17:00", soundcheck: "18:00", doors: "19:00", set: "21:00" }));
  assert.equal(s.start, at("2026-11-10", "14:00"));
  assert.equal(s.end, at("2026-11-11", "00:00"));
  assert.ok(!on(s, at("2026-11-10", "13:59")), "not before");
  assert.ok(on(s, at("2026-11-10", "14:00")));
  assert.ok(on(s, at("2026-11-10", "23:59")));
  assert.ok(!on(s, at("2026-11-11", "00:00")), "gone 3 hours after the set starts");
  assert.equal(s.href, "/shows/s1");
  assert.equal(s.key, "show:s1:2026-11-10");
  assert.deepEqual(s.points.map((p) => p.label), ["Load-in", "Soundcheck", "Doors", "Set starts"]);
});

test("a show without a load-in falls back to the next earliest time", () => {
  assert.equal(showItem(show("s", { soundcheck: "18:00", doors: "19:00", set: "21:00" })).start, at("2026-11-10", "15:00"));
  assert.equal(showItem(show("s", { doors: "19:00", showStart: "20:00" })).start, at("2026-11-10", "16:00"));
  assert.equal(showItem(show("s", { showStart: "20:00", set: "21:15" })).start, at("2026-11-10", "17:00"));
  const only = showItem(show("s", { set: "21:00" }));
  assert.equal(only.start, at("2026-11-10", "18:00"));
  assert.equal(only.end, at("2026-11-11", "00:00"));
  // Entered out of order (soundcheck before load-in): the earliest still opens the window, nothing rolls to tomorrow.
  const odd = showItem(show("s", { loadIn: "17:00", soundcheck: "16:00", set: "21:00" }));
  assert.equal(odd.start, at("2026-11-10", "13:00"));
  assert.equal(odd.end, at("2026-11-11", "00:00"));
  assert.deepEqual(odd.points.map((p) => p.label), ["Soundcheck", "Load-in", "Set starts"]);
});

test("a show's times are on the venue's clock; no zone (or a bad one) is the band's", () => {
  const chicago = showItem(show("s", { loadIn: "17:00", set: "21:00" }), "America/Chicago");
  assert.equal(chicago.start, Date.parse("2026-11-10T20:00:00Z"), "2 pm in Chicago is 1 pm in Denver");
  assert.equal(chicago.end, Date.parse("2026-11-11T06:00:00Z"));
  assert.equal(chicago.zone, "America/Chicago");
  assert.equal(showItem(show("s", { loadIn: "17:00" })).zone, "America/Denver");
  assert.equal(showItem(show("s", { loadIn: "17:00" }), "Not/AZone").start, at("2026-11-10", "14:00"));
  // dayOfItems looks the zone up by the show's venue id.
  const s = show("s", { loadIn: "17:00", set: "21:00" });
  const zones = new Map([[s.venue!.id, "America/Chicago"]]);
  assert.equal(dayOfItems({ shows: [s], rehearsals: [], now: at("2026-11-10", "13:30"), zones }).length, 1, "on by Chicago's clock");
  assert.equal(dayOfItems({ shows: [s], rehearsals: [], now: at("2026-11-10", "13:30") }).length, 0, "not yet by Denver's");
});

test("crossing midnight: a time after midnight is the same night, and the window runs into the next day", () => {
  const late = showItem(show("s", { doors: "22:00", set: "00:30" }));
  assert.equal(late.start, at("2026-11-10", "19:00"));
  assert.equal(late.points[1].at, at("2026-11-11", "00:30"));
  assert.equal(late.end, at("2026-11-11", "03:30"));
  assert.ok(on(late, at("2026-11-11", "01:00")), "still up after midnight");
  // An early load-in opens the window the evening before.
  assert.equal(showItem(show("s", { loadIn: "01:30", set: "09:00" })).start, at("2026-11-09", "22:30"));
  // A rehearsal that ends after midnight.
  const r = rehearsalItem(reh("r", { startTime: "22:00", endTime: "01:00" }));
  assert.equal(r.end, at("2026-11-11", "01:00"));
  assert.ok(on(r, at("2026-11-11", "00:30")));
  // The banner asks for yesterday's, today's and tomorrow's dates, so both ends are covered.
  assert.deepEqual(dayOfDates("2026-11-10"), ["2026-11-09", "2026-11-10", "2026-11-11"]);
  assert.deepEqual(dayOfDates("2027-01-01"), ["2026-12-31", "2027-01-01", "2027-01-02"]);
});

test("no times at all: all day on its date, midnight to midnight in its zone", () => {
  const s = showItem(show("s", {}));
  assert.equal(s.start, at("2026-11-10", "00:00"));
  assert.equal(s.end, at("2026-11-11", "00:00"));
  assert.equal(dayOfText(s, at("2026-11-10", "09:00")), "Today");
  const noTimes = showItem({ ...show("s", {}), times: undefined });
  assert.equal(noTimes.start, s.start);
  const chicago = showItem(show("s", {}), "America/Chicago");
  assert.equal(chicago.start, Date.parse("2026-11-10T06:00:00Z"));
  const r = rehearsalItem(reh("r"));
  assert.equal(r.start, at("2026-11-10", "00:00"));
  assert.equal(r.end, at("2026-11-11", "00:00"));
  assert.equal(dayOfText(r, at("2026-11-10", "09:00")), "Today");
  // Only an end time: all day until then.
  const ends = rehearsalItem(reh("r", { endTime: "21:00" }));
  assert.equal(ends.start, at("2026-11-10", "00:00"));
  assert.equal(ends.end, at("2026-11-10", "21:00"));
  assert.equal(dayOfText(ends, at("2026-11-10", "09:00")), "Today, until 9:00 pm");
});

test("a rehearsal: from 3 hours before its start until its end time, or 3 hours after the start", () => {
  const r = rehearsalItem(reh("r1", { startTime: "19:00", endTime: "21:00", location: { name: "Woodshed" } }));
  assert.equal(r.start, at("2026-11-10", "16:00"));
  assert.equal(r.end, at("2026-11-10", "21:00"));
  assert.equal(r.href, "/rehearsals/r1");
  assert.equal(r.title, "Woodshed");
  assert.equal(r.key, "rehearsal:r1:2026-11-10");
  const open = rehearsalItem(reh("r2", { startTime: "19:00" }));
  assert.equal(open.end, at("2026-11-10", "22:00"));
  assert.equal(open.title, "");
});

// ---------- which rows, in what order ----------

test("only this artist's confirmed shows, inside their window, and not the dismissed ones", () => {
  const now = at("2026-11-10", "15:00");
  const shows = [
    show("on", { loadIn: "17:00" }),
    show("hold", { loadIn: "17:00" }, { status: "hold" }),
    show("canceled", { loadIn: "17:00" }, { status: "canceled" }),
    show("played", { loadIn: "17:00" }, { status: "played" }),
    show("other", { loadIn: "17:00" }, { artistId: "a2" }),
    show("later", { loadIn: "19:00" }),
    show("yesterday", { loadIn: "17:00" }, { date: "2026-11-09" }),
  ];
  const rehearsals = [reh("r-on", { startTime: "16:00" }), reh("r-later", { startTime: "20:00" }), reh("r-gone", { startTime: "09:00", endTime: "11:00" })];
  const ids = (dismissed: string[] = []) => dayOfItems({ shows, rehearsals, now, artistId: "a1", dismissed }).map((x) => x.id);
  assert.deepEqual(ids(), ["r-on", "on"]);
  assert.deepEqual(ids([dayOfKey("show", "on", "2026-11-10")]), ["r-on"], "a dismissed row is gone, the other stays");
  assert.deepEqual(ids([dayOfKey("show", "on", "2026-11-09")]), ["r-on", "on"], "a dismissal for another date doesn't count");
  assert.deepEqual(ids([dayOfKey("rehearsal", "r-on", "2026-11-10"), dayOfKey("show", "on", "2026-11-10")]), []);
});

test("stacked rows: by when each first appears, then its first time, shows before rehearsals", () => {
  const shows = [show("evening", { loadIn: "17:00", set: "21:00" }), show("radio", { set: "12:30" }), show("b-tie", { loadIn: "14:00" }), show("a-tie", { loadIn: "14:00" })];
  const rehearsals = [reh("reh", { startTime: "14:00", endTime: "16:00" }), reh("allday")];
  const order = (time: string) => dayOfItems({ shows, rehearsals, now: at("2026-11-10", time), artistId: "a1" }).map((x) => x.id);
  // All day (since midnight) first, then radio (9:30), then the three that appear at 11:00: shows by id, then the rehearsal.
  assert.deepEqual(order("11:30"), ["allday", "radio", "a-tie", "b-tie", "reh"]);
  assert.deepEqual(order("14:30"), ["allday", "radio", "a-tie", "b-tie", "reh", "evening"]);
  assert.deepEqual(order("16:30"), ["allday", "a-tie", "b-tie", "evening"], "radio (3 hours after 12:30) and the rehearsal (its end) are over");
});

// ---------- what a row says ----------

test("the text follows the day: the next time still ahead, then On now", () => {
  const s = showItem(show("s", { loadIn: "17:00", soundcheck: "18:00", doors: "19:00", showStart: "20:00", set: "21:00" }));
  const say = (time: string) => dayOfText(s, at("2026-11-10", time));
  assert.equal(say("14:00"), "Load-in 5:00 pm");
  assert.equal(say("16:59"), "Load-in 5:00 pm");
  assert.equal(say("17:00"), "Soundcheck 6:00 pm");
  assert.equal(say("18:30"), "Doors 7:00 pm");
  assert.equal(say("19:00"), "Show starts 8:00 pm");
  assert.equal(say("20:15"), "Set starts 9:00 pm");
  assert.equal(say("21:00"), "On now");
  assert.equal(say("23:30"), "On now");
  assert.equal(dayOfText(showItem(show("s", { set: "21:00" })), at("2026-11-10", "18:00")), "Set starts 9:00 pm");

  const r = rehearsalItem(reh("r", { startTime: "19:00", endTime: "21:00" }));
  assert.equal(dayOfText(r, at("2026-11-10", "16:00")), "Starts 7:00 pm");
  assert.equal(dayOfText(r, at("2026-11-10", "19:00")), "On now, until 9:00 pm");
  assert.equal(dayOfText(rehearsalItem(reh("r", { startTime: "19:00" })), at("2026-11-10", "19:30")), "On now");
});

test("a venue in another time zone shows its own clock with the zone; names for the row and its dismiss button", () => {
  const s = showItem(show("s", { loadIn: "17:00" }), "America/Chicago");
  assert.equal(dayOfText(s, s.start), "Load-in 5:00 pm CST");
  assert.equal(dayOfText(showItem({ ...show("s", { loadIn: "17:00" }), date: "2026-07-10" }, "America/Chicago"), Date.parse("2026-07-10T20:00:00Z")), "Load-in 5:00 pm CDT");
  assert.equal(dayOfDismissLabel(showItem(show("s1", {}))), "Hide the banner for Venue s1");
  const house = showItem({ id: "h", date: "2026-11-10", status: "confirmed", kind: "house", hostName: "Wren and Lee", place: { city: "Provo" }, times: {} });
  assert.equal(house.title, "House concert · Wren and Lee");
  assert.equal(house.city, "Provo");
  assert.equal(dayOfDismissLabel(rehearsalItem(reh("r", { location: { name: "Woodshed" } }))), "Hide the banner for the rehearsal at Woodshed");
  assert.equal(dayOfDismissLabel(rehearsalItem(reh("r"))), "Hide the banner for the rehearsal");
});

test("after the show: an hour after its last time the row congratulates and asks Roadie about that show", () => {
  const s = showItem(show("s", { loadIn: "17:00", doors: "19:00", set: "21:00" }));
  assert.equal(dayOfAfter(s, at("2026-11-10", "21:00")), false);
  assert.equal(dayOfAfter(s, at("2026-11-10", "21:59")), false);
  assert.equal(dayOfAfter(s, at("2026-11-10", "22:00")), true);
  assert.equal(dayOfAfter(s, at("2026-11-10", "23:59")), true); // the row itself leaves at 00:00 (3 hours after the set)
  assert.equal(dayOfItems({ shows: [show("s", { set: "21:00" })], rehearsals: [], now: at("2026-11-11", "00:00") }).length, 0);
  // No times: "Today" all day, never the invite. A rehearsal never is.
  assert.equal(dayOfAfter(showItem(show("s", {})), at("2026-11-10", "23:00")), false);
  assert.equal(dayOfAfter(rehearsalItem(reh("r", { startTime: "19:00" })), at("2026-11-10", "21:30")), false);

  assert.equal(dayOfCongrats(showItem(show("s", { set: "21:00" }, { venue: { id: "v", name: "Deep End" } }))), "Congrats on the Deep End show!");
  assert.equal(dayOfAsk(showItem(show("s", { set: "21:00" }, { venue: { id: "v", name: "Deep End" } }))), "Ask me about the Deep End show");
  assert.equal(dayOfAsk(showItem(show("s", { set: "21:00" }, { venue: { id: "v", name: "The Red Barn" } }))), "Ask me about the Red Barn show");
  const house = showItem({ id: "h", date: "2026-11-10", status: "confirmed", kind: "house", hostName: "Wren and Lee", times: { set: "20:00" } });
  assert.equal(dayOfCongrats(house), "Congrats on the house concert!");
});

test("pruneDismissed keeps a week of dismissals", () => {
  assert.deepEqual(pruneDismissed(["show:a:2026-11-10", "show:b:2026-11-03", "rehearsal:c:2026-11-02", "show:d:2026-11-12", "junk"], "2026-11-10"), ["show:a:2026-11-10", "show:b:2026-11-03", "show:d:2026-11-12"]);
});

test("Roadie is not offered dayOf.dismiss: its tool list is unchanged by the banner", async () => {
  const { toolDefs } = await import("@/server/assistant/tools");
  assert.ok(!toolDefs("admin").some((t) => t.name.startsWith("dayOf.")));
});
