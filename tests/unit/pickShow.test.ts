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
  const w = showWindow(s, DEN);
  assert.equal(w.start, den("2026-07-04", "16:00"));
  assert.equal(w.end, den("2026-07-05", "03:00")); // set ends midnight, +3h
  assert.equal(pickShow([s], den("2026-07-05", "02:30"), { zoneOf: () => DEN })?.mode, "during");
  assert.equal(pickShow([s], den("2026-07-05", "03:01"), { zoneOf: () => DEN })?.mode, "morning-after");
});

test("a set after midnight belongs to the next day", () => {
  const s = show("a", "2026-07-04", { doors: "22:00", set: "00:30", setLengthSec: 3600 });
  assert.equal(showWindow(s, DEN).end, den("2026-07-05", "04:30"));
});

test("start falls back: doors, then showStart, then set, then the day's start", () => {
  assert.equal(showWindow(show("a", "2026-07-04", { showStart: "20:00" }), DEN).start, den("2026-07-04", "17:00"));
  assert.equal(showWindow(show("a", "2026-07-04", { set: "21:00" }), DEN).start, den("2026-07-04", "18:00"));
  assert.equal(showWindow(show("a", "2026-07-04", {}), DEN).start, den("2026-07-04", "00:00"));
});

test("no set length: the window runs to the end of the day plus 3h", () => {
  const s = show("a", "2026-07-04", { doors: "19:00", set: "21:00" });
  assert.equal(showWindow(s, DEN).end, den("2026-07-05", "03:00") - 1);
  const noTimes = show("b", "2026-07-04");
  assert.equal(showWindow(noTimes, DEN).end, den("2026-07-05", "03:00") - 1);
});

test("the next morning counts for 18h after the window ends, not a minute more", () => {
  const s = show("a", "2026-07-04", { doors: "19:00", set: "21:00", setLengthSec: 3600 }); // ends 01:00 on the 5th
  const end = den("2026-07-05", "01:00");
  const r = pickShow([s], end + 18 * H, { zoneOf: () => DEN });
  assert.deepEqual(r && r.mode, "morning-after");
  assert.equal(pickShow([s], end + 18 * H + 60_000, { zoneOf: () => DEN }), null);
});

test("before the window opens, and with no shows, there is nothing", () => {
  const s = show("a", "2026-07-04", { doors: "19:00", set: "21:00", setLengthSec: 3600 });
  assert.equal(pickShow([s], den("2026-07-04", "15:59"), { zoneOf: () => DEN }), null);
  assert.equal(pickShow([], Date.now(), { zoneOf: () => DEN }), null);
});

test("matinee and night show the same day: the later show once its window opens", () => {
  const matinee = show("m", "2026-07-04", { doors: "13:00", set: "14:00", setLengthSec: 3600 }); // 10:00 to 20:00
  const night = show("n", "2026-07-04", { doors: "19:00", set: "21:00", setLengthSec: 3600 }); // 16:00 to 01:00
  const pick = (t: string) => pickShow([matinee, night], den("2026-07-04", t), { zoneOf: () => DEN });
  assert.equal(pick("12:00")?.show.id, "m");
  assert.equal(pick("15:59")?.show.id, "m");
  assert.equal(pick("16:00")?.show.id, "n");
  assert.equal(pick("19:00")?.show.id, "n");
  assert.equal(pickShow([night, matinee], den("2026-07-04", "17:00"), { zoneOf: () => DEN })?.show.id, "n", "input order doesn't matter");
});

test("during beats morning-after; of two morning-afters the most recently ended wins", () => {
  const last = show("l", "2026-07-03", { doors: "19:00", set: "21:00", setLengthSec: 3600 });
  const tonight = show("t", "2026-07-04", { doors: "19:00", set: "21:00", setLengthSec: 3600 });
  assert.deepEqual(pickShow([last, tonight], den("2026-07-04", "17:00"), { zoneOf: () => DEN }), { show: tonight, mode: "during" });
  const early = show("e", "2026-07-03", { doors: "12:00", set: "13:00", setLengthSec: 3600 });
  assert.equal(pickShow([early, last], den("2026-07-04", "09:00"), { zoneOf: () => DEN })?.show.id, "l");
});

test("hold, canceled and dropped shows never count; played does", () => {
  for (const status of ["hold", "canceled", "dropped"]) {
    assert.equal(pickShow([show("x", "2026-07-04", { doors: "19:00" }, status)], den("2026-07-04", "20:00"), { zoneOf: () => DEN }), null, status);
  }
  assert.equal(pickShow([show("x", "2026-07-04", { doors: "19:00" }, "played")], den("2026-07-04", "20:00"), { zoneOf: () => DEN })?.show.id, "x");
});

test("a show in Los Angeles runs on Pacific time, not the band's", () => {
  const s = show("la", "2026-07-04", { doors: "19:00", set: "21:00", setLengthSec: 3600 });
  const zoneOf = () => LA;
  // Pacific 16:00 is Denver 17:00; Denver 16:30 is only Pacific 15:30.
  assert.equal(pickShow([s], den("2026-07-04", "16:30"), { zoneOf }), null);
  assert.equal(pickShow([s], den("2026-07-04", "17:00"), { zoneOf })?.mode, "during");
  assert.equal(pickShow([s], den("2026-07-04", "16:30"), { zoneOf: () => DEN })?.mode, "during", "in the artist's zone the same instant is inside");
  // Ends 01:00 Pacific = 02:00 Denver.
  assert.equal(pickShow([s], den("2026-07-05", "02:00") + 60_000, { zoneOf })?.mode, "morning-after");
});

test("recentAndUpcoming: nearest first, 30 days each way, only confirmed or played", () => {
  const now = den("2026-07-10", "12:00");
  const list = [
    show("far-past", "2026-05-01"), show("last-week", "2026-07-03"), show("tonight", "2026-07-10", { doors: "19:00" }),
    show("next-week", "2026-07-17"), show("far-future", "2026-09-30"), show("held", "2026-07-10", {}, "hold"), show("next-month", "2026-08-05"),
  ];
  assert.deepEqual(recentAndUpcoming(list, now, 10, { zoneOf: () => DEN }).map((s) => s.id), ["tonight", "last-week", "next-week", "next-month"]);
  assert.deepEqual(recentAndUpcoming(list, now, 2, { zoneOf: () => DEN }).map((s) => s.id), ["tonight", "last-week"]);
});

// ---------- signupShow: 1 hour before the show time to 3 hours after ----------

test("signupShow: an hour before to three hours after showStart, edges included", async () => {
  const { signupShow } = await import("@/lib/pickShow");
  // 2026-11-14 is MST (UTC-7): showStart 20:00 = 03:00Z on the 15th.
  const s = { id: "a", date: "2026-11-14", status: "confirmed", times: { doors: "19:00", showStart: "20:00", set: "21:30" } };
  const at = (iso: string) => signupShow([s], new Date(iso), { zoneOf: () => DEN })?.id ?? null;
  assert.equal(at("2026-11-15T02:00:00Z"), "a", "exactly 1h before");
  assert.equal(at("2026-11-15T01:59:59Z"), null);
  assert.equal(at("2026-11-15T06:00:00Z"), "a", "exactly 3h after");
  assert.equal(at("2026-11-15T06:00:01Z"), null);
});

test("signupShow: the show time is showStart, else set, else doors, else 19:00; holds never count", async () => {
  const { signupShow } = await import("@/lib/pickShow");
  const one = (times: Record<string, string>, status = "confirmed") => [{ id: "x", date: "2026-11-14", status, times }];
  // 19:00 MST = 02:00Z on the 15th; 1h before is 01:00Z.
  assert.equal(signupShow(one({}), new Date("2026-11-15T01:00:00Z"), { zoneOf: () => DEN })?.id, "x");
  assert.equal(signupShow(one({}), new Date("2026-11-15T00:59:00Z"), { zoneOf: () => DEN }), null);
  assert.equal(signupShow(one({ doors: "18:00" }), new Date("2026-11-15T00:00:00Z"), { zoneOf: () => DEN })?.id, "x", "doors 18:00: from 17:00");
  assert.equal(signupShow(one({ doors: "18:00", set: "22:00" }), new Date("2026-11-15T00:30:00Z"), { zoneOf: () => DEN }), null, "set beats doors: from 21:00");
  assert.equal(signupShow(one({}, "hold"), new Date("2026-11-15T02:00:00Z"), { zoneOf: () => DEN }), null);
  assert.equal(signupShow(one({}, "played"), new Date("2026-11-15T02:00:00Z"), { zoneOf: () => DEN })?.id, "x");
});

test("signupShow: two windows, the nearer show time wins; the venue zone moves it", async () => {
  const { signupShow } = await import("@/lib/pickShow");
  const early = { id: "early", date: "2026-11-14", status: "confirmed", times: { showStart: "17:00" } };
  const late = { id: "late", date: "2026-11-14", status: "confirmed", times: { showStart: "20:00" } };
  // 19:00 MST = 02:00Z: 2h after early, 1h before late.
  assert.equal(signupShow([early, late], new Date("2026-11-15T02:00:00Z"), { zoneOf: () => DEN })?.id, "late");
  assert.equal(signupShow([early, late], new Date("2026-11-15T01:00:00Z"), { zoneOf: () => DEN })?.id, "early");
  // 20:00 MST is 03:00Z (window to 06:00Z); 20:00 Pacific is 04:00Z (to 07:00Z). 06:30Z is inside only the Pacific one.
  assert.equal(signupShow([late], new Date("2026-11-15T06:30:00Z"), { zoneOf: () => DEN }), null);
  assert.equal(signupShow([late], new Date("2026-11-15T06:30:00Z"), { zoneOf: () => "America/Los_Angeles" })?.id, "late");
});

test("two artists, Denver and New York, and a Chicago venue: a show with no venue zone is on its artist's clock, the Chicago one on Chicago's", async () => {
  const { signupShow } = await import("@/lib/pickShow");
  const NYC = "America/New_York", CHI = "America/Chicago";
  const s = { id: "s", date: "2026-11-14", status: "confirmed", times: { showStart: "20:00" }, venue: { id: "v" } };
  // 20:00 in New York is 01:00Z on the 15th; in Denver 03:00Z; in Chicago 02:00Z. Signups open an hour before.
  const at = (zoneOf: () => string, iso: string) => signupShow([s], new Date(iso), { zoneOf })?.id ?? null;
  assert.equal(at(() => NYC, "2026-11-15T00:00:00Z"), "s", "New York artist: open at 19:00 New York");
  assert.equal(at(() => DEN, "2026-11-15T00:00:00Z"), null, "Denver artist: not yet");
  assert.equal(showWindow(s, NYC).start, showWindow(s, DEN).start - 2 * H);
  // The venue in Chicago: whichever artist plays it, the show is at 20:00 Chicago (02:00Z).
  const zones = new Map([["v", CHI]]);
  for (const home of [NYC, DEN]) {
    const zoneOf = (x: typeof s) => zones.get(x.venue.id) ?? home;
    assert.equal(signupShow([s], new Date("2026-11-15T01:00:00Z"), { zoneOf })?.id, "s", home);
    assert.equal(signupShow([s], new Date("2026-11-15T00:59:00Z"), { zoneOf }), null, home);
  }
});
