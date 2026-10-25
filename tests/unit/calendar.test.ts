import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  conflictOf,
  daysUntil,
  itemsByDay,
  layerFilter,
  monthGrid,
  upcoming,
  type CalendarItem,
  type CalendarKind,
} from "@/lib/calendar";

function item(kind: CalendarKind, sourceId: string, date = "2026-12-12", extra: Partial<CalendarItem> = {}): CalendarItem {
  return { id: `${kind}:${sourceId}:${date}`, date, kind, title: sourceId, subtitle: "", href: `/x/${sourceId}`, sourceId, ...extra };
}

describe("conflictOf", () => {
  test("an empty day has no conflict", () => {
    assert.equal(conflictOf([]), null);
  });
  test("one show is not a conflict", () => {
    assert.equal(conflictOf([item("show", "s1")]), null);
  });
  test("two shows conflict", () => {
    assert.deepEqual(conflictOf([item("show", "s1"), item("show", "s2")]), { label: "2 shows" });
  });
  test("a show and a pitch date conflict", () => {
    assert.deepEqual(conflictOf([item("show", "s1"), item("pitchDate", "p1")]), { label: "show + pitch date" });
  });
  test("two pitches on one day conflict", () => {
    assert.deepEqual(conflictOf([item("pitchDate", "p1"), item("pitchDate", "p2")]), { label: "2 pitch dates overlap" });
  });
  test("one pitch listing the same day twice counts once", () => {
    assert.equal(conflictOf([item("pitchDate", "p1"), item("pitchDate", "p1")]), null);
  });
  test("a festival-only day is not a conflict", () => {
    assert.equal(conflictOf([item("festivalDay", "e1"), item("festivalDay", "e2")]), null);
  });
  test("opens + deadline is not a conflict", () => {
    assert.equal(conflictOf([item("opens", "e1"), item("deadline", "e1")]), null);
  });
  test("show + rehearsal is not a conflict", () => {
    assert.equal(conflictOf([item("show", "s1"), item("rehearsal", "r1")]), null);
  });
  test("a past day still conflicts", () => {
    const day = "2020-01-01";
    assert.deepEqual(conflictOf([item("show", "s1", day), item("pitchDate", "p1", day, { past: true })]), { label: "show + pitch date" });
  });
});

describe("itemsByDay", () => {
  test("groups by date and keeps input order", () => {
    const a = item("show", "a", "2026-12-12");
    const b = item("rehearsal", "b", "2026-12-13");
    const c = item("pitchDate", "c", "2026-12-12");
    const map = itemsByDay([a, b, c]);
    assert.deepEqual(map.get("2026-12-12"), [a, c]);
    assert.deepEqual(map.get("2026-12-13"), [b]);
    assert.equal(map.get("2026-12-14"), undefined);
  });
});

describe("monthGrid", () => {
  test("a month starting on Sunday has no leading days", () => {
    const grid = monthGrid("2026-11");
    assert.equal(grid[0], "2026-11-01");
    assert.equal(grid.length, 35);
    assert.equal(grid[34], "2026-12-05");
  });
  test("a six-week month", () => {
    const grid = monthGrid("2026-08");
    assert.equal(grid.length, 42);
    assert.equal(grid[0], "2026-07-26");
    assert.equal(grid[41], "2026-09-05");
  });
});

describe("daysUntil", () => {
  test("across the autumn DST change", () => {
    assert.equal(daysUntil("2026-11-02", "2026-11-01"), 1);
  });
  test("across the spring DST change", () => {
    assert.equal(daysUntil("2026-03-09", "2026-03-07"), 2);
  });
  test("same day is 0 and past is negative", () => {
    assert.equal(daysUntil("2026-05-05", "2026-05-05"), 0);
    assert.equal(daysUntil("2026-05-01", "2026-05-05"), -4);
  });
});

describe("layerFilter", () => {
  test("all shows everything", () => {
    assert.equal(layerFilter(item("rehearsal", "r"), "all"), true);
  });
  test("shows and rehearsals match only their kind", () => {
    assert.equal(layerFilter(item("show", "s"), "shows"), true);
    assert.equal(layerFilter(item("rehearsal", "r"), "shows"), false);
    assert.equal(layerFilter(item("rehearsal", "r"), "rehearsals"), true);
  });
  test("booking covers pitch dates, opens, deadlines, series and festival days", () => {
    for (const k of ["pitchDate", "opens", "deadline", "seriesStart", "festivalDay"] as const) {
      assert.equal(layerFilter(item(k, "x"), "booking"), true);
    }
    assert.equal(layerFilter(item("show", "s"), "booking"), false);
    assert.equal(layerFilter(item("rehearsal", "r"), "booking"), false);
  });
});

describe("upcoming", () => {
  test("only opens and deadlines on or after today, soonest first, limited to n", () => {
    const items = [
      item("deadline", "d3", "2026-12-03"),
      item("show", "s", "2026-11-01"),
      item("opens", "o1", "2026-11-01"),
      item("opens", "old", "2026-10-31"),
      item("deadline", "d2", "2026-11-20"),
    ];
    assert.deepEqual(upcoming(items, "2026-11-01", 2).map((i) => i.sourceId), ["o1", "d2"]);
    assert.deepEqual(upcoming(items, "2026-11-01", 10).map((i) => i.sourceId), ["o1", "d2", "d3"]);
  });
});
