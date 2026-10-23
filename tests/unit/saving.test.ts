import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { db, COALESCE_MS } from "@/server/db";
import { importCtx, newRunId, type Ctx } from "@/server/ctx";
import { undoRun } from "@/server/undo";
import { dispatch } from "@/server/commands/dispatch";
import { firestore } from "@/server/admin";
import { clearDraft, listDrafts, saveDraft } from "@/server/drafts";
import { DRAFT_TTL_MS, DRAFT_PATH, draftDocId, draftPath, pathOfDocId, isEditPath } from "@/schema/drafts";
import { resetEmulators, makeUser, venue } from "./helpers";

beforeEach(resetEmulators);
const T0 = new Date("2026-10-01T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
/** An app autosave caller with an injectable clock. */
const app = (uid: string, ms = 0, extra: Partial<Ctx> = {}): Ctx => ({ uid, role: "admin", via: "app", runId: newRunId(), autosave: true, now: at(ms), ...extra });
const hist = (id: string) => db.listGroup("history", (q) => q.where("entity.id", "==", id));
const mk = async (name = "Hi-Dive") => (await db.create(importCtx("setup"), "venues", venue(name, "Denver", { notes: "orig", capacity: 100 }))).id;
const bearer = (t: string) => `Bearer ${t}`;

test("rev: 1 on create, +1 per write, none-yet treated as 0, history carries docRev", async () => {
  const id = await mk();
  assert.equal((await db.get("venues", id))!.rev, 1);
  await db.update(importCtx("a"), "venues", id, { notes: "b" });
  await db.update(importCtx("a"), "venues", id, { notes: "c" });
  assert.equal((await db.get("venues", id))!.rev, 3);
  assert.deepEqual((await hist(id)).map((h) => h.docRev).sort(), [1, 2, 3]);
  await db.update(importCtx("a"), "venues", id, { notes: "c" }); // no change = no write
  assert.equal((await db.get("venues", id))!.rev, 3);
  // a document from before rev existed counts as 0
  await firestore().collection("venues").doc(id).update({ rev: (await import("firebase-admin/firestore")).FieldValue.delete() });
  await db.update(importCtx("a"), "venues", id, { notes: "d" });
  assert.equal((await db.get("venues", id))!.rev, 1);
});

test("coalescing: autosave patches within 2 minutes fold into one history entry, and not after", async () => {
  const id = await mk();
  const c1 = app("jeff", 0);
  await db.update(c1, "venues", id, { notes: "h" });
  const c2 = app("jeff", 30_000);
  await db.update(c2, "venues", id, { notes: "he" });
  const c3 = app("jeff", 90_000);
  await db.update(c3, "venues", id, { notes: "hello" });
  let h = (await hist(id)).filter((x) => x.op === "update");
  assert.equal(h.length, 1, "three keystroke saves, one entry");
  assert.deepEqual(h[0].diff.notes, { before: "orig", after: "hello" });
  assert.equal(h[0].docRev, 4);
  assert.equal(c2.runId, c1.runId, "folded saves report the entry's runId");
  assert.equal(c3.runId, c1.runId);
  assert.equal((await db.get("venues", id))!.runId, c1.runId);
  assert.equal((await db.get("venues", id))!.rev, 4, "rev still +1 per write");
  // 2 minutes after the LAST fold: a new decision
  const c4 = app("jeff", 90_000 + COALESCE_MS + 1);
  await db.update(c4, "venues", id, { notes: "later" });
  h = (await hist(id)).filter((x) => x.op === "update");
  assert.equal(h.length, 2);
  assert.notEqual(c4.runId, c1.runId);
  // a different field does not fold; a different person does not fold; a non-autosave write does not fold
  const c5 = app("jeff", 90_000 + COALESCE_MS + 10, {});
  await db.update(c5, "venues", id, { capacity: 200 });
  assert.equal((await hist(id)).filter((x) => x.op === "update").length, 3);
  await db.update(app("eric", 90_000 + COALESCE_MS + 20), "venues", id, { capacity: 300 });
  assert.equal((await hist(id)).filter((x) => x.op === "update").length, 4);
  await db.update({ ...app("eric", 90_000 + COALESCE_MS + 30), autosave: false }, "venues", id, { capacity: 301 });
  assert.equal((await hist(id)).filter((x) => x.op === "update").length, 5);
  // typing it back to where the burst started drops the field from the entry
  const id2 = await mk("Other Room");
  await db.update(app("jeff", 0), "venues", id2, { notes: "x" });
  await db.update(app("jeff", 1000), "venues", id2, { notes: "orig" });
  assert.deepEqual((await hist(id2)).find((x) => x.op === "update")!.diff, {});
});

test("undo of a coalesced entry puts the field back to the value before the whole burst", async () => {
  const id = await mk();
  const c = app("jeff", 0);
  await db.update(c, "venues", id, { notes: "h" });
  await db.update(app("jeff", 1000, { runId: newRunId() }), "venues", id, { notes: "hello" });
  const rep = await undoRun({ ...app("jeff", 5000), autosave: false }, c.runId);
  assert.equal(rep.reverted.length, 1);
  assert.equal((await db.get("venues", id))!.notes, "orig");
});

test("undo skips a field changed again since, and leaves the newer value", async () => {
  const id = await mk();
  const c = app("jeff", 0);
  await db.update(c, "venues", id, { notes: "mine", capacity: 150 });
  await db.update(app("eric", 5000), "venues", id, { notes: "eric's" });
  const rep = await undoRun({ ...app("jeff", 9000), autosave: false }, c.runId);
  const v = (await db.get("venues", id))!;
  assert.equal(v.notes, "eric's", "not overwritten");
  assert.equal(v.capacity, 100, "the other field still reverts");
  assert.deepEqual(rep.reverted[0].skippedFields, ["notes"]);
  // nothing left to revert at all -> reported as changedSince
  const c2 = app("jeff", 20_000_000);
  await db.update(c2, "venues", id, { notes: "again" });
  await db.update(app("eric", 20_001_000), "venues", id, { notes: "eric again" });
  const rep2 = await undoRun({ ...app("jeff", 20_002_000), autosave: false }, c2.runId);
  assert.equal(rep2.reverted.length, 0);
  assert.equal(rep2.changedSince.length, 1);
  assert.equal((await db.get("venues", id))!.notes, "eric again");
});

test("baseRev: a field changed by someone else since is a conflict naming who and the value; other fields and own changes are fine", async () => {
  const id = await mk();
  const eric = await makeUser("eric@example.com", "admin", { name: "Eric" });
  const jeff = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  const base = (await db.get("venues", id))!.rev as number;
  await db.update({ ...importCtx(eric.uid), via: "app" }, "venues", id, { notes: "from Eric" });
  const send = (patch: Record<string, unknown>, baseRev: number) =>
    dispatch("venues.update", bearer(jeff.token), { id, patch, _meta: { baseRev, autosave: true } });
  const bad = await send({ notes: "from Jeff" }, base);
  assert.equal(bad.status, 409);
  const err = (bad.json as { error: { code: string; message: string; data: { conflicts: { by: string; field: string; value: unknown }[]; currentRev: number } } }).error;
  assert.equal(err.code, "conflict");
  assert.equal(err.message, 'Eric changed notes to "from Eric"');
  assert.equal(err.data.conflicts[0].by, "Eric");
  assert.equal((await db.get("venues", id))!.notes, "from Eric", "nothing overwritten");
  // a different field is not in conflict
  assert.equal((await send({ capacity: 90 }, base)).status, 200);
  // with the current rev it goes through
  assert.equal((await send({ notes: "from Jeff" }, err.data.currentRev)).status, 200);
  assert.equal((await db.get("venues", id))!.notes, "from Jeff");
  // the response tells the client the new rev
  const ok = await send({ notes: "from Jeff 2" }, (await db.get("venues", id))!.rev as number);
  assert.equal((ok.json as { revs: Record<string, number> }).revs[id], (await db.get("venues", id))!.rev);
});

test("clientMutationId: a repeat returns the first result and does not write twice; failures can be retried; ids are per command and person", async () => {
  const jeff = await makeUser("jeff@example.com", "admin");
  const eric = await makeUser("eric@example.com", "admin");
  const body = { ...venue("Double Tap"), _meta: { clientMutationId: "abcdefgh-1234" } };
  const a = await dispatch("venues.create", bearer(jeff.token), body);
  const b = await dispatch("venues.create", bearer(jeff.token), body);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const A = a.json as { result: { id: string }; runId: string }, B = b.json as typeof A & { repeated?: boolean };
  assert.equal(B.result.id, A.result.id);
  assert.equal(B.runId, A.runId);
  assert.equal(B.repeated, true);
  assert.equal((await db.list("venues")).filter((v) => v.name === "Double Tap").length, 1);
  const m = (await firestore().collection("mutations").doc("abcdefgh-1234").get()).data()!;
  assert.equal(m.status, "done");
  assert.equal((m.expiresAt as Timestamp).toMillis() - (m.createdAt as Timestamp).toMillis(), 7 * 86_400_000);
  // concurrent double tap: one write
  const body2 = { ...venue("Race"), _meta: { clientMutationId: "race-race-1" } };
  const [r1, r2] = await Promise.all([dispatch("venues.create", bearer(jeff.token), body2), dispatch("venues.create", bearer(jeff.token), body2)]);
  assert.equal(r1.status, 200); assert.equal(r2.status, 200);
  assert.equal((await db.list("venues")).filter((v) => v.name === "Race").length, 1);
  // someone else cannot reuse the id
  assert.equal((await dispatch("venues.create", bearer(eric.token), body)).status, 409);
  // a failed call releases the id so the retry runs
  const bad = await dispatch("venues.create", bearer(jeff.token), { name: "", _meta: { clientMutationId: "retry-retry-1" } });
  assert.equal(bad.status, 400);
  assert.equal((await dispatch("venues.create", bearer(jeff.token), { ...venue("Retried"), _meta: { clientMutationId: "retry-retry-1" } })).status, 200);
  // bad meta
  assert.equal((await dispatch("venues.create", bearer(jeff.token), { ...venue("X"), _meta: { nope: 1 } })).status, 400);
});

test("autosave through dispatch coalesces and returns the folded runId for Undo", async () => {
  const id = await mk();
  const jeff = await makeUser("jeff@example.com", "admin");
  const send = async (notes: string) => {
    const r = await dispatch("venues.update", bearer(jeff.token), { id, patch: { notes }, _meta: { autosave: true, clientMutationId: `m-${notes}-00000` } });
    assert.equal(r.status, 200);
    return (r.json as { runId: string }).runId;
  };
  const r1 = await send("a"), r2 = await send("ab");
  assert.equal(r1, r2);
  const u = await dispatch("history.undoRun", bearer(jeff.token), { runId: r2 });
  assert.equal(u.status, 403 === u.status ? 403 : 200); // admins may undo
  assert.equal((await db.get("venues", id))!.notes, "orig");
});

const draftDoc = async (uid: string, path: string) => (await firestore().collection("unsubmittedDrafts").doc(draftDocId(uid, path)).get()).data();

test("drafts: keyed by uid + path, last write wins, list newest first and own only, never in history", async () => {
  const jeff = await makeUser("jeff@example.com", "admin");
  const eric = await makeUser("eric@example.com", "admin");
  const call = (tok: string, name: string, body: unknown) => dispatch(name, bearer(tok), body);
  const s1 = await call(jeff.token, "drafts.save", { path: "expenses", values: { what: "strings" }, route: "/money/expense", title: "New expense" });
  assert.equal(s1.status, 200);
  assert.equal((s1.json as { result: { path: string } }).result.path, "expenses");
  assert.equal(draftDocId(jeff.uid, "expenses"), `${jeff.uid}__expenses`);
  await call(jeff.token, "drafts.save", { path: "venues/v1/contacts", values: { name: "Pat" }, route: "/booking/venues/v1", title: "New contact" });
  assert.equal((await draftDoc(jeff.uid, "venues/v1/contacts"))!.uid, jeff.uid);
  assert.ok((await firestore().collection("unsubmittedDrafts").doc(`${jeff.uid}__venues~v1~contacts`).get()).exists, "/ is stored as ~");
  assert.equal(pathOfDocId(`${jeff.uid}__venues~v1~contacts`), "venues/v1/contacts");
  assert.deepEqual((await listDrafts(jeff.uid)).map((d) => d.path), ["venues/v1/contacts", "expenses"]);
  // last in wins: no merge, no timestamp comparison
  await call(jeff.token, "drafts.save", { path: "expenses", values: { amount: "5" }, route: "/money/expense", title: "second" });
  await call(jeff.token, "drafts.save", { path: "expenses", values: { what: "picks" }, route: "/money/expense", title: "third" });
  const now = await draftDoc(jeff.uid, "expenses");
  assert.deepEqual(now!.values, { what: "picks" });
  assert.equal(now!.title, "third");
  assert.equal((await listDrafts(eric.uid)).length, 0);
  const l = await call(jeff.token, "drafts.list", {});
  assert.deepEqual((l.json as { result: { drafts: { path: string }[] } }).result.drafts.map((d) => d.path).sort(), ["expenses", "venues/v1/contacts"]);
  assert.equal((await db.listGroup("history")).filter((h) => h.entity.kind === "unsubmittedDrafts").length, 0, "drafts do not flood history");
  // edits to an existing record: doc path, with the rev they were made against
  await call(jeff.token, "drafts.save", { path: draftPath.edit("shows", "s1"), values: { bandNotes: "x" }, route: "/shows/s1", title: "Fox", rev: 3 });
  assert.equal((await draftDoc(jeff.uid, "shows/s1"))!.rev, 3);
  // eric cannot clear jeff's: clear is always scoped to the caller's own uid
  await call(eric.token, "drafts.clear", { path: "expenses" });
  assert.equal((await listDrafts(jeff.uid)).length, 3);
  assert.equal((await call(jeff.token, "drafts.clear", { path: "expenses" })).status, 200);
  assert.deepEqual((await listDrafts(jeff.uid)).map((d) => d.path).sort(), ["shows/s1", "venues/v1/contacts"]);
});

test("drafts: path shape and size are validated", async () => {
  const jeff = await makeUser("jeff@example.com", "admin");
  const save = (b: object) => dispatch("drafts.save", bearer(jeff.token), { values: {}, route: "/x", ...b });
  for (const ok of ["expenses", "shows/abc-1_2", "venues/v1/contacts", "pitches/p1/comments"]) assert.ok(DRAFT_PATH.test(ok), ok);
  for (const bad of ["", "/expenses", "expenses/", "a/b/c/d", "shows/a b", "shows/a~b", "shows//x", "../x", "shows/x/1bad", "1shows"]) {
    assert.equal(DRAFT_PATH.test(bad), false, bad);
    assert.equal((await save({ path: bad })).status, 400, bad);
  }
  assert.equal((await dispatch("drafts.clear", bearer(jeff.token), { path: "a/b/c/d" })).status, 400);
  assert.equal((await save({ path: "expenses", route: "nope" })).status, 400);
  assert.equal((await save({ path: "expenses", kind: "show" })).status, 400, "strict");
  assert.equal((await save({ path: "songs", values: { x: "y".repeat(100_001) } })).status, 400, "over ~100KB");
  assert.equal((await save({ path: "songs", values: { x: "y".repeat(90_000) } })).status, 200);
  assert.ok(isEditPath("shows/x") && !isEditPath("shows") && !isEditPath("shows/x/gear"));
  assert.equal((await dispatch("drafts.save", "Bearer nope", { path: "songs", values: {}, route: "/x" })).status, 401);
});

test("drafts expire after 30 days: expiresAt is set for the TTL policy, and expired ones are not listed", async () => {
  const u = "someone";
  const old = new Date(T0.getTime() - DRAFT_TTL_MS - 1000);
  await saveDraft(u, { path: "songs", values: { a: 1 }, route: "/x", title: "old" }, old);
  await saveDraft(u, { path: "venues", values: { a: 2 }, route: "/x", title: "fresh" }, new Date(T0.getTime() - 1000));
  assert.equal(((await draftDoc(u, "venues"))!.expiresAt as Timestamp).toMillis(), T0.getTime() - 1000 + DRAFT_TTL_MS, "expiresAt = updatedAt + 30 days");
  assert.deepEqual((await listDrafts(u, T0)).map((d) => d.path), ["venues"], "old one is ignored");
  await saveDraft(u, { path: "songs", values: { a: 3 }, route: "/x", title: "again" }, T0); // a new write pushes expiry out
  assert.equal((await listDrafts(u, T0)).length, 2);
  await clearDraft(u, "venues");
  assert.equal((await listDrafts(u, T0)).length, 1);
});

test("clearDraft in the envelope removes the draft once the create succeeds, and only then", async () => {
  const jeff = await makeUser("jeff@example.com", "admin");
  const eric = await makeUser("eric@example.com", "admin");
  await saveDraft(jeff.uid, { path: "venues", values: {}, route: "/booking", title: "v" });
  await saveDraft(eric.uid, { path: "venues", values: {}, route: "/booking", title: "e" });
  const bad = await dispatch("venues.create", bearer(jeff.token), { name: "", _meta: { clearDraft: "venues" } });
  assert.equal(bad.status, 400);
  assert.equal((await listDrafts(jeff.uid)).length, 1, "a failed create keeps the draft");
  assert.equal((await dispatch("venues.create", bearer(jeff.token), { ...venue("Made"), _meta: { clearDraft: "venues/../x" } })).status, 400, "bad path refused");
  assert.equal((await dispatch("venues.create", bearer(jeff.token), { ...venue("Made"), _meta: { clearDraft: "venues" } })).status, 200);
  assert.equal((await listDrafts(jeff.uid)).length, 0);
  assert.equal((await listDrafts(eric.uid)).length, 1, "someone else's draft at the same path is untouched");
});
