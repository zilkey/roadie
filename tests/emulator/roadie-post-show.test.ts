import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { stillMissing, ASK_CROWD, ASK_STARS } from "@/server/assistant/postShow";
import { createPending, ensureThread, findOpenPending, loadHistory, newMessageId, newThreadId, saveTurn } from "@/server/assistant/threads";
import { firestore } from "@/server/admin";
import { resetEmulators } from "./helpers";

beforeEach(resetEmulators);

test("stillMissing: asks for the crowd and the stars the show lacks, once per conversation, never over another question", async () => {
  // A deal shares its show's id; the show's date decides whether it has happened.
  const deal = async (date: string, d: Record<string, unknown> = {}) => {
    const show = firestore().collection("shows").doc(); // only the date and the deal's crowd and rating are read
    await show.set({ date, status: "confirmed" });
    await firestore().collection("showDeals").doc(show.id).set({ contactIds: [], deal: "guarantee", ...d });
    return show;
  };
  const bare = await deal("2026-01-10");
  const cards = [{ command: "income.add", input: { category: "tips", amount: 100, showId: bare.id, receivedAt: "2026-01-10" } }];
  assert.equal(await stillMissing([{ command: "income.add", input: { category: "guarantee", amount: 100, showId: bare.id } }], "Tap Yes.", []), undefined); // still owed: nobody is counting cash
  const future = await deal("2999-01-01");
  assert.equal(await stillMissing([{ command: "income.add", input: { category: "tips", amount: 100, showId: future.id, receivedAt: "2026-01-10" } }], "Tap Yes.", []), undefined);
  assert.equal(await stillMissing(cards, "Tap Yes.", []), `${ASK_CROWD} ${ASK_STARS}`);
  assert.equal(await stillMissing(cards, "Which show?", []), undefined);
  assert.equal(await stillMissing(cards, "Tap Yes.", [{ role: "assistant", text: `Tap Yes. ${ASK_CROWD} ${ASK_STARS}` }]), undefined);
  const rated = await deal("2026-01-10", { crowd: 40, rating: { venue: 4 } });
  assert.equal(await stillMissing([{ command: "income.add", input: { category: "tips", amount: 100, showId: rated.id, receivedAt: "2026-01-10" } }], "Tap Yes.", []), undefined);
  const crowdOnly = await deal("2026-01-10", { crowd: 40 });
  assert.equal(await stillMissing([{ command: "payouts.add", input: { amount: 100, showId: crowdOnly.id, paidAt: "2026-01-10" } }], "Tap Yes.", []), ASK_STARS);
});

test("findOpenPending: the same ask in a later message finds the open card; the same input twice in one message is two cards", async () => {
  const threadId = newThreadId();
  await ensureThread({ uid: "u-post-show", threadId, pageContext: { route: "calendar" }, at: new Date() });
  const input = { amount: 2500, category: "merch", method: "venmo" };
  const m1 = newMessageId();
  const p = await createPending(threadId, { command: "income.add", input, summary: "Merch paid us $25", messageId: m1 });
  assert.equal(await findOpenPending(threadId, "income.add", input, new Date(), m1), null);
  assert.equal((await findOpenPending(threadId, "income.add", input, new Date(), newMessageId()))?.id, p.id);
  assert.equal((await findOpenPending(threadId, "income.add", input))?.id, p.id);
});

test("loadHistory: a reply's cards and writes go with its words, with how each card ended", async () => {
  const uid = "u-post-show-history", threadId = newThreadId();
  await ensureThread({ uid, threadId, pageContext: { route: "calendar" }, at: new Date() });
  await saveTurn({ threadId, pageContext: { route: "calendar" }, userText: "88 in tips, 30 people", replyText: "Tap Yes to go ahead, or Cancel.", userAt: new Date(), actions: [
    { kind: "confirm", label: "Tips paid us $88.00 (tips, Cash, Band)", pendingId: "p1", command: "income.add", status: "done" },
    { kind: "confirm", label: "Merch paid us $20.00 (merch, Venmo, Band)", pendingId: "p2", command: "income.add", status: "pending" },
    { kind: "confirm", label: "Merch paid us $5.00 (merch, Cash, Band)", pendingId: "p3", command: "income.add", status: "canceled" },
    { kind: "readback", label: "Saved how it went for The Red Barn", runId: "r1" },
  ] });
  const reply = (await loadHistory(uid, threadId))!.at(-1)!.text;
  assert.match(reply, /^Tap Yes to go ahead, or Cancel\. \[Card: Tips paid us \$88\.00 \(tips, Cash, Band\): they tapped Yes, saved\]/);
  assert.match(reply, /\[Card: Merch paid us \$20\.00 \(merch, Venmo, Band\): waiting for their Yes, not saved yet\]/);
  assert.match(reply, /\$5\.00 \(merch, Cash, Band\): they tapped Cancel, not saved\]/);
  assert.match(reply, /\[Saved: Saved how it went for The Red Barn\]$/);
});

test("findSavedMoney: a line saved through a card is found again whatever its date, project or from; a different amount, or notes, is new", async () => {
  const { findSavedMoney, setPending } = await import("@/server/assistant/threads");
  const threadId = newThreadId();
  await ensureThread({ uid: "u-post-show-saved", threadId, pageContext: { route: "calendar" }, at: new Date() });
  const line = { amount: 8800, category: "tips", method: "cash", showId: "s1", receivedAt: "2026-11-10", from: "Tips", date: "2026-11-10" };
  const p = await createPending(threadId, { command: "income.add", input: line, summary: "Tips paid us $88", messageId: newMessageId() });
  assert.equal(await findSavedMoney(threadId, "income.add", line), null); // still waiting on its card
  await setPending(threadId, p.id, { status: "done" });
  assert.equal((await findSavedMoney(threadId, "income.add", { amount: 8800, category: "tips", method: "cash", showId: "s1", receivedAt: "2026-11-11", from: "The Red Barn", projectId: "p1" }))?.id, p.id);
  assert.equal(await findSavedMoney(threadId, "income.add", { ...line, amount: 2000 }), null);
  assert.equal(await findSavedMoney(threadId, "income.add", { ...line, notes: "a second $88, from the late set" }), null);
  assert.equal(await findSavedMoney(threadId, "payouts.add", line), null);
});
