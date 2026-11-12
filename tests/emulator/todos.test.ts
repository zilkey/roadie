import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { firestore } from "@/server/admin";
import { importCtx, newRunId, type Ctx } from "@/server/ctx";
import { todoPrefs } from "@/server/prefs";
import { followUpFor } from "@/lib/booking";
import { resetEmulators, makeArtist, makeUser, TEST_ARTIST } from "./helpers";

beforeEach(resetEmulators);

const cmd = async (name: string, input: unknown, c: Ctx) => {
  const x = registry[name];
  if (!x.roles.includes(c.role)) throw new Error(`Role ${c.role} may not run ${name}`);
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};
const admin = (uid = "u-admin"): Ctx => ({ uid, role: "admin", artistId: TEST_ARTIST, via: "app", runId: newRunId() });

const TODOS = ["todos.add", "todos.edit", "todos.check", "todos.pin", "todos.remove", "todos.setOrder", "todos.setColumns", "todos.dismiss", "todos.undismiss"];

test("todos.* are admin-only and not Roadie's", () => {
  for (const n of TODOS) assert.deepEqual(registry[n].roles, ["admin"], n);
});

test("Our list: add, edit and pick who, tick (stamps who and when), untick, remove", async () => {
  await makeArtist("Nora Quill Band", "nora-quill-band");
  const dean = (await db.create(importCtx(), "musicians", { name: "Dean", instruments: ["drums"], active: true })).id;
  const { id } = await cmd("todos.add", { label: "  Order more stickers " }, admin());
  let t = (await db.get("todos", id))!;
  assert.equal(t.artistId, TEST_ARTIST);
  assert.equal(t.label, "Order more stickers");
  assert.equal(t.done, false);
  assert.equal(t.ownerId, undefined);

  await cmd("todos.edit", { id, label: "Order 500 stickers", ownerId: dean }, admin());
  t = (await db.get("todos", id))!;
  assert.deepEqual([t.label, t.ownerId], ["Order 500 stickers", dean]);
  await assert.rejects(cmd("todos.edit", { id, label: "x", ownerId: "nobody" }, admin()), /Musician not found/);
  await cmd("todos.edit", { id, label: "Order 500 stickers", ownerId: null }, admin());
  assert.equal((await db.get("todos", id))!.ownerId, undefined, "null unassigns");
  await assert.rejects(cmd("todos.edit", { id, label: "  ", ownerId: null }, admin()));

  await cmd("todos.check", { id, done: true }, admin());
  t = (await db.get("todos", id))!;
  assert.equal(t.done, true);
  assert.equal(t.doneBy, "u-admin");
  assert.ok(typeof t.doneAt === "string");
  await cmd("todos.check", { id, done: false }, admin());
  t = (await db.get("todos", id))!;
  assert.deepEqual([t.done, t.doneAt, t.doneBy], [false, undefined, undefined]);

  await cmd("todos.remove", { id }, admin());
  assert.ok((await db.get("todos", id))!.deletedAt);
  await assert.rejects(cmd("todos.check", { id, done: true }, admin()), /not found/);
});

test("Our list pins: add straight into Pinned, pin and unpin (shared, keeps the first pin)", async () => {
  await makeArtist("Nora Quill Band", "nora-quill-band");
  const { id } = await cmd("todos.add", { label: "Book the van", pinned: true }, admin());
  let t = (await db.get("todos", id))!;
  assert.equal(t.pinnedBy, "u-admin");
  const first = t.pinnedAt;
  assert.ok(typeof first === "string");
  await cmd("todos.pin", { id, pinned: true }, admin("u-other"));
  t = (await db.get("todos", id))!;
  assert.deepEqual([t.pinnedAt, t.pinnedBy], [first, "u-admin"]);
  await cmd("todos.pin", { id, pinned: false }, admin());
  t = (await db.get("todos", id))!;
  assert.deepEqual([t.pinnedAt, t.pinnedBy], [undefined, undefined]);
  const plain = (await cmd("todos.add", { label: "Renew ASCAP" }, admin())).id;
  assert.equal((await db.get("todos", plain))!.pinnedAt, undefined);
});

test("the band's own lists (Add list): kind board in todoLists/{artistId}, made by the first list; items add, tick, pin; admins only", async () => {
  await makeArtist("Nora Quill Band", "nora-quill-band");
  assert.equal(await db.get("todoLists", TEST_ARTIST), null);
  const { listId } = await cmd("checklists.add", { kind: "board", id: TEST_ARTIST, name: "Van stuff" }, admin());
  const { itemId } = await cmd("checklists.addItem", { kind: "board", id: TEST_ARTIST, listId, label: "Oil change" }, admin());
  await cmd("checklists.add", { kind: "board", id: TEST_ARTIST, name: "Merch" }, admin());
  await cmd("checklists.check", { kind: "board", id: TEST_ARTIST, listId, itemId, done: true }, admin());
  await cmd("checklists.pin", { kind: "board", id: TEST_ARTIST, listId, itemId, pinned: true }, admin());
  const doc = (await db.get("todoLists", TEST_ARTIST))!;
  assert.equal(doc.artistId, TEST_ARTIST);
  assert.deepEqual(doc.checklists.map((l: { name: string }) => l.name), ["Van stuff", "Merch"]);
  const it = doc.checklists[0].items[0];
  assert.deepEqual([it.label, it.done, it.doneBy, it.pinnedBy], ["Oil change", true, "u-admin", "u-admin"]);
  assert.equal(await db.get("socialChecklists", TEST_ARTIST), null, "Social Media's lists are separate");

  await assert.rejects(cmd("checklists.add", { kind: "board", id: "someone-else", name: "X" }, admin()), /not found/);
  await assert.rejects(cmd("checklists.saveAsTemplate", { kind: "board", id: TEST_ARTIST, listId }, admin()), /can't be saved as templates/);
  const member: Ctx = { ...admin("u-member"), role: "member" };
  await assert.rejects(registry["checklists.addItem"].run(member, { kind: "board", id: TEST_ARTIST, listId, label: "x" } as never), /Only admins/);
  await assert.rejects(cmd("checklistTemplates.create", { name: "X", appliesTo: "board" }, admin()), "templates don't apply to board lists");

  await cmd("checklists.remove", { kind: "board", id: TEST_ARTIST, listId }, admin());
  assert.deepEqual((await db.get("todoLists", TEST_ARTIST))!.checklists.map((l: { name: string }) => l.name), ["Merch"]);
});

test("another artist's to-do is not found", async () => {
  await makeArtist("Nora Quill Band", "nora-quill-band");
  const { id } = await cmd("todos.add", { label: "Renew ASCAP" }, admin());
  const other: Ctx = { ...admin(), artistId: "someone-else" };
  await assert.rejects(cmd("todos.edit", { id, label: "x", ownerId: null }, other), /not found/);
  await assert.rejects(cmd("todos.remove", { id }, other), /not found/);
});

test("order and Dismiss are per person, in userPrefs, and touch nothing else", async () => {
  const rudy = await makeUser("rudy@example.com", "admin");
  const ingrid = await makeUser("ingrid@example.com", "admin");
  await firestore().doc(`userPrefs/${rudy.uid}`).set({ uid: rudy.uid, hiddenSections: ["money"] });

  await cmd("todos.setOrder", { column: "pinned", keys: ["todo:b", "show:s1:l1:i1", "todo:b"] }, admin(rudy.uid));
  await cmd("todos.setOrder", { column: "show:s1", keys: ["show:s1:l1:i2"] }, admin(rudy.uid));
  await cmd("todos.setOrder", { column: "pinned", keys: ["pitch:p1", "todo:b"] }, admin(rudy.uid));
  await assert.rejects(cmd("todos.setOrder", { column: "nope", keys: [] }, admin(rudy.uid)));
  await cmd("todos.setColumns", { keys: ["our", "show:s1", "pinned", "our"] }, admin(rudy.uid));
  const hugo = await makeUser("hugo@example.com", "admin");
  await cmd("todos.setOrder", { column: "list:b1", keys: ["board:a1:b1:i1"] }, admin(hugo.uid));
  await cmd("todos.setColumns", { keys: ["list:b1", "our"] }, admin(hugo.uid));
  assert.deepEqual(await todoPrefs(hugo.uid), { order: { "list:b1": ["board:a1:b1:i1"] }, columns: ["list:b1", "our"], dismissed: [] }, "the band's lists are columns too");
  await assert.rejects(cmd("todos.setColumns", { keys: ["nope"] }, admin(rudy.uid)), /Not a To Dos column/);

  await cmd("todos.dismiss", { key: "show:s1:l1" }, admin(rudy.uid));
  await cmd("todos.dismiss", { key: "social:a1:l2" }, admin(rudy.uid));
  await cmd("todos.dismiss", { key: "show:s1:l1" }, admin(rudy.uid));
  await assert.rejects(cmd("todos.dismiss", { key: "show:s1" }, admin(rudy.uid)), /checklist key/);
  await assert.rejects(cmd("todos.dismiss", { key: "pitch:p1:x" }, admin(rudy.uid)), /checklist key/);

  assert.deepEqual(await todoPrefs(rudy.uid), { order: { pinned: ["pitch:p1", "todo:b"], "show:s1": ["show:s1:l1:i2"] }, columns: ["our", "show:s1", "pinned"], dismissed: ["show:s1:l1", "social:a1:l2"] });
  const r = await cmd("todos.undismiss", { key: "show:s1:l1" }, admin(rudy.uid));
  assert.deepEqual(r.dismissed, ["social:a1:l2"]);
  assert.deepEqual(await todoPrefs(ingrid.uid), { order: {}, columns: [], dismissed: [] }, "someone else's view is untouched");
  assert.deepEqual((await firestore().doc(`userPrefs/${rudy.uid}`).get()).data()?.hiddenSections, ["money"], "other prefs are kept");
});

test("the follow-up rule (pure, shared with pitches.needingFollowUp): due next step, or Pitched/Talking quiet 14 days", () => {
  const at = (d: string) => ({ toMillis: () => Date.parse(d + "T18:00:00Z") });
  const today = "2026-11-12";
  assert.equal(followUpFor({ status: "toPitch", createdAt: at("2026-01-01") }, today), null, "To Pitch never goes quiet");
  assert.equal(followUpFor({ status: "pitched", lastContactAt: at("2026-10-30") }, today), null, "13 days");
  assert.deepEqual(followUpFor({ status: "talking", lastContactAt: at("2026-10-29") }, today), { reasons: ["No contact for 14 days"], due: false, quiet: true, daysSinceContact: 14 });
  assert.deepEqual(followUpFor({ status: "toPitch", nextStep: { text: "Send avails", due: "2026-11-12" }, createdAt: at("2026-11-01") }, today),
    { reasons: ['Next step "Send avails" was due 2026-11-12'], due: true, quiet: false, daysSinceContact: 11 });
  assert.equal(followUpFor({ status: "pitched", nextStep: { text: "Later", due: "2026-11-13" }, lastContactAt: at("2026-11-10") }, today), null);
  assert.equal(followUpFor({ status: "booked", nextStep: { text: "Old", due: "2026-01-01" } }, today), null, "not active");
  assert.equal(followUpFor({ status: "pitched", lastContactAt: at("2026-11-01") }, today, 5)?.quiet, true, "quietDays is a parameter");
});
