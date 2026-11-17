import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleStop } from "@/server/assistant/chat";
import { answerPending, undoRunOf, type Who } from "@/server/assistant/confirm";
import { ensureThread, newMessageId, newThreadId, threadFor } from "@/server/assistant/threads";
import { resetEmulators, makeUser, makeArtist } from "./helpers";

// Tenancy plan D3: Roadie's threads carry their artist; confirm, stop and undo refuse a request for another artist.

beforeEach(resetEmulators);

async function setup() {
  await makeArtist("Alpha", "alpha", "A");
  await makeArtist("Beta", "beta", "B");
  const p = await makeUser("p@x.example", "admin", { name: "Pat", artists: [{ artistId: "A", role: "admin" }, { artistId: "B", role: "admin" }] });
  const threadId = newThreadId();
  await ensureThread({ uid: p.uid, artistId: "A", threadId, pageContext: { route: "calendar" }, at: new Date() });
  const who = (artistId: string): Who => ({ uid: p.uid, role: "admin", artistId, name: "Pat" });
  return { p, threadId, who };
}

test("confirm and undo refuse a thread from another artist", async () => {
  const { threadId, who } = await setup();
  await assert.rejects(answerPending(who("B"), { threadId, pendingId: "nope", decision: "yes" }), { code: "not_found", message: "No such conversation" });
  await assert.rejects(undoRunOf(who("B"), { threadId, runId: "r1" }), { code: "not_found", message: "No such conversation" });
  // In its own artist the thread is found (the pending card itself doesn't exist).
  await assert.rejects(answerPending(who("A"), { threadId, pendingId: "nope", decision: "yes" }), (e: { message?: string }) => e.message !== "No such conversation");
});

test("stop refuses a thread from another artist", async () => {
  const { p, threadId } = await setup();
  const other = await handleStop(`Bearer ${p.token}`, { threadId, replyId: newMessageId() }, "B");
  assert.equal(other.status, 404);
  const own = await handleStop(`Bearer ${p.token}`, { threadId, replyId: newMessageId() }, "A");
  assert.equal(own.status, 200);
});

test("a chat that names another artist's thread starts a fresh one", async () => {
  const { p, threadId } = await setup();
  assert.notEqual((await threadFor(p.uid, threadId, "B")).threadId, threadId);
  assert.equal((await threadFor(p.uid, threadId, "A")).threadId, threadId);
});
