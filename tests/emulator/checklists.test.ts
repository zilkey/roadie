import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@/server/commands/registry";
import { db, run } from "@/server/db";
import { importCtx, newRunId, type Ctx } from "@/server/ctx";
import { firestore } from "@/server/admin";
import { seedDefaultTemplates } from "@/server/checklistTemplates";
import { resetEmulators, makeArtist, makeUser, TEST_ARTIST } from "./helpers";

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
const show = async (extra: Record<string, unknown> = {}, artistId = TEST_ARTIST) =>
  (await db.create(importCtx(), "shows", { ...base, date: "2027-01-16", artistId, checklists: [], ...extra })).id;
const lists = async (id: string) => (await db.get("shows", id))!.checklists as any[];
const templates = async (artistId = TEST_ARTIST) =>
  (await db.list("checklistTemplates", (q) => q.where("artistId", "==", artistId))).sort((a, b) => a.order - b.order);

async function world() {
  await makeArtist("Nora Quill Band", "nora-quill-band");
  const musician = (await db.create(importCtx(), "musicians", { name: "Hugo", instruments: [], active: true })).id;
  const admin: Ctx = { uid: "u-admin", role: "admin", artistId: TEST_ARTIST, via: "app", runId: newRunId() };
  const member: Ctx = { uid: "u-member", role: "member", artistId: TEST_ARTIST, musicianId: musician, via: "app", runId: newRunId() };
  return { admin, member, musician };
}

test("artists.create starts the artist with Promo and Follow Up; the seed helper appends after what is there", async () => {
  const u = await makeUser("rudy@example.com", "admin");
  const ctx: Ctx = { uid: u.uid, role: "admin", via: "app", runId: newRunId() };
  const r = await cmd("artists.create", { name: "Fern Valley Trio", configurations: [] }, ctx);
  const ts = await templates(r.id);
  assert.deepEqual(ts.map((t) => [t.name, t.order, t.items.map((i: any) => i.label)]), [
    ["Promo", 0, ["Make show poster", "Post on social media", "Send email to email list"]],
    ["Follow Up", 1, ["Post on social media"]],
  ]);
  assert.ok(ts.every((t) => t.items.every((i: any) => i.id)));
  await run(importCtx(), (w) => seedDefaultTemplates(w, r.id));
  assert.deepEqual((await templates(r.id)).map((t) => t.order), [0, 1, 2, 3]);
});

test("templates: create goes last, update replaces name and items, reorder needs every id, remove is a soft delete; admins of that artist only", async () => {
  const { admin } = await world();
  await run(importCtx(), (w) => seedDefaultTemplates(w, TEST_ARTIST));
  const { id } = await cmd("checklistTemplates.create", { name: "Load-out", items: [{ label: "Get paid" }] }, admin);
  let ts = await templates();
  assert.deepEqual(ts.map((t) => t.name), ["Promo", "Follow Up", "Load-out"]);
  assert.equal(ts[2].order, 2);
  await cmd("checklistTemplates.update", { id, patch: { name: "Load out", items: [{ id: ts[2].items[0].id, label: "Get paid before leaving" }, { label: "Sweep the stage" }] } }, admin);
  const t = (await db.get("checklistTemplates", id))!;
  assert.equal(t.name, "Load out");
  assert.deepEqual(t.items.map((i: any) => i.label), ["Get paid before leaving", "Sweep the stage"]);
  assert.equal(t.items[0].id, ts[2].items[0].id, "items keep their ids");
  assert.ok(t.items[1].id);

  await cmd("checklistTemplates.reorder", { ids: [id, ts[0].id, ts[1].id] }, admin);
  assert.deepEqual((await templates()).map((x) => x.name), ["Load out", "Promo", "Follow Up"]);
  await assert.rejects(cmd("checklistTemplates.reorder", { ids: [id, ts[0].id] }, admin), /every template/);
  const listed = await cmd("checklistTemplates.list", {}, admin);
  assert.deepEqual(listed.templates.map((x: any) => x.name), ["Load out", "Promo", "Follow Up"]);

  await cmd("checklistTemplates.remove", { id }, admin);
  assert.ok((await db.get("checklistTemplates", id))!.deletedAt, "soft-deleted");
  assert.deepEqual((await templates()).map((x) => x.name), ["Promo", "Follow Up"]);

  const other: Ctx = { ...admin, artistId: "other-artist" };
  await assert.rejects(cmd("checklistTemplates.update", { id: ts[0].id, patch: { name: "Mine now" } }, other), /not found/);
  await assert.rejects(cmd("checklistTemplates.remove", { id: ts[0].id }, other), /not found/);
  for (const n of ["list", "create", "update", "reorder", "remove"]) assert.ok(!registry[`checklistTemplates.${n}`].roles.includes("member"), n);
});

test("show lists: add from a template (twice) or blank, rename, reorder, delete; admins only", async () => {
  const { admin, member } = await world();
  const [promo] = await run(importCtx(), (w) => seedDefaultTemplates(w, TEST_ARTIST));
  const id = await show();
  const a = await cmd("shows.addChecklist", { id, templateId: promo }, admin);
  const b = await cmd("shows.addChecklist", { id, templateId: promo }, admin);
  const c = await cmd("shows.addChecklist", { id, name: "Load-out" }, admin);
  let ls = await lists(id);
  assert.deepEqual(ls.map((l) => [l.id, l.name, l.templateId]), [[a.listId, "Promo", promo], [b.listId, "Promo", promo], [c.listId, "Load-out", null]]);
  assert.deepEqual(ls[0].items.map((i: any) => [i.label, i.done, i.ownerId ?? null]), [["Make show poster", false, null], ["Post on social media", false, null], ["Send email to email list", false, null]]);
  const tpl = (await db.get("checklistTemplates", promo))!;
  assert.ok(ls[0].items.every((i: any) => !tpl.items.some((x: any) => x.id === i.id)), "new item ids");
  assert.notEqual(ls[0].items[0].id, ls[1].items[0].id);

  await cmd("shows.renameChecklist", { id, listId: b.listId, name: "  Promo, again " }, admin);
  await cmd("shows.reorderChecklists", { id, listIds: [c.listId, a.listId, b.listId] }, admin);
  ls = await lists(id);
  assert.deepEqual(ls.map((l) => l.name), ["Load-out", "Promo", "Promo, again"]);
  await assert.rejects(cmd("shows.reorderChecklists", { id, listIds: [c.listId, a.listId] }, admin), /every list/);
  await cmd("shows.removeChecklist", { id, listId: a.listId }, admin);
  assert.deepEqual((await lists(id)).map((l) => l.id), [c.listId, b.listId]);

  for (const n of ["addChecklist", "renameChecklist", "removeChecklist", "reorderChecklists", "saveChecklistAsTemplate", "updateTemplateFromChecklist", "setChecklists"]) {
    await assert.rejects(cmd(`shows.${n}`, { id, listId: c.listId, name: "x", listIds: [], checklists: [] }, member), /may not run/, n);
  }
  const elsewhere = await show({}, "other-artist");
  await assert.rejects(cmd("shows.addChecklist", { id: elsewhere, name: "x" }, admin), /Show not found/);
  await assert.rejects(cmd("shows.addChecklist", { id, templateId: "nope" }, admin), /template not found/);
});

test("to-dos: members add, edit, remove and tick any item; ticking records who and when", async () => {
  const { admin, member, musician } = await world();
  const id = await show();
  const { listId } = await cmd("shows.addChecklist", { id, name: "Load-out" }, admin);
  const x = await cmd("shows.addChecklistItem", { id, listId, label: " Get paid ", ownerId: musician }, member);
  const y = await cmd("shows.addChecklistItem", { id, listId, label: "Sweep the stage" }, member);
  let items = (await lists(id))[0].items;
  assert.deepEqual(items.map((i: any) => [i.id, i.label, i.done, i.ownerId ?? null]), [[x.itemId, "Get paid", false, musician], [y.itemId, "Sweep the stage", false, null]]);

  await cmd("shows.editChecklistItem", { id, listId, itemId: x.itemId, label: "Get paid before leaving", ownerId: null }, member);
  await cmd("shows.checkItem", { id, listId, itemId: y.itemId, done: true }, member);
  items = (await lists(id))[0].items;
  assert.equal(items[0].label, "Get paid before leaving");
  assert.equal("ownerId" in items[0], false, "null unassigns");
  assert.equal(items[1].done, true);
  assert.equal(items[1].doneBy, "u-member");
  assert.ok(!Number.isNaN(Date.parse(items[1].doneAt)));

  await cmd("shows.checkItem", { id, listId, itemId: y.itemId, done: false }, admin);
  items = (await lists(id))[0].items;
  assert.equal(items[1].done, false);
  assert.equal("doneAt" in items[1] || "doneBy" in items[1], false, "unticking clears who and when");

  await cmd("shows.removeChecklistItem", { id, listId, itemId: x.itemId }, member);
  assert.deepEqual((await lists(id))[0].items.map((i: any) => i.id), [y.itemId]);
  await assert.rejects(cmd("shows.checkItem", { id, listId, itemId: "nope", done: true }, member), /No such checklist item/);
  await assert.rejects(cmd("shows.addChecklistItem", { id, listId: "nope", label: "x" }, member), /No such checklist/);
  await assert.rejects(cmd("shows.addChecklistItem", { id, listId, label: "x", ownerId: "ghost" }, member), /Musician not found/);
  await assert.rejects(cmd("shows.editChecklistItem", { id, listId, itemId: y.itemId, label: "  ", ownerId: null }, member));
});

test("Save as template links the list; Update template overwrites name and labels only; shows keep their lists", async () => {
  const { admin, musician } = await world();
  const [promo] = await run(importCtx(), (w) => seedDefaultTemplates(w, TEST_ARTIST));
  const id = await show();
  const { listId } = await cmd("shows.addChecklist", { id, name: "Load-out" }, admin);
  await cmd("shows.addChecklistItem", { id, listId, label: "Get paid", ownerId: musician }, admin);
  const saved = await cmd("shows.saveChecklistAsTemplate", { id, listId }, admin);
  const t = (await db.get("checklistTemplates", saved.templateId))!;
  assert.deepEqual([t.name, t.order, t.artistId, t.items.map((i: any) => Object.keys(i).sort())], ["Load-out", 2, TEST_ARTIST, [["id", "label"]]]);
  assert.equal((await lists(id))[0].templateId, saved.templateId);

  const p = await cmd("shows.addChecklist", { id, templateId: promo }, admin);
  const other = await show();
  await cmd("shows.addChecklist", { id: other, templateId: promo }, admin);
  const item = (await lists(id))[1].items[0];
  await cmd("shows.checkItem", { id, listId: p.listId, itemId: item.id, done: true }, admin);
  await cmd("shows.renameChecklist", { id, listId: p.listId, name: "Promo 2027" }, admin);
  await cmd("shows.addChecklistItem", { id, listId: p.listId, label: "Call the radio station", ownerId: musician }, admin);
  await cmd("shows.updateTemplateFromChecklist", { id, listId: p.listId }, admin);
  const u = (await db.get("checklistTemplates", promo))!;
  assert.equal(u.name, "Promo 2027");
  assert.deepEqual(u.items.map((i: any) => i.label), ["Make show poster", "Post on social media", "Send email to email list", "Call the radio station"]);
  assert.ok(u.items.every((i: any) => Object.keys(i).sort().join() === "id,label"), "no assignees or done state");
  assert.deepEqual((await lists(other))[0].items.map((i: any) => i.label), ["Make show poster", "Post on social media", "Send email to email list"], "other shows untouched");

  await cmd("checklistTemplates.update", { id: promo, patch: { items: [] } }, admin);
  assert.equal((await lists(id))[1].items.length, 4, "editing a template never changes lists on shows");
  await assert.rejects(cmd("shows.updateTemplateFromChecklist", { id, listId: (await cmd("shows.addChecklist", { id, name: "Blank" }, admin)).listId }, admin), /isn't from a template/);
});

test("setChecklists (AI): new item shape, templateId kept, ticks stamped once", async () => {
  const { admin } = await world();
  const id = await show();
  await cmd("shows.setChecklists", { id, checklists: [{ name: "Promo", templateId: "t1", items: [{ label: "Poster", done: true }, { label: "Email" }] }] }, admin);
  const first = (await lists(id))[0];
  assert.equal(first.templateId, "t1");
  assert.equal(first.items[0].doneBy, "u-admin");
  await cmd("shows.setChecklists", { id, checklists: [{ ...first, items: first.items.map(({ doneAt: _a, doneBy: _b, ...i }: any) => i) }] }, { ...admin, uid: "u-later" });
  const again = (await lists(id))[0];
  assert.equal(again.items[0].doneBy, "u-admin", "an item already done keeps who ticked it");
  assert.equal(again.items[0].doneAt, first.items[0].doneAt);
  await assert.rejects(cmd("shows.setChecklists", { id, checklists: [{ name: "x", items: [{ label: "y", due: "2027-01-01" }] }] }, admin), /Unrecognized key/);
});

