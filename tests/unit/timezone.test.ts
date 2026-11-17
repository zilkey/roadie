import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TIME_ZONE, dateInZone, dateTimeInZone, fmtInstant, zoneOptions } from "@/lib/timezone";
import { todayStr, upcomingDeadlines } from "@/lib/booking";

// Two artists, one in Denver and one in New York, and a pinned instant: nothing here reads the machine's zone.
const DEN = "America/Denver", NYC = "America/New_York", CHI = "America/Chicago";

test("a new artist with no zone picked starts in Denver", () => {
  assert.equal(DEFAULT_TIME_ZONE, DEN);
});

test("'today' is the artist's own date, not the UTC date", () => {
  // 03:30 UTC on Jan 15 is the evening of Jan 14 in Denver (MST, UTC-7) and in Chicago (UTC-6), but 22:30 on Jan 14 in New York too;
  // 05:30 UTC is still Jan 15 00:30 in New York and Jan 14 in Denver.
  assert.equal(dateInZone(DEN, new Date("2027-01-15T03:30:00Z")), "2027-01-14");
  assert.equal(dateInZone(NYC, new Date("2027-01-15T05:30:00Z")), "2027-01-15");
  assert.equal(dateInZone(DEN, new Date("2027-01-15T05:30:00Z")), "2027-01-14");
  assert.equal(dateInZone(CHI, new Date("2027-01-15T05:30:00Z")), "2027-01-14");
  assert.equal(todayStr(NYC, new Date("2027-01-15T05:30:00Z")), "2027-01-15");
  assert.equal(todayStr(DEN, new Date("2027-01-15T05:30:00Z")), "2027-01-14");
  // Summer (MDT, UTC-6): 05:59 UTC is 23:59 the day before, 06:00 UTC is midnight.
  assert.equal(dateInZone(DEN, new Date("2027-07-04T05:59:00Z")), "2027-07-03");
  assert.equal(dateInZone(DEN, new Date("2027-07-04T06:00:00Z")), "2027-07-04");
  // Daylight-saving switch days resolve to the right date too.
  assert.equal(dateInZone(DEN, new Date("2027-03-14T12:00:00Z")), "2027-03-14");
  assert.equal(dateInZone(NYC, new Date("2027-11-07T07:30:00Z")), "2027-11-07");
});

test("date and time in each artist's zone", () => {
  const t = new Date("2027-01-15T03:30:00Z");
  assert.equal(dateTimeInZone(DEN, t), "2027-01-14 20:30");
  assert.equal(dateTimeInZone(NYC, t), "2027-01-14 22:30");
  assert.equal(dateTimeInZone(CHI, t), "2027-01-14 21:30");
});

test("the result does not depend on the process timezone", () => {
  const before = process.env.TZ;
  try {
    for (const tz of ["Pacific/Auckland", "Europe/London", "America/New_York"]) {
      process.env.TZ = tz;
      assert.equal(dateInZone(DEN, new Date("2027-01-15T03:30:00Z")), "2027-01-14", tz);
      assert.equal(dateInZone(NYC, new Date("2027-01-15T05:30:00Z")), "2027-01-15", tz);
    }
  } finally {
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
});

test("instants are displayed in the zone asked for", () => {
  assert.equal(fmtInstant("2027-01-15T03:30:00Z", DEN), "Jan 14, 8:30 PM");
  assert.equal(fmtInstant("2027-01-15T03:30:00Z", NYC), "Jan 14, 10:30 PM");
  assert.equal(fmtInstant("2027-07-04T06:00:00Z", DEN), "Jul 4, 12:00 AM");
});

test("the zone pickers keep a saved zone the list doesn't have", () => {
  assert.ok(zoneOptions(DEN).some(([z]) => z === DEN));
  assert.deepEqual(zoneOptions("Europe/Berlin").at(-1), ["Europe/Berlin", "Europe/Berlin"]);
  assert.deepEqual(zoneOptions("America/Argentina/Buenos_Aires").at(-1), ["America/Argentina/Buenos_Aires", "America/Argentina/Buenos Aires"]);
});

test("deadline windows are plain calendar arithmetic", () => {
  const ed = (date: string) => ({ appDeadline: { date } });
  const hit = upcomingDeadlines([ed("2027-03-10"), ed("2027-03-11")], "2027-03-01", 9);
  assert.deepEqual(hit.map((e) => e.appDeadline.date), ["2027-03-10"]);
});
