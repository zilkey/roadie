/** Tours (#45): the links from pitches and shows: which day of the tour a date is, when the tour's drive gets in, and where a pitch sits on the plan. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { arrivalOf, onPlanText, tourDayNumber, type EntryLike } from "@/lib/tours";

const e = (id: string, kind: EntryLike["kind"], date: string | undefined, position: number, more: Partial<EntryLike> = {}): EntryLike => ({ id, kind, date, position, ...more });

test("tourDayNumber counts the date among the tour's days", () => {
  const tour = { startDate: "2026-03-10", endDate: "2026-03-14" };
  assert.deepEqual(tourDayNumber(tour, [], "2026-03-10"), { n: 1, of: 5 });
  assert.deepEqual(tourDayNumber(tour, [], "2026-03-12"), { n: 3, of: 5 });
  assert.deepEqual(tourDayNumber({}, [e("a", "show", "2026-03-10", 1), e("b", "show", "2026-03-12", 1)], "2026-03-12"), { n: 3, of: 3 });
  assert.equal(tourDayNumber(tour, [], "2026-04-01"), null);
});

test("arrivalOf is leaveBy plus minutes of the last drive before the show", () => {
  const entries = [
    e("d1", "drive", "2026-03-12", 1, { leaveBy: "08:00", minutes: 60 }),
    e("d2", "drive", "2026-03-12", 2, { leaveBy: "13:00", minutes: 205 }),
    e("s", "show", "2026-03-12", 3, { showId: "x" }),
    e("d3", "drive", "2026-03-12", 4, { leaveBy: "22:00", minutes: 60 }),
  ];
  assert.equal(arrivalOf(entries, "2026-03-12"), "16:25");
  assert.equal(arrivalOf(entries, "2026-03-13"), null);
  assert.equal(arrivalOf([e("d", "drive", "2026-03-12", 1, { leaveBy: "08:00" })], "2026-03-12"), null);
  assert.equal(arrivalOf([e("d", "drive", "2026-03-12", 1, { leaveBy: "23:30", minutes: 90 })], "2026-03-12"), "01:00");
});

test("onPlanText lists a pitch's dates with its rank where options share a day", () => {
  const entries = [
    e("o1", "option", "2026-03-12", 1, { pitchId: "p1" }), e("o2", "option", "2026-03-12", 2, { pitchId: "p2" }),
    e("o3", "option", "2026-03-13", 1, { pitchId: "p1" }), e("o4", "option", undefined, 1, { pitchId: "p3" }),
  ];
  assert.equal(onPlanText(entries, "p1"), "Thu Mar 12 (option 1 of 2) · Fri Mar 13");
  assert.equal(onPlanText(entries, "p2"), "Thu Mar 12 (option 2 of 2)");
  assert.equal(onPlanText(entries, "p3"), "No date yet");
  assert.equal(onPlanText(entries, "zz"), "");
});
