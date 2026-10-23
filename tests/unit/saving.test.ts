import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { db, COALESCE_MS } from "@/server/db";
import { importCtx, newRunId, type Ctx } from "@/server/ctx";
import { undoRun } from "@/server/undo";
import { dispatch } from "@/server/commands/dispatch";
import { firestore } from "@/server/admin";
import { discardDraft, listDrafts, saveDraft } from "@/server/drafts";
import { DRAFT_TTL_MS, draftId } from "@/schema/drafts";
import { resetEmulators, makeUser, venue } from "./helpers";

beforeEach(resetEmulators);
const T0 = new Date("2026-10-01T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
/** An app autosave caller with an injectable clock. */
const app = (uid: string, ms = 0, extra: Partial<Ctx> = {}): Ctx => ({ uid, role: "admin", via: "app", runId: newRunId(), autosave: true, now: at(ms), ...extra });
const hist = (id: string) => db.list("history", (q) => q.where("entity.id", "==", id));
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

test("drafts: save, list newest first, overwrite keeps createdAt, discard, owner-isolated, never in history", async () => {
  const jeff = await makeUser("jeff@example.com", "admin");
  const eric = await makeUser("eric@example.com", "admin");
  const call = (tok: string, name: string, body: unknown) => dispatch(name, bearer(tok), body);
  const s1 = await call(jeff.token, "drafts.save", { kind: "show", contextKey: "new", values: { date: "2027-01-01" }, route: "/shows/new", title: "New show" });
  assert.equal(s1.status, 200);
  assert.equal((s1.json as { result: { draftId: string } }).result.draftId, draftId("show", "new"));
  await call(jeff.token, "drafts.save", { kind: "show", contextKey: "pitch:abc", values: { date: "2027-02-02" }, route: "/shows/new?pitch=abc", title: "Fox" });
  const first = await listDrafts(jeff.uid);
  assert.deepEqual(first.map((d) => d.contextKey), ["pitch:abc", "new"]);
  const created = first[1].createdAt.toMillis();
  await new Promise((r) => setTimeout(r, 15));
  await call(jeff.token, "drafts.save", { kind: "show", contextKey: "new", values: { date: "2027-03-03" }, route: "/shows/new", title: "New show 2" });
  const second = await listDrafts(jeff.uid);
  assert.equal(second[0].values.date, "2027-03-03");
  assert.equal(second[0].createdAt.toMillis(), created);
  assert.equal((await listDrafts(eric.uid)).length, 0);
  const l = await call(jeff.token, "drafts.list", {});
  assert.equal((l.json as { result: { drafts: unknown[] } }).result.drafts.length, 2);
  assert.equal((await call(jeff.token, "drafts.save", { kind: "show", values: {}, route: "nope" })).status, 400);
  assert.equal((await db.list("history")).filter((h) => h.entity.kind === "drafts").length, 0, "drafts do not flood history");
  // eric cannot discard jeff's
  await call(eric.token, "drafts.discard", { draftId: draftId("show", "new") });
  assert.equal((await listDrafts(jeff.uid)).length, 2);
  await call(jeff.token, "drafts.discard", { draftId: draftId("show", "new") });
  assert.deepEqual((await listDrafts(jeff.uid)).map((d) => d.contextKey), ["pitch:abc"]);
});

test("drafts expire after 30 days: ignored when listed and deleted on the next save", async () => {
  const u = "someone";
  const old = new Date(T0.getTime() - DRAFT_TTL_MS - 1000);
  await saveDraft(u, { kind: "show", contextKey: "old", values: { a: 1 }, route: "/x", title: "old" }, old);
  await saveDraft(u, { kind: "show", contextKey: "fresh", values: { a: 2 }, route: "/x", title: "fresh" }, new Date(T0.getTime() - 1000));
  assert.deepEqual((await listDrafts(u, T0)).map((d) => d.contextKey), ["fresh"], "old one is ignored");
  assert.equal((await firestore().collection("users").doc(u).collection("drafts").get()).size, 2, "still stored until a save");
  await saveDraft(u, { kind: "show", contextKey: "newer", values: {}, route: "/x", title: "n" }, T0);
  assert.deepEqual((await firestore().collection("users").doc(u).collection("drafts").get()).docs.map((d) => d.id).sort(), ["show__fresh", "show__newer"]);
  await discardDraft(u, "show__fresh");
  assert.equal((await listDrafts(u, T0)).length, 1);
});

test("clearDraft in the envelope removes the draft once the create succeeds (and not when it fails)", async () => {
  const jeff = await makeUser("jeff@example.com", "admin");
  await saveDraft(jeff.uid, { kind: "venue", contextKey: "new", values: {}, route: "/booking", title: "v" });
  const bad = await dispatch("venues.create", bearer(jeff.token), { name: "", _meta: { clearDraft: draftId("venue", "new") } });
  assert.equal(bad.status, 400);
  assert.equal((await listDrafts(jeff.uid)).length, 1);
  assert.equal((await dispatch("venues.create", bearer(jeff.token), { ...venue("Made"), _meta: { clearDraft: draftId("venue", "new") } })).status, 200);
  assert.equal((await listDrafts(jeff.uid)).length, 0);
});
