/**
 * Tours (#41): a tour is a tag, not a project. Create (Money goes to must be an open project), positions, options from a
 * pitch's dates and the bucket, tagging a show's money without touching its project, booking an option, the summary's
 * totals and warnings, what members see, and Undo of a whole batch.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { undoRun } from "@/server/undo";
import { positionBetween, slotIn, tourDays, tourWarnings, type EntryLike } from "@/lib/tours";
import { isEligible, needsConfirm } from "@/server/assistant/policy";
import { groupOf, groupsFor } from "@/server/assistant/toolset";
import { topicInWords } from "@/lib/help";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx, mctx: Ctx;
let band: string, duo: string, velour: string, kilby: string, muse: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  for (const [name, env] of [["fake-ors", "ORS_BASE_URL"], ["fake-drive", "DRIVE_BASE_URL"], ["fake-bandsintown", "BANDSINTOWN_BASE_URL"], ["fake-calendar", "CALENDAR_BASE_URL"]] as const) {
    if (s.running[name]) process.env[env] = s.running[name].url;
  }
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const code = (p: Promise<unknown>, c: string) => assert.rejects(p, (e: any) => e.code === c); // eslint-disable-line @typescript-eslint/no-explicit-any
const entriesOf = async (tourId: string) => (await db.list(`tours/${tourId}/entries`)).sort((a, b) => (a.date ?? "") < (b.date ?? "") ? -1 : (a.date ?? "") > (b.date ?? "") ? 1 : a.position - b.position);
const DENVER = { name: "Denver", address: "Denver, CO, USA", lat: 39.7392, lng: -104.9903 };
const SLC = { name: "Salt Lake City", address: "Salt Lake City, UT, USA", lat: 40.7608, lng: -111.891 };

beforeEach(async () => {
  await resetEmulators();
  const a = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  ctx = { uid: a.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST, now: new Date("2026-11-06T18:00:00Z") };
  const m = await makeUser("david@example.com", "member", { name: "David" });
  mctx = { uid: m.uid, role: "member", via: "app", runId: newRunId(), artistId: TEST_ARTIST, now: ctx.now };
  await db.create(ctx, "artists", { slug: "band", name: "Band", driveFolderId: "", links: {}, configurations: [] }, { id: TEST_ARTIST });
  band = (await cmd("projects.create", { kind: "band", name: "Band", isDefault: true })).id;
  duo = (await cmd("projects.create", { kind: "duo", name: "Duo" })).id;
  velour = (await cmd("venues.create", venue("Velour", "Provo", { address: { city: "Provo", state: "UT" }, region: "out", type: "listening" }))).id;
  kilby = (await cmd("venues.create", venue("Kilby Court", "Salt Lake City", { address: { city: "Salt Lake City", state: "UT" }, region: "out" }))).id;
  muse = (await cmd("venues.create", venue("Muse Music", "Provo", { address: { city: "Provo", state: "UT" }, region: "out" }))).id;
});

const newTour = (extra: Record<string, unknown> = {}) => cmd("tours.create", { name: "Mountain West", projectId: duo, startDate: "2026-11-05", endDate: "2026-11-08", ...extra });

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

test("tours.create: Money goes to must be an open project, and a tour never makes or moves a project", async () => {
  await code(cmd("tours.create", { name: "X", projectId: "nope" }), "not_found");
  await cmd("projects.close", { id: duo });
  await code(newTour(), "invalid_state");
  await cmd("projects.reopen", { id: duo });
  const before = (await db.list("projects")).length;
  const r = await newTour({ personnel: ["m1"] });
  const t = (await db.get("tours", r.id))!;
  assert.equal(t.projectId, duo);
  assert.equal(t.status, "planning");
  assert.equal(t.artistId, TEST_ARTIST);
  assert.deepEqual(t.personnel, ["m1"]);
  assert.equal((await db.list("projects")).length, before);
  await code(cmd("tours.update", { id: r.id, patch: { projectId: "nope" } }), "not_found");
  await cmd("tours.update", { id: r.id, patch: { status: "booked", notes: "Van rental", startDate: null } });
  const u = (await db.get("tours", r.id))!;
  assert.equal(u.status, "booked");
  assert.equal(u.startDate, undefined);
});

test("entries: + between two entries writes the midpoint; a drive gets its miles and minutes; moving keeps the order", async () => {
  const t = (await newTour()).id;
  const a = (await cmd("tours.entries.add", { tourId: t, kind: "note", date: "2026-11-05", text: "Load the van" })).id;
  const b = (await cmd("tours.entries.add", { tourId: t, kind: "stay", date: "2026-11-05", name: "Airbnb" })).id;
  const d = await cmd("tours.entries.add", { tourId: t, kind: "drive", date: "2026-11-05", after: a, from: DENVER, to: SLC, leaveBy: "11:00" });
  assert.equal(d.miles, 18.4);
  assert.equal(d.minutes, 26);
  const pos = Object.fromEntries((await entriesOf(t)).map((e) => [e.id, e.position]));
  assert.deepEqual([pos[a], pos[d.id], pos[b]], [1, 1.5, 2]);
  await code(cmd("tours.entries.add", { tourId: t, kind: "note", date: "2026-11-05", text: "x", after: "nope" }), "invalid_input");
  await code(cmd("tours.entries.add", { tourId: t, kind: "note", date: "2026-11-05", name: "Not a note field", text: "x" }), "invalid_input");
  // Drag the stay before the note, then the drive to another day.
  await cmd("tours.entries.move", { tourId: t, id: b, before: a });
  assert.deepEqual((await entriesOf(t)).map((e) => e.id), [b, a, d.id]);
  await cmd("tours.entries.update", { tourId: t, id: d.id, patch: { date: "2026-11-06", to: null } });
  const moved = (await db.get(`tours/${t}/entries`, d.id))!;
  assert.equal(moved.date, "2026-11-06");
  assert.equal(moved.miles, undefined, "no To, no miles");
  await code(cmd("tours.entries.move", { tourId: t, id: a, date: null }), "invalid_input");
});

test("tours.addPitch: one option per date; no dates is the bucket; a date added later takes the bucket entry", async () => {
  const t = (await newTour()).id;
  const p = (await cmd("pitches.flag", { kind: "venue", id: velour, dates: ["2026-11-06", "2026-11-07"] })).id;
  const r = await cmd("tours.addPitch", { tourId: t, pitchId: p });
  assert.equal(r.entryIds.length, 2);
  const opts = (await entriesOf(t)).filter((e) => e.pitchId === p);
  assert.deepEqual(opts.map((e) => [e.kind, e.date, e.visibility]), [["option", "2026-11-06", "admins"], ["option", "2026-11-07", "admins"]]);
  assert.equal((await db.get("pitches", p))!.tourId, t);
  // Again: nothing doubles.
  assert.deepEqual((await cmd("tours.addPitch", { tourId: t, pitchId: p })).entryIds.sort(), r.entryIds.sort());

  // By venue, with no pitch yet and no dates: flagged onto the Pitch List and into the bucket.
  const byVenue = await cmd("tours.addPitch", { tourId: t, venueId: muse });
  const bucketId = byVenue.entryIds[0];
  const bucket = (await db.get(`tours/${t}/entries`, bucketId))!;
  assert.equal(bucket.date, undefined);
  assert.equal((await db.get("pitches", byVenue.pitchId))!.status, "toPitch");
  // "Add Muse for the 8th": the same entry gets the date.
  const later = await cmd("tours.addPitch", { tourId: t, venueId: muse, dates: ["2026-11-08"] });
  assert.equal(later.pitchId, byVenue.pitchId);
  assert.deepEqual(later.entryIds, [bucketId]);
  assert.equal((await db.get(`tours/${t}/entries`, bucketId))!.date, "2026-11-08");
  assert.deepEqual((await db.get("pitches", byVenue.pitchId))!.dates, ["2026-11-08"]);

  // Moving an option moves the pitch's date; removing one drops it; the last one gone takes the pitch off the tour.
  const six = opts[0].id, seven = opts[1].id;
  await cmd("tours.entries.move", { tourId: t, id: six, date: "2026-11-05" });
  assert.deepEqual((await db.get("pitches", p))!.dates, ["2026-11-05", "2026-11-07"]);
  await code(cmd("tours.entries.move", { tourId: t, id: six, date: "2026-11-07" }), "invalid_input");
  await cmd("tours.entries.remove", { tourId: t, id: six });
  assert.deepEqual((await db.get("pitches", p))!.dates, ["2026-11-07"]);
  await cmd("tours.entries.remove", { tourId: t, id: seven });
  assert.equal((await db.get("pitches", p))!.tourId, undefined);
});

async function showWithMoney(date = "2026-11-05") {
  const s = (await cmd("shows.create", { date, venueId: kilby, deal: { deal: "guarantee", guarantee: 50000 } })).id;
  await cmd("expenses.add", { amount: 2000, what: "Strings", category: "gear", showId: s });
  await cmd("payouts.add", { to: { name: "Sub" }, kind: "pay", amount: 10000, showId: s });
  return s;
}
const moneyOf = async (showId: string) => (await Promise.all(["income", "expenses", "payouts"].map((c) => db.list(c, (q) => q.where("showId", "==", showId))))).flat();

test("addShow and removeItem tag and untag the show and its money, and never touch a projectId", async () => {
  const t = (await newTour()).id;
  const s = await showWithMoney();
  assert.ok((await moneyOf(s)).every((x) => x.projectId === band));
  const r = await cmd("tours.addShow", { tourId: t, showId: s });
  assert.equal((await db.get("shows", s))!.tourId, t);
  assert.equal((await db.get("shows", s))!.projectId, band, "the show keeps its project, not the tour's Duo");
  const money = await moneyOf(s);
  assert.equal(money.length, 3);
  assert.ok(money.every((x) => x.tourId === t && x.projectId === band));
  const e = (await db.get(`tours/${t}/entries`, r.entryId))!;
  assert.deepEqual([e.kind, e.showId, e.date, e.visibility], ["show", s, "2026-11-05", "band"]);
  assert.equal((await cmd("tours.addShow", { tourId: t, showId: s })).existing, true);
  // Money added later on the show copies its tour; a tourEntryId has to be one of the tour's.
  const inc = (await cmd("income.add", { amount: 3000, category: "merch", from: "Merch table", showId: s })).id;
  assert.equal((await db.get("income", inc))!.tourId, t);
  const other = (await cmd("tours.create", { name: "Other", projectId: band })).id;
  const otherEntry = (await cmd("tours.entries.add", { tourId: other, kind: "note", date: "2026-12-01", text: "x" })).id;
  await code(cmd("expenses.add", { amount: 100, what: "x", category: "food", tourId: t, tourEntryId: otherEntry }), "not_found");
  const pinned = (await cmd("expenses.add", { amount: 4500, what: "Gas", category: "gas", tourId: t, tourEntryId: r.entryId })).id;
  assert.equal((await db.get("expenses", pinned))!.projectId, duo, "money added from the tour starts on its Money goes to");
  // A show's date change carries its entry along.
  await cmd("shows.update", { id: s, patch: { date: "2026-11-06" } });
  assert.equal((await db.get(`tours/${t}/entries`, r.entryId))!.date, "2026-11-06");

  await cmd("tours.removeItem", { tourId: t, showId: s });
  assert.equal((await db.get("shows", s))!.tourId, undefined);
  assert.ok((await moneyOf(s)).every((x) => x.tourId === undefined && x.projectId === band));
  assert.equal((await db.get(`tours/${t}/entries`, r.entryId))!.deletedAt !== null, true);
  const p = (await db.get("expenses", pinned))!;
  assert.equal(p.tourId, t, "money on the tour but not the show keeps its tag");
  assert.equal(p.tourEntryId, undefined, "pinned to the show's entry: back to the whole tour");
});

test("tours.book: the option becomes the show (same id), its other dates go, and the others that day are handled", async () => {
  const t = (await newTour()).id;
  const p = (await cmd("pitches.flag", { kind: "venue", id: velour, dates: ["2026-11-06", "2026-11-07"] })).id;
  const q = (await cmd("pitches.flag", { kind: "venue", id: muse, dates: ["2026-11-06"] })).id;
  await cmd("tours.addPitch", { tourId: t, pitchId: p });
  await cmd("tours.addPitch", { tourId: t, pitchId: q });
  const opt = (await entriesOf(t)).find((e) => e.pitchId === p && e.date === "2026-11-06")!;
  const r = await cmd("tours.book", { tourId: t, entryId: opt.id, date: "2026-11-06", others: "tellBooked", addStay: true });
  assert.equal(r.entryId, opt.id);
  const show = (await db.get("shows", r.showId))!;
  assert.deepEqual([show.date, show.tourId, show.venue.id, show.projectId], ["2026-11-06", t, velour, band]);
  const pitch = (await db.get("pitches", p))!;
  assert.equal(pitch.status, "booked");
  assert.deepEqual(pitch.showIds, [r.showId]);
  assert.deepEqual(pitch.dates, ["2026-11-06"]);
  const live = await entriesOf(t);
  const booked = live.find((e) => e.id === opt.id)!;
  assert.deepEqual([booked.kind, booked.showId, booked.pitchId, booked.visibility], ["show", r.showId, undefined, "band"]);
  assert.ok(!live.some((e) => e.kind === "option"), "the 7th went, and Muse's option that day too");
  assert.deepEqual(r.dropped, [q]);
  const other = (await db.get("pitches", q))!;
  assert.deepEqual(other.dates, []);
  assert.equal(other.tourId, undefined);
  assert.match(other.nextStep.text, /booked on Fri Nov 6/);
  const stay = live.find((e) => e.kind === "stay")!;
  assert.equal(stay.date, "2026-11-06");
  assert.ok(stay.position > booked.position);
  await code(cmd("tours.book", { tourId: t, entryId: stay.id, date: "2026-11-06" }), "invalid_input");
});

test("tours.summary: totals are this tour's records the incomeSoFar way, by day, and the warnings", async () => {
  const t = (await newTour()).id;
  const played = await showWithMoney("2026-11-05");
  const next = (await cmd("shows.create", { date: "2026-11-08", venueId: velour, deal: { deal: "guarantee", guarantee: 30000 } })).id;
  await cmd("tours.addShow", { tourId: t, showId: played });
  await cmd("tours.addShow", { tourId: t, showId: next });
  const inc = (await db.list("income", (q) => q.where("showId", "==", played)))[0];
  await cmd("income.setReceived", { id: inc.id, receivedAt: "2026-11-05" });
  await cmd("expenses.add", { amount: 6000, what: "Motel", category: "lodging", tourId: t, date: "2026-11-06" });
  await cmd("expenses.add", { amount: 99900, what: "Not the tour's", category: "gear" });
  const s = await cmd("tours.summary", { id: t });
  assert.deepEqual(s.days.map((d: { date: string }) => d.date), ["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  assert.equal(s.totals.inReceived, 50000);
  assert.equal(s.totals.inOwed, 0, "the 8th hasn't happened yet");
  assert.equal(s.totals.expected, 30000);
  assert.equal(s.totals.outPaid, 2000 + 6000);
  assert.equal(s.totals.outOwed, 10000, "the sub's pay isn't paid yet");
  const day = (d: string) => s.byDay.find((x: { date: string }) => x.date === d)?.totals;
  assert.equal(day("2026-11-05").inReceived, 50000);
  assert.equal(day("2026-11-06").outPaid, 6000);
  const kinds = s.warnings.map((w: { kind: string; date: string }) => `${w.kind} ${w.date}`);
  for (const k of ["noStay 2026-11-05", "openDate 2026-11-06", "openDate 2026-11-07"]) assert.ok(kinds.includes(k), k);
  assert.ok(!kinds.includes("openDate 2026-11-05"));

  const list = (await cmd("tours.list", {})).tours;
  assert.equal(list.length, 1);
  assert.equal(list[0].counts.shows, 2);
  assert.equal(list[0].totals.inReceived, 50000);
});

test("members see the tour and its band entries: no options, no money, no bucket", async () => {
  const t = (await newTour()).id;
  await cmd("tours.entries.add", { tourId: t, kind: "drive", date: "2026-11-05", leaveBy: "11:00" });
  await cmd("tours.entries.add", { tourId: t, kind: "note", date: "2026-11-05", text: "Settle with the promoter", visibility: "admins" });
  const p = (await cmd("pitches.flag", { kind: "venue", id: velour, dates: ["2026-11-06"] })).id;
  await cmd("tours.addPitch", { tourId: t, pitchId: p });
  await cmd("tours.addPitch", { tourId: t, venueId: muse });
  const mine = await cmd("tours.get", { id: t }, mctx);
  assert.deepEqual(mine.entries.map((e: { kind: string }) => e.kind), ["drive"]);
  assert.equal((await cmd("tours.get", { id: t })).entries.length, 4);
  const sum = await cmd("tours.summary", { id: t }, mctx);
  assert.equal(sum.totals, undefined);
  assert.equal(sum.bucket, undefined);
  assert.ok(!sum.warnings.some((w: { kind: string }) => w.kind === "openDate"));
  const row = (await cmd("tours.list", {}, mctx)).tours[0];
  assert.equal(row.totals, undefined);
  assert.equal(row.counts.options, undefined);
  for (const n of ["tours.create", "tours.update", "tours.addPitch", "tours.book", "tours.entries.add"]) {
    assert.ok(!registry[n].roles.includes("member"), n);
    assert.ok(registry[n].roles.includes("mcp"), n);
  }
  for (const n of ["tours.list", "tours.get", "tours.summary"]) assert.ok(registry[n].roles.includes("member"), n);
});

test("Undo of tours.addShow puts the show, its money and the plan back in one go", async () => {
  const t = (await newTour()).id;
  const s = await showWithMoney();
  const c = { ...ctx, runId: newRunId() };
  await cmd("tours.addShow", { tourId: t, showId: s }, c);
  assert.ok((await moneyOf(s)).every((x) => x.tourId === t));
  const rep = await undoRun(ctx, c.runId);
  assert.equal(rep.failed.length, 0);
  assert.equal((await db.get("shows", s))!.tourId, undefined);
  assert.ok((await moneyOf(s)).every((x) => x.tourId === undefined && x.projectId === band));
  assert.equal((await entriesOf(t)).length, 0);
});

test("tours.remove: the tags come off shows, pitches and money, the plan goes, the projects stay", async () => {
  const t = (await newTour()).id;
  const s = await showWithMoney();
  await cmd("tours.addShow", { tourId: t, showId: s });
  const p = (await cmd("tours.addPitch", { tourId: t, venueId: velour, dates: ["2026-11-07"] })).pitchId;
  await cmd("tours.remove", { id: t });
  assert.ok((await db.get("tours", t))!.deletedAt);
  assert.equal((await db.get("shows", s))!.tourId, undefined);
  assert.equal((await db.get("pitches", p))!.tourId, undefined);
  assert.deepEqual((await db.get("pitches", p))!.dates, ["2026-11-07"]);
  assert.ok((await moneyOf(s)).every((x) => x.tourId === undefined && x.projectId === band));
  assert.equal((await entriesOf(t)).length, 0);
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
