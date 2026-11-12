import { test } from "node:test";
import assert from "node:assert/strict";
import { photoDay, dayLabels, groupByDay, dayTitle } from "@/lib/photoDays";
import { dateTimeInBandZone } from "@/lib/timezone";

test("photoDay: before 04:00 counts toward the day before, across a month and a year", () => {
  assert.equal(photoDay("2026-10-11 01:30"), "2026-10-10");
  assert.equal(photoDay("2026-10-11 03:59"), "2026-10-10");
  assert.equal(photoDay("2026-10-11 04:00"), "2026-10-11");
  assert.equal(photoDay("2026-11-01 00:10"), "2026-10-31");
  assert.equal(photoDay("2027-01-01 02:00"), "2026-12-31");
  assert.equal(photoDay(""), null);
});

test("dayLabels and groupByDay: hold, confirmed and played shows and rehearsals label their day; newest day first, undated last", () => {
  const labels = dayLabels(
    [
      { date: "2026-10-10", status: "played", venue: { id: "v", name: "Creamery Arts Center" } },
      { date: "2026-10-10", status: "dropped", venue: { id: "w", name: "Hi-Dive" } },
      { date: "2026-10-12", status: "confirmed", venue: { id: "x", name: "Deep End" }, deletedAt: new Date() },
    ],
    [{ date: "2026-10-10" }],
  );
  assert.deepEqual(labels.get("2026-10-10"), ["Creamery Arts Center", "Rehearsal"]);
  assert.equal(labels.get("2026-10-12"), undefined, "a deleted show doesn't label");
  const days = groupByDay([{ id: "a", takenAt: "" }, { id: "b", takenAt: "2026-10-11 01:30" }, { id: "c", takenAt: "2026-10-12 20:00" }, { id: "d", takenAt: "2026-10-10 21:00" }], labels);
  assert.deepEqual(days.map((d) => [d.day, d.photos.map((p) => p.id), d.labels.length]), [["2026-10-12", ["c"], 0], ["2026-10-10", ["b", "d"], 2], [null, ["a"], 0]]);
  assert.equal(dayTitle("2026-10-10"), "Sat, Oct 10, 2026");
  assert.equal(dayTitle(null), "No date");
});

test("dateTimeInBandZone: 24-hour, in Denver whatever the server's zone", () => {
  assert.equal(dateTimeInBandZone(new Date("2026-10-11T07:30:00Z")), "2026-10-11 01:30");
  assert.equal(dateTimeInBandZone(new Date("2026-11-01T18:05:00Z")), "2026-11-01 11:05");
  assert.equal(dateTimeInBandZone(new Date("2026-07-01T06:00:00Z")), "2026-07-01 00:00");
});
