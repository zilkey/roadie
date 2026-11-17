/**
 * Approved editors for the shared directory (tenancy plan, phase 1): only approved people change existing shared records;
 * anyone signed in can still create one and edit it until an approved editor adopts it; merge and remove need a platform admin.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@/server/commands/registry";
import { db, run } from "@/server/db";
import { importCtx, newRunId, type Ctx } from "@/server/ctx";
import { undoRun } from "@/server/undo";
import { revokeEditor } from "@/server/platform";
import { resetEmulators, makeUser, venue, approveTestEditors, makePlatformAdmins, SYS, TEST_ARTIST } from "./helpers";

const BAND = "test-artist", OTHER = "other-artist";
let stranger: Ctx, editor: Ctx, platform: Ctx;
const fresh = (c: Ctx): Ctx => ({ ...c, runId: newRunId() }); // a new call: approvals are read once per call

beforeEach(async () => {
  await resetEmulators();
  const s = await makeUser("olga@example.com", "admin", { name: "Olga", artistId: OTHER });
  const e = await makeUser("rudy@example.com", "admin", { name: "Rudy", artistId: BAND });
  const p = await makeUser("jeff@example.com", "admin", { name: "Jeff", artistId: BAND });
  await approveTestEditors(e.uid);
  await makePlatformAdmins(p.uid);
  stranger = { uid: s.uid, role: "admin", artistId: OTHER, via: "app", runId: newRunId() };
  editor = { uid: e.uid, role: "admin", artistId: BAND, via: "app", runId: newRunId() };
  platform = { uid: p.uid, role: "admin", artistId: BAND, via: "app", runId: newRunId() };
});

const cmd = async (name: string, input: unknown, c: Ctx) => {
  const x = registry[name];
  return (await x.run(fresh(c), x.input.parse(input))) as Record<string, any>;
};
const refused = (p: Promise<unknown>) => assert.rejects(p, (e: any) => e.status === 403 && e.code === "not_approved" && /Only approved editors can change shared/.test(e.message));
const forbidden = (p: Promise<unknown>) => assert.rejects(p, (e: any) => e.status === 403 && e.code === "forbidden");
/** A venue someone else (an import) put in the directory. */
const seeded = async (name = "Gothic Theatre", city = "Englewood") => (await db.create(importCtx(TEST_ARTIST, "seed"), "venues", venue(name, city))).id;

test("an unapproved admin creates a venue and edits it, but can't edit someone else's", async () => {
  const mine = (await cmd("venues.create", venue("Olga's Room", "Boulder"), stranger)).id;
  await cmd("venues.update", { id: mine, patch: { capacity: 60 } }, stranger);
  assert.equal((await db.get(SYS, "venues", mine))!.capacity, 60);

  const theirs = await seeded();
  await refused(cmd("venues.update", { id: theirs, patch: { capacity: 999 } }, stranger));
  assert.equal((await db.get(SYS, "venues", theirs))!.capacity, undefined);
  // Sending what's already there changes nothing, so it isn't refused (autosave forms resend unchanged fields).
  assert.deepEqual(await cmd("venues.update", { id: theirs, patch: { name: "Gothic Theatre" } }, stranger), { id: theirs, changed: false });
});

test("a deduping create links to the existing venue without filling its shared fields", async () => {
  const theirs = await seeded();
  const r = await cmd("venues.create", venue("Gothic Theatre", "Englewood", { capacity: 1100, website: "gothic.example" }), stranger);
  assert.deepEqual({ id: r.id, merged: r.merged }, { id: theirs, merged: true });
  const v = (await db.get(SYS, "venues", theirs))!;
  assert.equal(v.capacity, undefined);
  assert.equal(v.website, undefined);
  // An approved editor's create fills the gaps (and adopts it).
  await cmd("venues.create", venue("Gothic Theatre", "Englewood", { capacity: 1100 }), editor);
  assert.equal((await db.get(SYS, "venues", theirs))!.capacity, 1100);
});

test("the creator loses the right once an approved editor adopts it, and can't undo their create past that", async () => {
  const created = fresh(stranger);
  const id = (await registry["venues.create"].run(created, venue("Lost Lake", "Denver") as never) as { id: string }).id;
  await cmd("venues.update", { id, patch: { capacity: 150 } }, editor);
  const v = (await db.get(SYS, "venues", id))!;
  assert.ok(v.adoptedAt, "an approved editor's first change adopts it");
  assert.equal(v.createdBy, stranger.uid);
  await refused(cmd("venues.update", { id, patch: { capacity: 20 } }, stranger));
  const report = await undoRun(fresh(stranger), created.runId, { ownerUid: stranger.uid });
  assert.equal(report.failed.length, 1);
  assert.match(report.failed[0].reason ?? "", /Only approved editors can change shared venues/);
  assert.equal((await db.get(SYS, "venues", id))!.deletedAt, null);
});

test("an unapproved admin still writes their own band's venue notes", async () => {
  const theirs = await seeded();
  await cmd("venues.update", { id: theirs, patch: { loadInNotes: "Alley door", notes: "Ask for Sam" } }, stranger);
  const note = await db.get(SYS, "venueNotes", `${OTHER}__${theirs}`);
  assert.equal(note?.loadInNotes, "Alley door");
  // and their notes on a festival they can't edit
  const f = (await db.create(importCtx(TEST_ARTIST, "seed"), "festivals", { name: "Folks Fest", type: "festival", address: { city: "Lyons", state: "CO" } })).id;
  await cmd("festivals.update", { id: f, patch: { notes: "Apply in January" } }, stranger);
  await refused(cmd("festivals.update", { id: f, patch: { website: "folks.example" } }, stranger));
});

test("after approval they can edit; after revoke they can't", async () => {
  const theirs = await seeded();
  await refused(cmd("venues.update", { id: theirs, patch: { capacity: 500 } }, stranger));
  await approveTestEditors(stranger.uid);
  await cmd("venues.update", { id: theirs, patch: { capacity: 500 } }, stranger);
  assert.equal((await db.get(SYS, "venues", theirs))!.capacity, 500);
  await revokeEditor(stranger.uid, "test");
  await refused(cmd("venues.update", { id: theirs, patch: { capacity: 501 } }, stranger));
});

test("system writes still work: a rename's copies, act lookups, imports", async () => {
  // A venue renamed by an approved editor updates the stranger's show at it (a denormalization hook).
  const theirs = await seeded();
  const show = (await db.create(fresh(stranger), "shows", {
    date: "2027-01-10", status: "confirmed", venue: { id: theirs, name: "Gothic Theatre", address: "Englewood", city: "Englewood" }, times: {}, artistId: OTHER, personnel: [],
    sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false }, docs: [],
  })).id;
  await cmd("venues.update", { id: theirs, patch: { name: "The Gothic" } }, editor);
  assert.equal((await db.get(SYS, "shows", show))!.venue.name, "The Gothic");
  // An act a venue calendar added: a lookup fills it as the system, not as the person.
  const act = (await db.create(importCtx(TEST_ARTIST, "venue-calendars"), "acts", { name: "Big Thief" })).id;
  await run(fresh(stranger), (w) => w.system(() => w.update("acts", act, { hometown: "Brooklyn, NY" })));
  assert.equal((await db.get(SYS, "acts", act))!.hometown, "Brooklyn, NY");
  await refused(cmd("acts.update", { id: act, patch: { hometown: "Somewhere" } }, stranger));
  // Imports (linkActs) run as the system now; an artist's import ctx is no longer exempt.
  await db.update(SYS, "acts", act, { description: "Indie rock" });
  await refused(db.update(importCtx(TEST_ARTIST), "acts", act, { description: "Pop" }));
});

test("a festival rename by its unapproved creator still updates editions others created (hooks)", async () => {
  const f = (await cmd("festivals.create", { name: "Olga Fest", type: "festival", address: { city: "Lyons", state: "CO" } }, stranger)).id;
  const ed = (await cmd("editions.create", { festivalId: f, year: 2027, label: "2027" }, editor)).id;
  await cmd("festivals.update", { id: f, patch: { name: "Olga's Fest" } }, stranger);
  assert.equal((await db.get(SYS, "editions", ed))!.festivalName, "Olga's Fest");
});

test("merge and remove on shared kinds need a platform admin", async () => {
  const a = await seeded("Bluebird", "Denver"), b = await seeded("Bluebird Theater", "Denver");
  await forbidden(cmd("venues.mergeInto", { from: a, into: b }, editor));
  await cmd("venues.mergeInto", { from: a, into: b }, platform);
  assert.equal((await db.get(SYS, "venues", a))!.mergedInto, b);

  const f = (await cmd("festivals.create", { name: "Planet Bluegrass", type: "festival", address: { city: "Lyons", state: "CO" } }, editor)).id;
  const ed = (await cmd("editions.create", { festivalId: f, year: 2027, label: "2027" }, editor)).id;
  const p = (await cmd("promoters.create", { name: "Z2", kind: "promoter" }, editor)).id;
  await forbidden(cmd("editions.remove", { id: ed }, editor));
  await forbidden(cmd("festivals.remove", { id: f }, editor));
  await forbidden(cmd("promoters.remove", { id: p }, editor));
  await cmd("venueTypes.add", { label: "Winery" }, editor);
  await forbidden(cmd("venueTypes.rename", { id: "winery", label: "Vineyard" }, editor));
  await forbidden(cmd("venueTypes.remove", { id: "winery" }, editor));
  await cmd("festivals.remove", { id: f }, platform);
  await cmd("promoters.remove", { id: p }, platform);
  await cmd("venueTypes.rename", { id: "winery", label: "Vineyard" }, platform);
  assert.ok((await db.get(SYS, "festivals", f))!.deletedAt);
  assert.ok((await db.get(SYS, "editions", ed))!.deletedAt);
  // A venue's archive is this band's own list, not the shared room: any admin still can.
  await cmd("venues.remove", { id: b }, editor);
});

test("restoring an archived venue type is an edit: approved only", async () => {
  await cmd("venueTypes.add", { label: "Winery" }, editor);
  await cmd("venueTypes.remove", { id: "winery" }, platform);
  await refused(cmd("venueTypes.add", { label: "Winery" }, stranger));
  assert.equal((await cmd("venueTypes.add", { label: "Winery" }, editor)).id, "winery");
});

test("a request to edit shows up in sharedEditors.list for a platform admin only; approve and deny", async () => {
  assert.deepEqual(await cmd("sharedEditors.request", { note: "We play the Gothic a lot" }, stranger), { requested: true });
  assert.deepEqual(await cmd("sharedEditors.request", {}, editor), { approved: true });
  await forbidden(cmd("sharedEditors.list", {}, editor));
  await forbidden(cmd("sharedEditors.list", {}, stranger));
  const l = await cmd("sharedEditors.list", {}, platform);
  assert.deepEqual(l.requests.map((r: any) => [r.name, r.note]), [["Olga", "We play the Gothic a lot"]]);
  assert.deepEqual(l.editors.map((e: any) => e.name), ["Rudy"]);
  await forbidden(cmd("sharedEditors.approve", { uid: stranger.uid }, editor));
  await cmd("sharedEditors.approve", { uid: stranger.uid }, platform);
  const after = await cmd("sharedEditors.list", {}, platform);
  assert.equal(after.requests.length, 0);
  assert.deepEqual(after.editors.map((e: any) => e.name), ["Olga", "Rudy"]);
  await cmd("sharedEditors.revoke", { uid: stranger.uid }, platform);
  await cmd("sharedEditors.request", {}, stranger);
  await cmd("sharedEditors.deny", { uid: stranger.uid }, platform);
  const denied = await cmd("sharedEditors.list", {}, platform);
  assert.equal(denied.requests.length, 0);
  assert.deepEqual(denied.editors.map((e: any) => e.name), ["Rudy"]);
});
