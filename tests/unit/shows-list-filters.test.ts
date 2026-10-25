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
let ctx: Ctx;
let hiDive: string;
let ogden: string;
let boulder: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.GMAIL_BASE_URL = s.running["fake-gmail"].url;
  process.env.CALENDAR_BASE_URL = s.running["fake-calendar"].url;
  process.env.BANDSINTOWN_BASE_URL = s.running["fake-bandsintown"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown) => {
  const x = registry[name];
  return (await x.run(ctx, x.input.parse(input))) as Record<string, any>;
};
const show = (venueId: string, date: string, extra: Record<string, unknown> = {}) =>
  cmd("shows.create", { date, venueId, addToCalendar: false, deal: { deal: "guarantee" }, ...extra });

beforeEach(async () => {
  await resetEmulators();
  const u = await makeUser("jeff@example.com", "admin", { name: "Jeff Smith" });
  ctx = { uid: u.uid, role: "admin", via: "app", runId: newRunId() };
  await db.create(ctx, "artists", { slug: "ingrid-avison-band", name: "Ingrid Avison Band", driveFolderId: "", links: {}, configurations: [] }, { id: TEST_ARTIST });
  hiDive = (await cmd("venues.create", venue("Hi-Dive", "Denver"))).id;
  ogden = (await cmd("venues.create", venue("Ogden", "Denver"))).id;
  boulder = (await cmd("venues.create", venue("Fox Theatre", "Boulder"))).id;
});

const ids = (r: Record<string, any>) => (r.shows as { id: string }[]).map((s) => s.id).sort();

test("shows.list narrows by venueId, from/to and city; counts follow the narrowing but not the status filter", async () => {
  const a = await show(hiDive, "2020-03-01");
  const b = await show(ogden, "2020-06-01");
  const c = await show(boulder, "2020-09-01");
  const d = await show(hiDive, "2099-01-01");

  assert.deepEqual(ids(await cmd("shows.list", {})), [a.id, b.id, c.id, d.id].sort());
  assert.deepEqual(ids(await cmd("shows.list", { venueId: hiDive })), [a.id, d.id].sort());
  assert.deepEqual(ids(await cmd("shows.list", { city: "denver" })), [a.id, b.id, d.id].sort());
  assert.deepEqual(ids(await cmd("shows.list", { city: "BOULDER" })), [c.id]);
  // from/to are inclusive
  assert.deepEqual(ids(await cmd("shows.list", { from: "2020-06-01", to: "2020-09-01" })), [b.id, c.id].sort());
  assert.deepEqual(ids(await cmd("shows.list", { from: "2020-06-02", to: "2020-08-31" })), []);

  const r = await cmd("shows.list", { city: "Denver", filter: "upcoming" });
  assert.deepEqual(ids(r), [d.id]);
  assert.equal(r.counts.played, 2);
  assert.equal(r.counts.upcoming, 1);
  const none = await cmd("shows.list", { venueId: boulder, filter: "upcoming" });
  assert.equal(none.count, 0);
  assert.equal(none.counts.played, 1);
});

test("shows.list rows carry totals from the show's deal", async () => {
  const a = await show(hiDive, "2020-03-01", { deal: { deal: "guarantee", guarantee: 50000 } });
  const b = await show(ogden, "2020-06-01");
  const r = await cmd("shows.list", { filter: "played" });
  const rowA = r.shows.find((s: any) => s.id === a.id);
  assert.equal(rowA.totals.income, 50000);
  assert.equal(rowA.totals.net, 50000 - rowA.totals.expenses);
  const rowB = r.shows.find((s: any) => s.id === b.id);
  assert.equal(rowB.totals, undefined);
});
