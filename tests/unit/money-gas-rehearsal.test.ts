/**
 * Money on rehearsals and the gas category: gas is its own expense category (always paid back, estimate only on gas),
 * a rehearsal's money goes on its project (rehearsals.create defaults to the default project, rehearsals.update moves its
 * expenses and payouts, expenses.add takes the rehearsal's project when none is named), payouts.add takes a rehearsalId,
 * an admin who logs gas for a bandmate saves the bandmate's home (not their own), and projects.remove refuses a project
 * a rehearsal still points at.
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
import { getDriving } from "@/server/driving";
import { resetEmulators, makeUser, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx;
let memberUid: string;
let band: string, duo: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.GMAIL_BASE_URL = s.running["fake-gmail"].url;
  process.env.CALENDAR_BASE_URL = s.running["fake-calendar"].url;
  process.env.BANDSINTOWN_BASE_URL = s.running["fake-bandsintown"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};
const code = (p: Promise<unknown>, c: string) => assert.rejects(p, (e: any) => e.code === c);

beforeEach(async () => {
  await resetEmulators();
  const a = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  ctx = { uid: a.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
  const m = await makeUser("david@example.com", "member", { name: "David" });
  memberUid = m.uid;
  await db.create(ctx, "artists", { slug: "band", name: "Band", driveFolderId: "", links: {}, configurations: [] }, { id: TEST_ARTIST });
  band = (await cmd("projects.create", { kind: "band", name: "Band", isDefault: true })).id;
  duo = (await cmd("projects.create", { kind: "duo", name: "Duo" })).id;
});

const LOFT = { name: "The Loft", address: "2363 Champa St, Denver, CO, USA", lat: 39.7526, lng: -104.9868 };
const HOME = { address: "742 Evergreen Terrace, Denver, CO, USA", lat: 39.7005, lng: -104.9503 };
// A frozen gas estimate in the shape expenses.add stores (18.4 mi each way, round trip, 28 MPG, $3.790/gal): 498 cents.
const GAS = {
  fromKind: "home" as const, to: LOFT, oneWayMiles: 18.4, roundTrip: true, miles: 36.8, mpg: 28, grade: "regular" as const,
  priceMilli: 3790, priceArea: "Denver", priceWeek: "2026-10-19", seriesId: "EMM_EPM0R5_PTE_R20_DPG", estimateCents: 498,
};

test("gas is its own category: category gas always pays back, even when payBack is off", async () => {
  const g = await cmd("expenses.add", { amount: 498, what: "Gas", category: "gas", payBack: false, gas: GAS });
  const x = await db.get("expenses", g.id) as any;
  assert.deepEqual([x.category, x.payBack, x.gas.estimateCents], ["gas", true, 498]);
});

test("a gas estimate is refused on any category but gas (travel still takes one for older records)", async () => {
  await code(cmd("expenses.add", { amount: 498, what: "Gas", category: "gear", gas: GAS }), "invalid_input");
  const t = await cmd("expenses.add", { amount: 498, what: "Gas", category: "travel", gas: GAS });
  assert.ok((await db.get("expenses", t.id) as any).gas);
});

test("expenses.add with a rehearsalId and no projectId takes the rehearsal's project, and a named projectId still wins", async () => {
  const r = await cmd("rehearsals.create", { date: "2026-10-29", projectId: duo, location: { name: "Doghouse" }, personnel: [], songs: [] });
  const e = await cmd("expenses.add", { amount: 6000, what: "Room rental", category: "space", rehearsalId: r.id, payBack: false });
  assert.equal(((await db.get("expenses", e.id)) as any).projectId, duo);
  const named = await cmd("expenses.add", { amount: 300, what: "Strings", category: "gear", rehearsalId: r.id, projectId: band });
  assert.equal(((await db.get("expenses", named.id)) as any).projectId, band);
});

test("an admin logging gas for a bandmate with saveAsHome writes the bandmate's home, not the admin's", async () => {
  const r = await cmd("rehearsals.create", { date: "2026-10-29", location: LOFT, personnel: [], songs: [] });
  await cmd("expenses.add", { amount: 498, what: "Gas", category: "gas", userId: memberUid, rehearsalId: r.id, gas: GAS, saveAsHome: HOME });
  assert.equal((await getDriving(memberUid))?.home?.address, HOME.address);
  assert.equal((await getDriving(ctx.uid))?.home, undefined);
});

test("payouts.add accepts a rehearsalId: the rehearsal's project, stored on the payout", async () => {
  const r = await cmd("rehearsals.create", { date: "2026-10-29", projectId: duo, location: { name: "Doghouse" }, personnel: [], songs: [] });
  const p = await cmd("payouts.add", { to: { name: "Doghouse Studio" }, kind: "pay", amount: 6000, rehearsalId: r.id, what: "Room rental" });
  const doc = await db.get("payouts", p.id) as any;
  assert.deepEqual([doc.rehearsalId, doc.projectId], [r.id, duo]);
  await code(cmd("payouts.add", { to: { name: "x" }, kind: "pay", amount: 100, rehearsalId: "ghost" }), "not_found");
});

test("rehearsals.update projectId moves that rehearsal's expenses and payouts and leaves other rehearsals alone", async () => {
  const r = await cmd("rehearsals.create", { date: "2026-10-29", location: { name: "Doghouse" }, personnel: [], songs: [] });
  const other = await cmd("rehearsals.create", { date: "2026-10-30", location: { name: "Loft" }, personnel: [], songs: [] });
  assert.equal(((await db.get("rehearsals", r.id)) as any).projectId, band);
  const e = await cmd("expenses.add", { amount: 6000, what: "Room rental", category: "space", rehearsalId: r.id, payBack: false });
  const p = await cmd("payouts.add", { to: { name: "Doghouse Studio" }, kind: "pay", amount: 6000, rehearsalId: r.id });
  const kept = await cmd("expenses.add", { amount: 900, what: "Snacks", category: "food", rehearsalId: other.id, payBack: false });
  await cmd("rehearsals.update", { id: r.id, patch: { projectId: duo } });
  assert.equal(((await db.get("rehearsals", r.id)) as any).projectId, duo);
  assert.equal(((await db.get("expenses", e.id)) as any).projectId, duo);
  assert.equal(((await db.get("payouts", p.id)) as any).projectId, duo);
  assert.equal(((await db.get("expenses", kept.id)) as any).projectId, band);
});

test("rehearsals.create without a projectId gets the default project", async () => {
  const r = await cmd("rehearsals.create", { date: "2026-10-29", location: { name: "Doghouse" }, personnel: [], songs: [] });
  assert.equal(((await db.get("rehearsals", r.id)) as any).projectId, band);
});

test("projects.remove refuses a project a rehearsal points at", async () => {
  const scratch = (await cmd("projects.create", { kind: "other", name: "Scratch" })).id;
  await cmd("rehearsals.create", { date: "2026-10-29", projectId: scratch, location: { name: "Doghouse" }, personnel: [], songs: [] });
  await code(cmd("projects.remove", { id: scratch }), "invalid_state");
});
