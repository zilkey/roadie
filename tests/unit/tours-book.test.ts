/** tours.book (#45): the option becomes the show; per-pitch choices for the other options that day; the stay. */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
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


test("tours.book with per-pitch choices: one dropped, one kept, one told; the show is on the tour; the stay lands after it", async () => {
  const t = (await newTour()).id;
  const stage = (await cmd("venues.create", venue("Stage", "Ogden", { address: { city: "Ogden", state: "UT" }, region: "out" }))).id;
  const p = (await cmd("pitches.flag", { kind: "venue", id: velour, dates: ["2026-11-06", "2026-11-07"] })).id;
  const [a, b, c] = [kilby, muse, stage];
  const ids: string[] = [];
  for (const v of [a, b, c]) ids.push((await cmd("pitches.flag", { kind: "venue", id: v, dates: ["2026-11-06"] })).id);
  for (const id of [p, ...ids]) await cmd("tours.addPitch", { tourId: t, pitchId: id });
  const opt = (await entriesOf(t)).find((e) => e.pitchId === p && e.date === "2026-11-06")!;
  const r = await cmd("tours.book", { tourId: t, entryId: opt.id, date: "2026-11-06", addStay: true, others: { [ids[0]]: "drop", [ids[2]]: "tellBooked" } });
  assert.deepEqual([...r.dropped].sort(), [ids[0], ids[2]].sort());
  const show = (await db.get("shows", r.showId))!;
  assert.equal(show.tourId, t);
  assert.equal(show.projectId, band);
  const live = await entriesOf(t);
  const booked = live.find((e) => e.id === opt.id)!;
  assert.deepEqual([booked.kind, booked.showId], ["show", r.showId]);
  const options = live.filter((e) => e.kind === "option");
  assert.deepEqual(options.filter((e) => e.date).map((e) => e.pitchId), [ids[1]], "the kept one stays an option; the 7th went");
  assert.deepEqual(options.filter((e) => !e.date).map((e) => e.pitchId), [ids[0]], "the dropped one waits in No date yet");
  const dropped = (await db.get("pitches", ids[0]))!;
  assert.deepEqual(dropped.dates, []);
  assert.equal(dropped.tourId, t);
  assert.ok((await db.get("pitches", ids[2]))!.tourId == null, "told we're booked, with no dates left, it leaves the tour");
  assert.equal(dropped.nextStep, undefined);
  assert.match((await db.get("pitches", ids[2]))!.nextStep.text, /booked on Fri Nov 6/);
  assert.deepEqual((await db.get("pitches", ids[1]))!.dates, ["2026-11-06"]);
  const stay = live.find((e) => e.kind === "stay")!;
  assert.deepEqual([stay.date, stay.nights], ["2026-11-06", 1]);
  assert.ok(stay.position > booked.position);
});

test("tours.book: a plain choice still applies to every other option that day, and no addStay adds no stay", async () => {
  const t = (await newTour()).id;
  const p = (await cmd("pitches.flag", { kind: "venue", id: velour, dates: ["2026-11-06"] })).id;
  const q = (await cmd("pitches.flag", { kind: "venue", id: muse, dates: ["2026-11-06"] })).id;
  await cmd("tours.addPitch", { tourId: t, pitchId: p });
  await cmd("tours.addPitch", { tourId: t, pitchId: q });
  const opt = (await entriesOf(t)).find((e) => e.pitchId === p)!;
  const r = await cmd("tours.book", { tourId: t, entryId: opt.id, date: "2026-11-06", others: "drop" });
  assert.deepEqual(r.dropped, [q]);
  assert.ok(!(await entriesOf(t)).some((e) => e.kind === "stay"));
});
