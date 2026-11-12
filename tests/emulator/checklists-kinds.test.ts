import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { importCtx, newRunId, type Ctx } from "@/server/ctx";
import { resetEmulators, makeArtist, TEST_ARTIST } from "./helpers";

beforeEach(resetEmulators);

const cmd = async (name: string, input: unknown, c: Ctx) => {
  const x = registry[name];
  if (!x.roles.includes(c.role)) throw new Error(`Role ${c.role} may not run ${name}`);
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};
const base = {
  status: "confirmed", personnel: [], sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false },
  docs: [], listings: {}, place: { city: "Denver" }, times: {},
};

async function world() {
  await makeArtist("Nora Quill Band", "nora-quill-band");
  const admin: Ctx = { uid: "u-admin", role: "admin", artistId: TEST_ARTIST, via: "app", runId: newRunId() };
  const member: Ctx = { uid: "u-member", role: "member", artistId: TEST_ARTIST, via: "app", runId: newRunId() };
  const show = (await db.create(importCtx(), "shows", { ...base, date: "2027-01-16", artistId: TEST_ARTIST, checklists: [] })).id;
  const project = (await db.create(importCtx(), "projects", { artistId: TEST_ARTIST, name: "Spring EP", kind: "release", status: "open" })).id;
  const release = (await db.create(importCtx(), "releases", { artistId: TEST_ARTIST, title: "Spring EP", kind: "ep", projectId: project })).id;
  return { admin, member, show, release };
}

test("templates apply to show, release or social: missing means show; New list only takes a template of its own kind", async () => {
  const { admin, show, release } = await world();
  const old = (await db.create(importCtx(), "checklistTemplates", { artistId: TEST_ARTIST, name: "Advance", order: 0, items: [{ id: "a1", label: "Load-in time" }] })).id;
  const { id: rel } = await cmd("checklistTemplates.create", { name: "Manufacturing", appliesTo: "release", items: [{ label: "Approve the test pressing" }] }, admin);
  const listed = await cmd("checklistTemplates.list", {}, admin);
  assert.deepEqual(listed.templates.map((t: any) => [t.name, t.appliesTo]), [["Advance", "show"], ["Manufacturing", "release"]]);

  await cmd("checklists.add", { kind: "release", id: release, templateId: rel }, admin);
  const lists = (await db.get("releases", release))!.checklists as any[];
  assert.deepEqual(lists.map((l) => [l.name, l.templateId, l.items.map((i: any) => i.label)]), [["Manufacturing", rel, ["Approve the test pressing"]]]);
  await assert.rejects(cmd("checklists.add", { kind: "release", id: release, templateId: old }, admin), /isn't a Release template/);
  await assert.rejects(cmd("shows.addChecklist", { id: show, templateId: rel }, admin), /isn't a Show template/);

  await cmd("checklistTemplates.update", { id: rel, patch: { appliesTo: "social" } }, admin);
  assert.equal((await db.get("checklistTemplates", rel))!.appliesTo, "social");
});

test("Social Media lists: one doc per artist, made by the first list; items tick and pin like a show's", async () => {
  const { admin } = await world();
  assert.equal(await db.get("socialChecklists", TEST_ARTIST), null);
  const { listId } = await cmd("checklists.add", { kind: "social", id: TEST_ARTIST, name: "Hi-Dive promo" }, admin);
  const { itemId } = await cmd("checklists.addItem", { kind: "social", id: TEST_ARTIST, listId, label: "Share the poster to Stories" }, admin);
  await cmd("checklists.add", { kind: "social", id: TEST_ARTIST, name: "Every month" }, admin);
  await cmd("checklists.check", { kind: "social", id: TEST_ARTIST, listId, itemId, done: true }, admin);
  const doc = (await db.get("socialChecklists", TEST_ARTIST))!;
  assert.equal(doc.artistId, TEST_ARTIST);
  assert.deepEqual(doc.checklists.map((l: any) => l.name), ["Hi-Dive promo", "Every month"]);
  assert.equal(doc.checklists[0].items[0].doneBy, "u-admin");
  await assert.rejects(cmd("checklists.add", { kind: "social", id: "someone-else", name: "X" }, admin), /not found/);
});

test("pins: set on the item with who and when, kept by edits and setChecklists, removed by unpin; admins only", async () => {
  const { admin, member, show } = await world();
  const { listId } = await cmd("shows.addChecklist", { id: show, name: "Advance" }, admin);
  const { itemId } = await cmd("shows.addChecklistItem", { id: show, listId, label: "Send stage plot" }, member);
  const item = async () => ((await db.get("shows", show))!.checklists as any[])[0].items[0];

  assert.ok(!registry["checklists.pin"].roles.includes("member"));
  await cmd("checklists.pin", { kind: "show", id: show, listId, itemId, pinned: true }, admin);
  const pinned = await item();
  assert.equal(pinned.pinnedBy, "u-admin");
  assert.ok(pinned.pinnedAt);

  await cmd("shows.editChecklistItem", { id: show, listId, itemId, label: "Send the stage plot", ownerId: null }, member);
  await cmd("shows.checkItem", { id: show, listId, itemId, done: true }, member);
  assert.equal((await item()).pinnedAt, pinned.pinnedAt, "edits and ticks keep the pin");
  const lists = (await db.get("shows", show))!.checklists as any[];
  await cmd("shows.setChecklists", { id: show, checklists: lists.map((l) => ({ ...l, items: l.items.map(({ id, label, done }: any) => ({ id, label, done })) })) }, admin);
  assert.equal((await item()).pinnedAt, pinned.pinnedAt, "setChecklists keeps pins on items it keeps");

  await cmd("checklists.pin", { kind: "show", id: show, listId, itemId, pinned: false }, admin);
  const after = await item();
  assert.equal(after.pinnedAt, undefined);
  assert.equal(after.pinnedBy, undefined);
});

test("release and Social Media lists are admins' only; members keep show items", async () => {
  const { admin, member, show, release } = await world();
  const { listId } = await cmd("checklists.add", { kind: "release", id: release, name: "Release day" }, admin);
  await assert.rejects(cmd("checklists.addItem", { kind: "release", id: release, listId, label: "Pre-save" }, member), /Only admins/);
  await assert.rejects(cmd("checklists.addItem", { kind: "social", id: TEST_ARTIST, listId, label: "Post" }, member), /Only admins/);
  const s = await cmd("shows.addChecklist", { id: show, name: "Promo" }, admin);
  await cmd("checklists.addItem", { kind: "show", id: show, listId: s.listId, label: "Posters" }, member);
  assert.equal(((await db.get("shows", show))!.checklists as any[])[0].items.length, 1);
});
