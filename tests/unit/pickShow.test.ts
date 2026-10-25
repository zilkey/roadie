import { test } from "node:test";
import assert from "node:assert/strict";
import { pickShow, recentAndUpcoming, showWindow, wallToInstant, type PickableShow } from "../../src/lib/pickShow";

const DEN = "America/Denver";
const LA = "America/Los_Angeles";
/** An instant from a Denver wall clock. */
const den = (date: string, time: string) => wallToInstant(date, time, DEN);
const show = (id: string, date: string, times: PickableShow["times"] = {}, status = "confirmed"): PickableShow & { id: string } => ({ id, date, status, times });
const H = 3_600_000;

test("wall clocks convert to the right instant across DST", () => {
  assert.equal(new Date(wallToInstant("2026-07-04", "20:00", DEN)).toISOString(), "2026-07-05T02:00:00.000Z"); // MDT, UTC-6
  assert.equal(new Date(wallToInstant("2026-12-04", "20:00", DEN)).toISOString(), "2026-12-05T03:00:00.000Z"); // MST, UTC-7
  assert.equal(new Date(wallToInstant("2026-03-08", "12:00", DEN)).toISOString(), "2026-03-08T18:00:00.000Z"); // the day clocks spring forward
  assert.equal(new Date(wallToInstant("2026-11-01", "12:00", DEN)).toISOString(), "2026-11-01T19:00:00.000Z"); // the day they fall back
  assert.equal(new Date(wallToInstant("2026-07-04", "20:00", LA)).toISOString(), "2026-07-05T03:00:00.000Z");
});

test("window: doors minus 3h to the end of the set plus 3h, crossing midnight", () => {
  const s = show("a", "2026-07-04", { doors: "19:00", set: "21:30", setLengthSec: 9000 });
  const w = showWindow(s);
  assert.equal(w.start, den("2026-07-04", "16:00"));
  assert.equal(w.end, den("2026-07-05", "03:00")); // set ends midnight, +3h
  assert.equal(pickShow([s], den("2026-07-05", "02:30"))?.mode, "during");
  assert.equal(pickShow([s], den("2026-07-05", "03:01"))?.mode, "morning-after");
});

test("a set after midnight belongs to the next day", () => {
  const s = show("a", "2026-07-04", { doors: "22:00", set: "00:30", setLengthSec: 3600 });
  assert.equal(showWindow(s).end, den("2026-07-05", "04:30"));
});

test("start falls back: doors, then showStart, then set, then the day's start", () => {
  assert.equal(showWindow(show("a", "2026-07-04", { showStart: "20:00" })).start, den("2026-07-04", "17:00"));
  assert.equal(showWindow(show("a", "2026-07-04", { set: "21:00" })).start, den("2026-07-04", "18:00"));
  assert.equal(showWindow(show("a", "2026-07-04", {})).start, den("2026-07-04", "00:00"));
});

test("no set length: the window runs to the end of the day plus 3h", () => {
  const s = show("a", "2026-07-04", { doors: "19:00", set: "21:00" });
  assert.equal(showWindow(s).end, den("2026-07-05", "03:00") - 1);
  const noTimes = show("b", "2026-07-04");
  assert.equal(showWindow(noTimes).end, den("2026-07-05", "03:00") - 1);
});

test("legacy setLength minutes still count", () => {
  const s = show("a", "2026-07-04", { set: "21:00", setLength: 60 });
  assert.equal(showWindow(s).end, den("2026-07-04", "22:00") + 3 * H);
});

test("the next morning counts for 18h after the window ends, not a minute more", () => {
  const s = show("a", "2026-07-04", { doors: "19:00", set: "21:00", setLengthSec: 3600 }); // ends 01:00 on the 5th
  const end = den("2026-07-05", "01:00");
  const r = pickShow([s], end + 18 * H);
  assert.deepEqual(r && r.mode, "morning-after");
  assert.equal(pickShow([s], end + 18 * H + 60_000), null);
});

test("before the window opens, and with no shows, there is nothing", () => {
  const s = show("a", "2026-07-04", { doors: "19:00", set: "21:00", setLengthSec: 3600 });
  assert.equal(pickShow([s], den("2026-07-04", "15:59")), null);
  assert.equal(pickShow([], Date.now()), null);
});

test("matinee and night show the same day: the later show once its window opens", () => {
  const matinee = show("m", "2026-07-04", { doors: "13:00", set: "14:00", setLengthSec: 3600 }); // 10:00 to 20:00
  const night = show("n", "2026-07-04", { doors: "19:00", set: "21:00", setLengthSec: 3600 }); // 16:00 to 01:00
  const pick = (t: string) => pickShow([matinee, night], den("2026-07-04", t));
  assert.equal(pick("12:00")?.show.id, "m");
  assert.equal(pick("15:59")?.show.id, "m");
  assert.equal(pick("16:00")?.show.id, "n");
  assert.equal(pick("19:00")?.show.id, "n");
  assert.equal(pickShow([night, matinee], den("2026-07-04", "17:00"))?.show.id, "n", "input order doesn't matter");
});

test("during beats morning-after; of two morning-afters the most recently ended wins", () => {
  const last = show("l", "2026-07-03", { doors: "19:00", set: "21:00", setLengthSec: 3600 });
  const tonight = show("t", "2026-07-04", { doors: "19:00", set: "21:00", setLengthSec: 3600 });
  assert.deepEqual(pickShow([last, tonight], den("2026-07-04", "17:00")), { show: tonight, mode: "during" });
  const early = show("e", "2026-07-03", { doors: "12:00", set: "13:00", setLengthSec: 3600 });
  assert.equal(pickShow([early, last], den("2026-07-04", "09:00"))?.show.id, "l");
});

test("hold, canceled and dropped shows never count; played does", () => {
  for (const status of ["hold", "canceled", "dropped"]) {
    assert.equal(pickShow([show("x", "2026-07-04", { doors: "19:00" }, status)], den("2026-07-04", "20:00")), null, status);
  }
  assert.equal(pickShow([show("x", "2026-07-04", { doors: "19:00" }, "played")], den("2026-07-04", "20:00"))?.show.id, "x");
});

test("a show in Los Angeles runs on Pacific time, not the band's", () => {
  const s = show("la", "2026-07-04", { doors: "19:00", set: "21:00", setLengthSec: 3600 });
  const zoneOf = () => LA;
  // Pacific 16:00 is Denver 17:00; Denver 16:30 is only Pacific 15:30.
  assert.equal(pickShow([s], den("2026-07-04", "16:30"), { zoneOf }), null);
  assert.equal(pickShow([s], den("2026-07-04", "17:00"), { zoneOf })?.mode, "during");
  assert.equal(pickShow([s], den("2026-07-04", "16:30"))?.mode, "during", "in the band's zone the same instant is inside");
  // Ends 01:00 Pacific = 02:00 Denver.
  assert.equal(pickShow([s], den("2026-07-05", "02:00") + 60_000, { zoneOf })?.mode, "morning-after");
});

test("recentAndUpcoming: nearest first, 30 days each way, only confirmed or played", () => {
  const now = den("2026-07-10", "12:00");
  const list = [
    show("far-past", "2026-05-01"), show("last-week", "2026-07-03"), show("tonight", "2026-07-10", { doors: "19:00" }),
    show("next-week", "2026-07-17"), show("far-future", "2026-09-30"), show("held", "2026-07-10", {}, "hold"), show("next-month", "2026-08-05"),
  ];
  assert.deepEqual(recentAndUpcoming(list, now, 10).map((s) => s.id), ["tonight", "last-week", "next-week", "next-month"]);
  assert.deepEqual(recentAndUpcoming(list, now, 2).map((s) => s.id), ["tonight", "last-week"]);
});
