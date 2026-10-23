import { test } from "node:test";
import assert from "node:assert/strict";
import { BAND_TIME_ZONE, dateInBandZone, fmtInstant } from "@/lib/timezone";
import { todayStr, upcomingDeadlines } from "@/lib/booking";

test("the band's timezone is America/Denver", () => {
  assert.equal(BAND_TIME_ZONE, "America/Denver");
});

test("'today' is the Denver date, not the UTC date", () => {
  // 03:30 UTC on Jan 15 is still the evening of Jan 14 in Denver (MST, UTC-7).
  assert.equal(dateInBandZone(new Date("2027-01-15T03:30:00Z")), "2027-01-14");
  assert.equal(todayStr(new Date("2027-01-15T03:30:00Z")), "2027-01-14");
  // Summer (MDT, UTC-6): 05:59 UTC is 23:59 the day before, 06:00 UTC is midnight.
  assert.equal(dateInBandZone(new Date("2027-07-04T05:59:00Z")), "2027-07-03");
  assert.equal(dateInBandZone(new Date("2027-07-04T06:00:00Z")), "2027-07-04");
  // Daylight-saving switch days resolve to the right date too.
  assert.equal(dateInBandZone(new Date("2027-03-14T12:00:00Z")), "2027-03-14");
  assert.equal(dateInBandZone(new Date("2027-11-07T07:30:00Z")), "2027-11-07");
});

test("the result does not depend on the process timezone", () => {
  const before = process.env.TZ;
  try {
    for (const tz of ["Pacific/Auckland", "Europe/London", "America/New_York"]) {
      process.env.TZ = tz;
      assert.equal(dateInBandZone(new Date("2027-01-15T03:30:00Z")), "2027-01-14", tz);
    }
  } finally {
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
});

test("instants are displayed in Denver time", () => {
  assert.equal(fmtInstant("2027-01-15T03:30:00Z"), "Jan 14, 8:30 PM");
  assert.equal(fmtInstant("2027-07-04T06:00:00Z"), "Jul 4, 12:00 AM");
});

test("deadline windows are plain calendar arithmetic", () => {
  const ed = (date: string) => ({ appDeadline: { date } });
  const hit = upcomingDeadlines([ed("2027-03-10"), ed("2027-03-11")], "2027-03-01", 9);
  assert.deepEqual(hit.map((e) => e.appDeadline.date), ["2027-03-10"]);
});
