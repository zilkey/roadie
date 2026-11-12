/**
 * Booking campaigns (#82): create, rename, close (status only; pitches keep campaignId), reopen, pitches.setCampaign (to a
 * campaign, back to Ongoing with null, never into a closed or another band's campaign), the one-active-pitch guard on
 * pitches.move, and Undo of a run.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { isExcluded, needsConfirm } from "@/server/assistant/policy";
import { groupOf } from "@/server/assistant/toolset";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

const OTHER = "other-band";
let ctx: Ctx, octx: Ctx;
let v1: string, v2: string;

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const fails = (p: Promise<unknown>, status: number) => assert.rejects(p, (e: { status?: number }) => e.status === status);
const fresh = (c: Ctx = ctx): Ctx => ({ ...c, runId: newRunId() });

beforeEach(async () => {
  await resetEmulators();
  const a = await makeUser("rudy@example.com", "admin", { name: "Rudy" });
  ctx = { uid: a.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
  const o = await makeUser("olga@example.com", "admin", { name: "Olga", artistId: OTHER });
  octx = { uid: o.uid, role: "admin", via: "app", runId: newRunId(), artistId: OTHER };
  await db.create(ctx, "artists", { slug: "band", name: "Band", driveFolderId: "", links: {}, configurations: [] }, { id: TEST_ARTIST });
  await db.create(octx, "artists", { slug: "other", name: "Other", driveFolderId: "", links: {}, configurations: [] }, { id: OTHER });
  v1 = (await cmd("venues.create", venue("Velour", "Provo"))).id;
  v2 = (await cmd("venues.create", venue("Kilby Court", "Salt Lake City"))).id;
});

test("roles and Roadie: admin only, not MCP; Roadie has them, and closing asks first", () => {
  for (const n of ["campaigns.create", "campaigns.rename", "campaigns.close", "campaigns.reopen", "pitches.setCampaign"]) {
    assert.deepEqual(registry[n].roles, ["admin"], n);
    assert.ok(!isExcluded(n), n);
    assert.equal(groupOf(n), "campaigns", n);
  }
  assert.ok(needsConfirm("campaigns.close", { id: "c1" }));
  assert.ok(!needsConfirm("campaigns.create", { name: "Spring" }));
  assert.ok(!needsConfirm("pitches.setCampaign", { ids: ["a", "b"], campaignId: "c1" }));
});

test("create, rename, close, reopen: names unique per band; close only sets status", async () => {
  const c = await cmd("campaigns.create", { name: " Spring 2027 " });
  let doc = (await db.get("campaigns", c.id))!;
  assert.deepEqual([doc.name, doc.status, doc.artistId], ["Spring 2027", "active", TEST_ARTIST]);
  await fails(cmd("campaigns.create", { name: "spring 2027" }), 409);
  await cmd("campaigns.create", { name: "Spring 2027" }, octx); // another band may use the same name

  assert.equal((await cmd("campaigns.rename", { id: c.id, name: "Spring Run" })).changed, true);
  assert.equal((await db.get("campaigns", c.id))!.name, "Spring Run");
  const other = await cmd("campaigns.create", { name: "Fall" });
  await fails(cmd("campaigns.rename", { id: other.id, name: "spring run" }), 409);

  const p = await cmd("pitches.flag", { kind: "venue", id: v1 });
  await cmd("pitches.setCampaign", { ids: [p.id], campaignId: c.id });
  assert.equal((await cmd("campaigns.close", { id: c.id })).changed, true);
  doc = (await db.get("campaigns", c.id))!;
  assert.equal(doc.status, "closed");
  assert.equal((await db.get("pitches", p.id))!.campaignId, c.id, "closing never clears the pitch's campaign");
  assert.equal((await cmd("campaigns.close", { id: c.id })).changed, false);
  assert.equal((await cmd("campaigns.reopen", { id: c.id })).changed, true);
  assert.equal((await db.get("campaigns", c.id))!.status, "active");
});

test("pitches.setCampaign: into a campaign, back to Ongoing with null; refuses a closed campaign and other bands'", async () => {
  const c = (await cmd("campaigns.create", { name: "Spring" })).id;
  const p1 = (await cmd("pitches.flag", { kind: "venue", id: v1 })).id, p2 = (await cmd("pitches.flag", { kind: "venue", id: v2 })).id;
  assert.deepEqual((await cmd("pitches.setCampaign", { ids: [p1, p2], campaignId: c })).ids, [p1, p2]);
  assert.equal((await db.get("pitches", p2))!.campaignId, c);
  assert.deepEqual((await cmd("pitches.setCampaign", { ids: [p1], campaignId: c })).ids, [], "already there: no write");
  await cmd("pitches.setCampaign", { ids: [p1], campaignId: null });
  assert.equal((await db.get("pitches", p1))!.campaignId, undefined, "null takes it out (Ongoing)");

  await cmd("campaigns.close", { id: c });
  await fails(cmd("pitches.setCampaign", { ids: [p1], campaignId: c }), 409);
  assert.equal((await db.get("pitches", p1))!.campaignId, undefined);

  // Another band's campaign is not found; another band can't touch this band's pitches or campaigns.
  const theirs = (await cmd("campaigns.create", { name: "Theirs" }, octx)).id;
  await fails(cmd("pitches.setCampaign", { ids: [p1], campaignId: theirs }), 404);
  await fails(cmd("pitches.setCampaign", { ids: [p1], campaignId: null }, octx), 404);
  await fails(cmd("campaigns.rename", { id: c, name: "Mine now" }, octx), 404);
  await fails(cmd("campaigns.reopen", { id: c }, octx), 404);
  assert.equal((await db.get("pitches", p2))!.campaignId, c);
});

test("pitches.move: no second active pitch for the same place", async () => {
  const old = (await cmd("pitches.flag", { kind: "venue", id: v1 })).id;
  await cmd("pitches.move", { id: old, status: "declined" });
  const now = await cmd("pitches.flag", { kind: "venue", id: v1 });
  assert.equal(now.existing, false);
  await fails(cmd("pitches.move", { id: old, status: "talking" }), 409);
  assert.equal((await db.get("pitches", old))!.status, "declined");
  await cmd("pitches.move", { id: now.id, status: "pitched" }); // active to active is fine
  await cmd("pitches.move", { id: old, status: "dropped" });    // inactive to inactive is fine
  // Another band's active pitch on the same room doesn't count.
  const theirs = (await cmd("pitches.flag", { kind: "venue", id: v2 }, octx)).id;
  assert.ok(theirs);
  const mine = (await cmd("pitches.flag", { kind: "venue", id: v2 })).id;
  await cmd("pitches.move", { id: mine, status: "declined" });
  await cmd("pitches.move", { id: mine, status: "talking" });
  // Once the other one closes, the old one can come back.
  await cmd("pitches.move", { id: now.id, status: "declined" });
  await cmd("pitches.move", { id: old, status: "talking" });
  assert.equal((await db.get("pitches", old))!.status, "talking");
});

test("pitches.flag and tours.addPitch take campaignId: only a new pitch goes in; never a closed or another band's campaign", async () => {
  const c = (await cmd("campaigns.create", { name: "Breweries" })).id;
  const p = await cmd("pitches.flag", { kind: "venue", id: v1, campaignId: c });
  assert.deepEqual([p.existing, p.campaignId], [false, c]);
  assert.equal((await db.get("pitches", p.id))!.campaignId, c);
  const again = await cmd("pitches.flag", { kind: "venue", id: v1 });
  assert.deepEqual([again.id, again.existing, again.campaignId], [p.id, true, c]);
  const plain = await cmd("pitches.flag", { kind: "venue", id: v2 });
  assert.equal((await db.get("pitches", plain.id))!.campaignId, undefined, "no campaign: Ongoing");
  await cmd("pitches.move", { id: plain.id, status: "dropped" });
  await cmd("campaigns.close", { id: c });
  await fails(cmd("pitches.flag", { kind: "venue", id: v2, campaignId: c }), 409);
  const theirs = (await cmd("campaigns.create", { name: "Theirs" }, octx)).id;
  await fails(cmd("pitches.flag", { kind: "venue", id: v2, campaignId: theirs }), 404);
  await cmd("campaigns.reopen", { id: c });
  const proj = (await cmd("projects.create", { kind: "band", name: "Band", isDefault: true })).id;
  const tour = (await cmd("tours.create", { name: "West", projectId: proj, startDate: "2026-11-05", endDate: "2026-11-08" })).id;
  const t = await cmd("tours.addPitch", { tourId: tour, venueId: v2, campaignId: c });
  assert.equal((await db.get("pitches", t.pitchId))!.campaignId, c);
});

test("history.undoRun puts back what a campaign command changed", async () => {
  const c = (await cmd("campaigns.create", { name: "Spring" })).id;
  const p = (await cmd("pitches.flag", { kind: "venue", id: v1 })).id;

  const set = fresh();
  await cmd("pitches.setCampaign", { ids: [p], campaignId: c }, set);
  await cmd("history.undoRun", { runId: set.runId });
  assert.equal((await db.get("pitches", p))!.campaignId, undefined);

  const close = fresh();
  await cmd("campaigns.close", { id: c }, close);
  await cmd("history.undoRun", { runId: close.runId });
  assert.equal((await db.get("campaigns", c))!.status, "active");

  const rename = fresh();
  await cmd("campaigns.rename", { id: c, name: "Spring Run" }, rename);
  await cmd("history.undoRun", { runId: rename.runId });
  assert.equal((await db.get("campaigns", c))!.name, "Spring");

  const make = fresh();
  const c2 = (await cmd("campaigns.create", { name: "Fall" }, make)).id;
  await cmd("history.undoRun", { runId: make.runId });
  assert.ok((await db.get("campaigns", c2))!.deletedAt, "an undone create is archived");
});
