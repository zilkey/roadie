import { test } from "node:test";
import assert from "node:assert/strict";
import { monthGrid } from "@/lib/calendar";
import { barSegments, buildTourLayer, listDays, shortDates, type LayerEntry } from "@/lib/calendarTours";

const e = (o: Partial<LayerEntry> & Pick<LayerEntry, "id" | "kind">): LayerEntry => ({ position: 1, ...o });
const tour = { id: "t1", name: "Fall run", startDate: "2027-03-09", endDate: "2027-03-14", leavingFrom: { name: "Boulder", address: "Boulder, CO" } };
const entries: LayerEntry[] = [
  e({ id: "s1", kind: "show", date: "2027-03-09", showId: "a" }),
  e({ id: "s2", kind: "show", date: "2027-03-11", showId: "b" }),
  e({ id: "d1", kind: "drive", date: "2027-03-09", from: { name: "Boulder", address: "x" }, to: { name: "Fort Collins", address: "y" } }),
  e({ id: "d2", kind: "drive", date: "2027-03-14", to: { name: "Boulder", address: "x" } }),
  e({ id: "st", kind: "stay", date: "2027-03-09", name: "Airbnb", address: { name: "Fort Collins", address: "y" }, nights: 2 }),
  e({ id: "n", kind: "note", date: "2027-03-10", text: "Off" }),
  e({ id: "o1", kind: "option", date: "2027-03-12" }), e({ id: "o2", kind: "option", date: "2027-03-12" }),
];

test("short dates and day lists", () => {
  assert.equal(shortDates("2027-03-09", "2027-03-14"), "Mar 9–14");
  assert.equal(shortDates("2027-03-30", "2027-04-02"), "Mar 30 – Apr 2");
  assert.equal(shortDates("2027-03-09", "2027-03-09"), "Mar 9");
  assert.equal(listDays(["2027-03-12", "2027-03-13"]), "Fri 12 and Sat 13");
});

test("layer: label, counts and chips; shows are not repeated", () => {
  const l = buildTourLayer(tour, entries, new Map(), true)!;
  assert.equal(l.booked, 2);
  assert.equal(l.openDates.length, 4);
  assert.match(l.label, /^Fall run · Mar 9–14 · 2 booked, 4 open$/);
  assert.deepEqual(l.chips.get("2027-03-09")!.map((c) => c.text), ["Drive Boulder → Fort Collins", "Airbnb · Fort Collins"]);
  assert.deepEqual(l.chips.get("2027-03-10")!.map((c) => c.text), ["Off", "Open"]);
  assert.ok(l.chips.get("2027-03-12")!.some((c) => c.text === "Open · 2 options"));
  assert.ok(l.chips.get("2027-03-14")!.some((c) => c.text === "Drive home"));
  assert.ok(!l.chips.get("2027-03-11")!.some((c) => c.kind === "open"));
  assert.ok(l.chips.get("2027-03-12")!.some((c) => c.text === "No stay"));
});

test("members: band entries only, no open chips or counts", () => {
  const l = buildTourLayer(tour, entries.filter((x) => x.kind !== "option"), new Map(), false)!;
  assert.match(l.label, /2 booked$/);
  assert.ok([...l.chips.values()].flat().every((c) => c.kind !== "open"));
  assert.equal(l.openDates.length, 0);
});

test("bars: one per week row, full label first, name after", () => {
  const grid = monthGrid("2027-03");
  const l = buildTourLayer({ ...tour, startDate: "2027-03-12", endDate: "2027-03-17" }, [], new Map(), true)!;
  const segs = barSegments(grid, l);
  assert.equal(segs.length, 2);
  assert.deepEqual([segs[0].row, segs[0].col, segs[0].end, segs[0].first, segs[0].contTo], [1, 6, 7, true, true]);
  assert.deepEqual([segs[1].row, segs[1].col, segs[1].end, segs[1].contFrom, segs[1].text], [2, 1, 4, true, "Fall run"]);
  assert.equal(segs[1].fix, 0);
  assert.equal(barSegments(grid, buildTourLayer({ ...tour, startDate: "2027-05-01", endDate: "2027-05-02" }, [], new Map(), true)!).length, 0);
});
