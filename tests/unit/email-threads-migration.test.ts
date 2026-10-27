/** Acceptance tests for migrate:email-threads: threads named by pitch timelines get a doc on the place, once. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { firestore } from "@/server/admin";
import { emailThreadId } from "@/schema";
import { migrateEmailThreads } from "../../scripts/migrate-email-threads";
import { resetEmulators, makeUser } from "./helpers";

beforeEach(resetEmulators);

test("migrate:email-threads adds a doc per thread on the place; timeline fallback without Gmail; edition goes to its festival; safe to run again", async () => {
  const fs = firestore();
  const ctx = importCtx("old", "old-run", "a");
  const u = await makeUser("ingrid@example.com", "admin", { name: "Ingrid" });
  const pitch = (id: string, target: Record<string, string>) => db.create(ctx, "pitches", { target, status: "pitched", artistId: "a", personnel: [], showIds: [], assigneeId: u.uid }, { id });
  await pitch("p1", { kind: "venue", id: "v1", name: "Lost Lake" });
  await pitch("p2", { kind: "edition", id: "e1", name: "Westword 2027" });
  await pitch("p3", { kind: "venue", id: "v2", name: "Fox" });
  await db.create(ctx, "editions", { festivalId: "f1", festivalName: "Westword", year: 2027, label: "2027", venueIds: [] }, { id: "e1" });
  const at = (iso: string) => ({ createdAt: new Date(iso), updatedAt: new Date(iso) });
  const act = (p: string, a: Record<string, unknown>, when: string) => fs.collection(`pitches/${p}/activity`).add({ deletedAt: null, ...at(when), ...a });
  await act("p1", { type: "emailSent", text: "Hi Haylee", gmail: { messageId: "m1", threadId: "t1", to: "haylee@lostlake.example", subject: "Support slot", account: "jeff@example.com" } }, "2026-10-01T10:00:00Z");
  await act("p1", { type: "emailReply", text: "From haylee@lostlake.example\n\nSure", gmail: { messageId: "m2", threadId: "t1", to: "jeff@example.com", subject: "Re: Support slot", account: "jeff@example.com" } }, "2026-10-02T10:00:00Z");
  await act("p2", { type: "emailSent", text: "Hello", gmail: { messageId: "m3", threadId: "t2", to: "a@fest.example", subject: "Application" } }, "2026-10-03T10:00:00Z"); // no account: the assignee's
  await act("p3", { type: "note", text: "no mail" }, "2026-10-03T10:00:00Z");
  await act("p3", { type: "emailSent", text: "x", gmail: { messageId: "m4", threadId: "t3", to: "z@x.example", subject: "Nobody" } }, "2026-10-03T10:00:00Z");
  await db.update(ctx, "pitches", "p3", { assigneeId: null });

  const dry = await migrateEmailThreads(fs, { dryRun: true, readThread: async () => null });
  assert.equal(dry.created.length, 2);
  assert.equal((await fs.collection("emailThreads").get()).size, 0, "a dry run writes nothing");

  const r = await migrateEmailThreads(fs, { readThread: async () => null });
  assert.deepEqual(r.created.map((c) => c.source), ["timeline", "timeline"]);
  assert.deepEqual(r.skipped.map((s) => s.threadId), ["t3"]);
  const t1 = (await db.get("emailThreads", emailThreadId("a", "t1")))!;
  assert.deepEqual(t1.target, { kind: "venue", id: "v1", name: "Lost Lake" });
  assert.equal(t1.pitchId, "p1");
  assert.equal(t1.account, "jeff@example.com");
  assert.equal(t1.subject, "Support slot");
  assert.equal(t1.messageCount, 2);
  assert.equal(t1.lastDirection, "received");
  assert.equal(t1.lastDate, "2026-10-02T10:00:00.000Z");
  assert.deepEqual(t1.participants, ["haylee@lostlake.example"]);
  const t2 = (await db.get("emailThreads", emailThreadId("a", "t2")))!;
  assert.deepEqual(t2.target, { kind: "festival", id: "f1", name: "Westword" });
  assert.equal(t2.account, "ingrid@example.com");

  assert.equal((await migrateEmailThreads(fs, { readThread: async () => null })).created.length, 0, "safe to run again");
  await db.softDelete(ctx, "emailThreads", emailThreadId("a", "t1"));
  assert.equal((await migrateEmailThreads(fs, { readThread: async () => null })).created.length, 0, "an unlinked thread stays unlinked");

  // With Gmail answering, the summary comes from the thread
  await db.softDelete(ctx, "emailThreads", emailThreadId("a", "t2"));
  await fs.collection("emailThreads").doc(emailThreadId("a", "t2")).delete();
  const g = await migrateEmailThreads(fs, {
    readThread: async (id) => ({ id, subject: "From Gmail", lastDate: "2026-10-05T00:00:00Z", messages: [{ id: "g1", threadId: id, account: "ingrid@example.com", direction: "received", from: "a@fest.example", fromName: "", to: ["ingrid@example.com"], cc: [], subject: "From Gmail", body: "Hi\n> q", date: "2026-10-05T00:00:00Z" }] }),
  });
  assert.deepEqual(g.created.map((c) => c.source), ["gmail"]);
  assert.equal((await db.get("emailThreads", emailThreadId("a", "t2")))!.snippet, "Hi");
});
