// Covers the pure tour helpers: positions, days, warnings, dates, stats, per-day money and the Roadie tool group policy.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tourByDay, tourDayOf, attentionText, driveText, fmtTourDates, planStats, routeTowns, positionBetween, slotIn, tourDays, tourFilterOf, tourWarnings, type EntryLike } from "@/lib/tours";
import { isEligible, needsConfirm } from "@/server/assistant/policy";
import { groupOf, groupsFor } from "@/server/assistant/toolset";
import { topicInWords } from "@/lib/help";

test("pure: positions are midpoints, the days run from start to end, and the warnings", () => {
  assert.equal(positionBetween(1, 2), 1.5);
  assert.equal(positionBetween(3), 4);
  assert.equal(positionBetween(undefined, 1), 0);
  assert.equal(positionBetween(), 1);
  const day = [{ id: "a", position: 1 }, { id: "b", position: 2 }, { id: "c", position: 4 }];
  assert.equal(slotIn(day, { after: "a" }), 1.5);
  assert.equal(slotIn(day, { before: "c" }), 3);
  assert.equal(slotIn(day, { after: "a", before: "c" }), 2.5);
  assert.equal(slotIn(day, {}), 5);
  assert.equal(slotIn(day, { after: "nope" }), null);

  const tour = { startDate: "2026-11-05", endDate: "2026-11-07" };
  const entries: EntryLike[] = [
    { id: "d", kind: "drive", date: "2026-11-05", position: 1, leaveBy: "13:00", minutes: 330 },
    { id: "s", kind: "show", date: "2026-11-05", position: 2, showId: "show1" },
    { id: "st", kind: "stay", date: "2026-11-05", position: 3, name: "Airbnb" },
    { id: "o", kind: "option", date: "2026-11-07", position: 1, pitchId: "p" },
    { id: "late", kind: "note", date: "2026-11-09", position: 1, text: "Home" },
    { id: "b", kind: "option", position: 1, pitchId: "q" },
  ];
  const { days, bucket } = tourDays(tour, entries);
  assert.deepEqual(days.map((d) => d.date), ["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-09"]);
  assert.deepEqual(days[0].entries.map((e) => e.id), ["d", "s", "st"]);
  assert.deepEqual(bucket.map((e) => e.id), ["b"]);
  const w = tourWarnings(tour, entries, new Map([["show1", { date: "2026-11-05", name: "Kilby Court", loadIn: "18:00" }]]));
  const has = (kind: string, date?: string) => w.some((x) => x.kind === kind && (!date || x.date === date));
  assert.ok(has("longDrive", "2026-11-05"), "5.5 h is over five hours");
  assert.ok(has("lateArrival", "2026-11-05"), "13:00 + 5.5 h is after an 18:00 load in");
  assert.ok(!has("noStay", "2026-11-05"), "the Airbnb covers the 5th");
  assert.ok(has("noStay", "2026-11-06"));
  assert.ok(!has("noStay", "2026-11-07"), "the last day is the drive home");
  assert.ok(has("openDate", "2026-11-06"));
  assert.ok(!has("openDate", "2026-11-07"), "an option counts as pitched");
  assert.ok(has("outsideDates", "2026-11-09"));
  // Two nights cover the next day; a round-trip drive means home for the night.
  const w2 = tourWarnings(tour, [{ id: "st", kind: "stay", date: "2026-11-05", position: 1, nights: 2 }], new Map());
  assert.ok(!w2.some((x) => x.kind === "noStay"));
  const w3 = tourWarnings(tour, [{ id: "d", kind: "drive", date: "2026-11-05", position: 1, roundTrip: true }, { id: "s", kind: "stay", date: "2026-11-06", position: 1 }], new Map());
  assert.ok(!w3.some((x) => x.kind === "noStay"));
});

test("Roadie: tours is a tool group the tour phrases load, reads never ask, booking asks", () => {
  for (const say of ["add Velour for the 9th or 10th", "add a drive Saturday at 11", "we're camping Sunday", "how's the tour doing?"]) {
    assert.ok(groupsFor(say, [], undefined).includes("tours"), say);
  }
  // "Put the Kilby show on Mountain West" names no tour word: adding a show, the list and the summary are core.
  for (const n of ["tours.addShow", "tours.list", "tours.summary"]) assert.equal(groupOf(n), undefined, n);
  assert.equal(groupOf("tours.book"), "tours");
  assert.ok(!groupsFor("connect the Drive folder", [], undefined).includes("tours"));
  for (const n of ["tours.list", "tours.get", "tours.summary"]) assert.equal(needsConfirm(n, { id: "x" }), false, n);
  assert.equal(needsConfirm("tours.book", { tourId: "t", entryId: "e", date: "2026-11-06" }), true);
  assert.equal(needsConfirm("tours.remove", { id: "t" }), true);
  assert.equal(needsConfirm("tours.entries.add", { tourId: "t", kind: "stay", date: "2026-11-08", name: "Camping" }), false);
  assert.ok(isEligible("tours.addPitch", "admin"));
  assert.ok(!isEligible("tours.addPitch", "member"));
  assert.equal(topicInWords("what's a tour?")?.id, "tours");
});

test("the pages' tour dates, filter and needs-attention line", () => {
  assert.equal(fmtTourDates("2027-03-09", "2027-03-14"), "Mar 9–14, 2027");
  assert.equal(fmtTourDates("2027-03-30", "2027-04-02"), "Mar 30 – Apr 2, 2027");
  assert.equal(fmtTourDates("2026-12-30", "2027-01-02"), "Dec 30, 2026 – Jan 2, 2027");
  assert.equal(fmtTourDates("2027-03-09"), "From Mar 9, 2027");
  assert.equal(fmtTourDates(undefined, "2027-03-14"), "Until Mar 14, 2027");
  assert.equal(fmtTourDates(), "No dates yet");
  const today = "2026-10-29";
  assert.equal(tourFilterOf({ status: "planning", endDate: "2027-03-14" }, today), "upcoming");
  assert.equal(tourFilterOf({ status: "planning" }, today), "upcoming");
  assert.equal(tourFilterOf({ status: "idea" }, today), "ideas");
  assert.equal(tourFilterOf({ status: "booked", endDate: "2025-10-12" }, today), "past");
  assert.equal(tourFilterOf({ status: "done" }, today), "past");
  assert.equal(attentionText([{ kind: "noStay" }, { kind: "openDate" }, { kind: "longDrive" }, { kind: "noStay" }]), "2 nights no stay · 1 long drive");
  assert.equal(attentionText([{ kind: "openDate" }]), "");
});

test("the Plan tab's stat pills, drive line and route towns", () => {
  assert.equal(driveText(430, 463.2), "7 h 10 min · 463 mi");
  assert.equal(driveText(undefined, 64), "64 mi");
  assert.equal(driveText(), "");
  const entries = [
    { id: "s", kind: "show" as const, date: "2027-03-09", position: 1 },
    { id: "o1", kind: "option" as const, date: "2027-03-12", position: 1 },
    { id: "o2", kind: "option" as const, position: 1 },
    { id: "d1", kind: "drive" as const, date: "2027-03-09", position: 0, miles: 64, minutes: 65 },
    { id: "d2", kind: "drive" as const, date: "2027-03-10", position: 0, miles: 996, minutes: 955 },
    { id: "gone", kind: "show" as const, date: "2027-03-10", position: 2, deletedAt: {} },
  ];
  const st = planStats(entries, [
    { kind: "noStay", date: "2027-03-11", message: "" }, { kind: "noStay", date: "2027-03-10", message: "" },
    { kind: "openDate", date: "2027-03-11", message: "" }, { kind: "longDrive", date: "2027-03-10", entryId: "d2", message: "" },
  ]);
  assert.deepEqual({ shows: st.shows, options: st.options, openDates: st.openDates, driving: st.driving }, { shows: 1, options: 1, openDates: 1, driving: "1,060 mi · 17 h driving" });
  assert.deepEqual(st.attention, [
    { kind: "noStay", text: "2 nights with no stay", date: "2027-03-10" },
    { kind: "longDrive", text: "1 long drive", date: "2027-03-10" },
  ]);
  assert.equal(planStats([], []).driving, "");
  assert.deepEqual([...routeTowns([{ address: "Boulder, CO, USA" }, { name: "Salt Lake City", address: "Salt Lake City, UT, USA" }, undefined], ["Provo", undefined])].sort(),
    ["boulder", "provo", "salt lake city"]);
});

test("tourByDay: pinned money lands on the entry's date, unpinned is the null row, a future show's income is only expected", () => {
  const dates = new Map([["d1", "2026-11-05"], ["s2", "2026-11-08"]]);
  const rec = (amount: number, extra: Record<string, unknown> = {}) => ({ amount, ...extra }) as never;
  const rows = tourByDay({
    income: [rec(10000, { tourEntryId: "s2", receivedAt: undefined }), rec(5000, { tourEntryId: "d1", receivedAt: "2026-11-05" })],
    expenses: [rec(2000, { tourEntryId: "d1" }), rec(700)],
    payouts: [],
  }, dates, "2026-11-06");
  assert.deepEqual(rows.map((r) => r.date), ["2026-11-05", "2026-11-08", null]);
  assert.equal(rows[0].totals.inReceived, 5000);
  assert.equal(rows[0].totals.outPaid, 2000);
  assert.equal(rows[2].totals.outPaid, 700);
  assert.equal(tourDayOf({ tourEntryId: "gone" }, dates), null);
});
