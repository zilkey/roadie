/** The member's day sheet (#46), pure: one day's entries, tomorrow, the town, the tour a person lands on, the Maps link. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { daySheet, dayTown, mapsUrl, tourToday, type EntryLike } from "@/lib/tours";

const e = (id: string, kind: EntryLike["kind"], date: string | undefined, position: number, more: Partial<EntryLike> = {}): EntryLike => ({ id, kind, date, position, ...more });
const tour = { startDate: "2027-03-09", endDate: "2027-03-11" };
const entries = [
  e("d2", "drive", "2027-03-09", 3, { leaveBy: "15:20", to: { name: "Fort Collins", address: "Fort Collins, CO" } }),
  e("d1", "drive", "2027-03-09", 1, { to: { address: "Boulder, CO" } }),
  e("sh", "show", "2027-03-09", 4, { showId: "s1" }),
  e("st", "stay", "2027-03-09", 5),
  e("n", "note", "2027-03-09", 6, { text: "Soundcheck at 5" }),
  e("o", "option", "2027-03-09", 7),
  e("t1", "drive", "2027-03-10", 1, { leaveBy: "10:00" }),
  e("t2", "show", "2027-03-10", 2, { showId: "s2" }),
  e("gone", "drive", "2027-03-09", 0, { deletedAt: new Date() }),
];

test("a day lists its drives, shows, stays and notes in position order, and not options or deleted entries", () => {
  const s = daySheet(tour, entries, "2027-03-09");
  assert.deepEqual(s.day, { n: 1, of: 3 });
  assert.deepEqual(s.drives.map((x) => x.id), ["d1", "d2"]);
  assert.deepEqual(s.shows.map((x) => x.id), ["sh"]);
  assert.deepEqual(s.stays.map((x) => x.id), ["st"]);
  assert.deepEqual(s.notes.map((x) => x.id), ["n"]);
});

test("tomorrow is the next day's first drive and show; none on the last day or when it has neither", () => {
  const s = daySheet(tour, entries, "2027-03-09");
  assert.equal(s.tomorrow?.drive?.id, "t1");
  assert.equal(s.tomorrow?.show?.id, "t2");
  assert.equal(daySheet(tour, entries, "2027-03-10").tomorrow, null);
  assert.equal(daySheet(tour, entries, "2027-03-11").tomorrow, null);
});

test("a day outside the tour has no day number and nothing in it", () => {
  const s = daySheet(tour, entries, "2027-04-01");
  assert.equal(s.day, null);
  assert.equal(s.drives.length + s.shows.length + s.stays.length + s.notes.length, 0);
  assert.equal(s.tomorrow, null);
});

test("the day's town: the last drive's destination, else the show's city, else nothing", () => {
  const s = daySheet(tour, entries, "2027-03-09");
  assert.equal(dayTown(s, () => "Denver"), "Fort Collins");
  assert.equal(dayTown({ drives: [s.drives[0]], shows: [] }, () => undefined), "Boulder");
  assert.equal(dayTown({ drives: [], shows: s.shows }, () => "Denver"), "Denver");
  assert.equal(dayTown({ drives: [], shows: [] }, () => "Denver"), "");
});

test("tourToday picks the tour under way that has the musician in it", () => {
  const t = (id: string, status: string, startDate: string, endDate: string, personnel: string[]) => ({ id, status, startDate, endDate, personnel });
  const tours = [t("idea", "idea", "2027-03-01", "2027-03-30", ["m1"]), t("other", "booked", "2027-03-01", "2027-03-30", ["m2"]), t("late", "planning", "2027-03-05", "2027-03-30", ["m1"]), t("early", "booked", "2027-03-02", "2027-03-30", ["m1"]), t("over", "booked", "2027-03-01", "2027-03-08", ["m1"])];
  assert.equal(tourToday(tours, "2027-03-09", "m1")?.id, "early");
  assert.equal(tourToday(tours, "2027-03-09", "m3"), null);
  assert.equal(tourToday(tours, "2027-03-09", undefined), null);
  assert.equal(tourToday(tours, "2027-04-09", "m1"), null);
});

test("the Maps link", () => {
  assert.equal(mapsUrl({ lat: 40.01, lng: -105.27 }, { lat: 40.58, lng: -105.08 }), "https://www.google.com/maps/dir/?api=1&origin=40.01,-105.27&destination=40.58,-105.08");
});
