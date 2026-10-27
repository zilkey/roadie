/** Threads belong to the place: summaries, sync, link, seen, the pitch wrappers, splitQuoted and the fake's search syntax. */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { matches } from "../../fakes/fake-gmail/query";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { gmailClient } from "@/server/integrations";
import { splitQuoted, snippetOf, agoText } from "@/lib/email-text";
import { isExcluded, needsConfirm } from "@/server/assistant/policy";
import { hasNewReply, emailThreadId } from "@/schema";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let gmailUrl: string;
let ctx: Ctx;
let uid: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  gmailUrl = s.running["fake-gmail"].url;
  process.env.GMAIL_BASE_URL = gmailUrl;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

beforeEach(async () => {
  await resetEmulators();
  await fetch(`${gmailUrl}/__reset`, { method: "POST" });
  uid = (await makeUser("jeff@example.com", "admin", { name: "Jeff Smith" })).uid;
  ctx = { uid, role: "admin", via: "app", runId: newRunId() };
  await db.create(ctx, "artists", { slug: "ingrid-avison-band", name: "Ingrid Avison Band", driveFolderId: "", links: {}, configurations: [] }, { id: TEST_ARTIST });
});

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};
const receive = async (body: Record<string, unknown>) => (await (await fetch(`${gmailUrl}/messages/receive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()) as Record<string, any>;
const thread = async (threadId: string) => (await db.get("emailThreads", emailThreadId(TEST_ARTIST, threadId)))!;

async function lostLake() {
  const v = await cmd("venues.create", venue("Lost Lake"));
  const { id } = await cmd("pitches.flag", { kind: "venue", id: v.id });
  return { venueId: v.id as string, pitchId: id as string };
}

test("send creates the thread on the venue; a reply arrives on sync once; the wrapper keeps its shape", async () => {
  const { venueId, pitchId } = await lostLake();
  const sent = await cmd("pitches.sendEmail", { id: pitchId, to: ["haylee@lostlake.example"], subject: "Support slot", body: "Hi Haylee", markPitched: true });
  assert.deepEqual(Object.keys(sent).sort(), ["id", "messageId", "threadId"]);
  const act = (await db.list(`pitches/${pitchId}/activity`)).find((a) => a.type === "emailSent")!;
  assert.equal(sent.id, act.id, "pitches.sendEmail still answers with the timeline entry");

  const t = await thread(sent.threadId);
  assert.deepEqual(t.target, { kind: "venue", id: venueId, name: "Lost Lake" });
  assert.equal(t.pitchId, pitchId);
  assert.equal(t.account, "jeff@example.com");
  assert.equal(t.lastDirection, "sent");
  assert.equal(t.lastFrom, "jeff@example.com");
  assert.equal(t.messageCount, 1);
  assert.deepEqual(t.participants, ["haylee@lostlake.example"]);
  assert.equal(t.snippet, "Hi Haylee");
  assert.equal((await db.get("pitches", pitchId))!.status, "pitched");
  assert.equal(hasNewReply(t as any), false);

  assert.deepEqual(await cmd("email.sync", { target: { kind: "venue", id: venueId } }), { added: 0, threads: 1 });
  await gmailClient().simulateReply!(sent.threadId, { from: "haylee@lostlake.example", body: "Sounds great, send dates.\n\nOn Tue, Jeff wrote:\n> Hi Haylee" });
  assert.deepEqual(await cmd("email.sync", { target: { kind: "venue", id: venueId } }), { added: 1, threads: 1 });
  const after1 = await thread(sent.threadId);
  assert.equal(after1.lastDirection, "received");
  assert.equal(after1.lastFrom, "haylee@lostlake.example");
  assert.equal(after1.messageCount, 2);
  assert.equal(after1.snippet, "Sounds great, send dates.", "the quoted part is not in the snippet");
  assert.equal(hasNewReply(after1 as any), true);
  const replies = (await db.list(`pitches/${pitchId}/activity`)).filter((a) => a.type === "emailReply");
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /Sounds great/);
  assert.deepEqual(await cmd("email.sync", { target: { kind: "venue", id: venueId } }), { added: 0, threads: 1 });
  assert.equal((await db.list(`pitches/${pitchId}/activity`)).filter((a) => a.type === "emailReply").length, 1);
  assert.ok(after1.syncedAt, "every sync stamps when the thread was read");
});

test("pitches.checkReplies keeps its shape and picks up a thread that only the timeline knows", async () => {
  const { pitchId } = await lostLake();
  const msg = await gmailClient().send({ account: "jeff@example.com", to: ["h@lostlake.example"], subject: "Old one", body: "hello" });
  await db.create(ctx, `pitches/${pitchId}/activity`, { type: "emailSent", text: "hello", gmail: { messageId: msg.id, threadId: msg.threadId, to: "h@lostlake.example", subject: "Old one", account: "jeff@example.com" } });
  assert.equal((await cmd("pitches.checkReplies", { id: pitchId })).added, 0);
  assert.equal((await thread(msg.threadId)).subject, "Old one", "linked on the way");
  await gmailClient().simulateReply!(msg.threadId, { from: "h@lostlake.example", body: "Yes" });
  assert.deepEqual(await cmd("pitches.checkReplies", { id: pitchId }), { added: 1 });
  assert.deepEqual(await cmd("pitches.checkReplies", { id: pitchId }), { added: 0 });
});

test("link: a stranger's first email on a venue with no pitch; unlink; an edition's threads go on its festival", async () => {
  const v = await cmd("venues.create", venue("Lost Lake"));
  const first = await receive({ from: "Booking@LostLake.example", fromName: "Lost Lake Booking", to: ["jeff@example.com"], subject: "Your submission to Lost Lake", body: "Thanks! We got it." });
  assert.equal(first.fromName, "Lost Lake Booking");
  const { id } = await cmd("email.link", { threadId: first.threadId, target: { kind: "venue", id: v.id } });
  assert.equal(id, emailThreadId(TEST_ARTIST, first.threadId));
  const t = await thread(first.threadId);
  assert.equal(t.pitchId, undefined);
  assert.equal(t.lastDirection, "received");
  assert.equal(t.lastFrom, "booking@lostlake.example");
  assert.deepEqual(t.participants, ["booking@lostlake.example"]);
  assert.equal((await cmd("email.link", { threadId: first.threadId, target: { kind: "venue", id: v.id } })).id, id, "idempotent");
  assert.equal((await db.list("emailThreads")).length, 1);

  const th = await cmd("email.thread", { id });
  assert.equal(th.messages[0].fromName, "Lost Lake Booking");
  assert.equal(th.thread.messageCount, 1);
  await cmd("email.unlink", { id });
  assert.equal((await db.list("emailThreads")).length, 0);
  assert.deepEqual(await cmd("email.sync", { target: { kind: "venue", id: v.id } }), { added: 0, threads: 0 });
  await cmd("email.link", { threadId: first.threadId, target: { kind: "venue", id: v.id } });
  assert.equal((await db.list("emailThreads")).length, 1, "linking again brings it back");

  const f = await cmd("festivals.create", { name: "Westword Music Showcase", type: "festival", address: { city: "Denver", state: "CO" }, region: "denver" });
  const e = await cmd("editions.create", { festivalId: f.id, year: 2027, label: "2027", venueIds: [] });
  const other = await receive({ from: "a@fest.example", to: ["jeff@example.com"], subject: "Lineup", body: "x" });
  await cmd("email.link", { threadId: other.threadId, target: { kind: "edition", id: e.id } });
  assert.equal((await thread(other.threadId)).target.kind, "festival");
  assert.equal((await thread(other.threadId)).target.id, f.id);
});

test("link with a pitch adds the replies that are not on its timeline yet, once", async () => {
  const { venueId, pitchId } = await lostLake();
  const m = await receive({ from: "h@lostlake.example", to: ["jeff@example.com"], subject: "Hello", body: "We saw you play" });
  await cmd("email.link", { threadId: m.threadId, target: { kind: "venue", id: venueId }, pitchId });
  await cmd("email.link", { threadId: m.threadId, target: { kind: "venue", id: venueId }, pitchId });
  assert.equal((await db.list(`pitches/${pitchId}/activity`)).filter((a) => a.type === "emailReply").length, 1);
});

test("email.thread marks the thread seen, so the New reply mark goes away until the next reply", async () => {
  const { venueId, pitchId } = await lostLake();
  const sent = await cmd("email.send", { target: { kind: "venue", id: venueId }, pitchId, to: ["h@lostlake.example"], subject: "Hi", body: "Hello" });
  assert.equal(sent.id, emailThreadId(TEST_ARTIST, sent.threadId));
  await new Promise((r) => setTimeout(r, 20));
  await receive({ from: "h@lostlake.example", to: ["jeff@example.com"], subject: "Re: Hi", body: "Hey", threadId: sent.threadId });
  await cmd("email.sync", { target: { kind: "venue", id: venueId } });
  assert.equal(hasNewReply((await thread(sent.threadId)) as any), true);
  await cmd("email.thread", { id: sent.id });
  const seen = await thread(sent.threadId);
  assert.ok(seen.lastSeenAt);
  assert.equal(hasNewReply(seen as any), false);
  await new Promise((r) => setTimeout(r, 20));
  await receive({ from: "h@lostlake.example", to: ["jeff@example.com"], subject: "Re: Hi", body: "Also", threadId: sent.threadId });
  await cmd("email.sync", { target: { kind: "venue", id: venueId } });
  assert.equal(hasNewReply((await thread(sent.threadId)) as any), true);
});

test("email.send without a pitch only creates the thread; unfilled fields are refused; a reply stays in its thread; draft", async () => {
  const { venueId } = await lostLake();
  await assert.rejects(cmd("email.send", { target: { kind: "venue", id: venueId }, to: ["h@x.example"], subject: "Hi {{contact.firstName}}", body: "x" }), /Fill in/);
  const a = await cmd("email.send", { target: { kind: "venue", id: venueId }, to: ["h@x.example"], subject: "Hi", body: "one" });
  const b = await cmd("email.send", { target: { kind: "venue", id: venueId }, threadId: a.threadId, to: ["h@x.example"], subject: "Re: Hi", body: "two" });
  assert.equal(b.id, a.id);
  const t = await thread(a.threadId);
  assert.equal(t.messageCount, 2);
  assert.equal(t.pitchId, undefined);
  assert.equal((await db.list("pitches")).length, 1);
  const d = await cmd("email.draft", { target: { kind: "venue", id: venueId }, to: ["h@x.example"], subject: "Later", body: "soon" });
  assert.equal(d.sent, false);
  assert.equal((await gmailClient().listDrafts("jeff@example.com")).length, 1);
  assert.equal((await db.list("emailThreads")).length, 1, "a draft is not a thread");
  await assert.rejects(cmd("email.thread", { id: "nope" }), /not found/i);
});

test("email commands are admin only, and Roadie neither reads the mail nor sends without asking", () => {
  for (const n of ["email.link", "email.unlink", "email.sync", "email.thread", "email.send", "email.draft"]) assert.deepEqual(registry[n].roles, ["admin"], n);
  assert.deepEqual(registry["pitches.draftEmail"].roles, ["admin", "mcp"]);
  assert.deepEqual(registry["pitches.checkReplies"].roles, ["admin"]);
  for (const n of ["email.link", "email.sync", "email.thread"]) assert.ok(isExcluded(n), `${n} reads the band's mail`);
  assert.ok(needsConfirm("email.send", {}));
});

test("splitQuoted: everything from 'On … wrote:' or the first '>' line is the quote", () => {
  assert.deepEqual(splitQuoted("Dec 11 works.\n\nOn Tue, Dec 2, 2026 at 9:00 AM Ingrid <i@x.com> wrote:\n> Can we do Dec 11?\n> Thanks"), { text: "Dec 11 works.", quoted: "On Tue, Dec 2, 2026 at 9:00 AM Ingrid <i@x.com> wrote:\n> Can we do Dec 11?\n> Thanks" });
  assert.deepEqual(splitQuoted("Yes\n> earlier\nmore"), { text: "Yes", quoted: "> earlier\nmore" });
  assert.deepEqual(splitQuoted("  Just this.  \r\n"), { text: "Just this.", quoted: "" });
  assert.deepEqual(splitQuoted("On the other hand\nwe could wrote: no"), { text: "On the other hand\nwe could wrote: no", quoted: "" });
  assert.deepEqual(splitQuoted("> all quoted"), { text: "", quoted: "> all quoted" });
  assert.equal(snippetOf("a ".repeat(200) + "\n> q").length <= 160, true);
  assert.equal(snippetOf("Line one\n\n  line   two"), "Line one line two");
});

test("agoText says how long ago, in plain words", () => {
  const now = Date.UTC(2026, 9, 27, 12);
  assert.equal(agoText(now - 20_000, now), "just now");
  assert.equal(agoText(now - 60_000, now), "1 minute ago");
  assert.equal(agoText(now - 12 * 60_000, now), "12 minutes ago");
  assert.equal(agoText(now - 3 * 3600_000, now), "3 hours ago");
  assert.equal(agoText(now - 50 * 3600_000, now), "2 days ago");
});

test("the fake's search syntax: words, from:, to:, OR, parentheses, quotes; a plain q is one substring", () => {
  const m = { from: "haylee@lostlake.example", to: ["jeff@example.com"], cc: ["cc@x.example"], subject: "Support slot", body: "Dec 11 works for us" };
  const hit = (q: string) => matches(q, m);
  assert.equal(hit(""), true);
  assert.equal(hit("Support slot"), true, "plain substring");
  assert.equal(hit("slot support"), false);
  assert.equal(hit("from:haylee@lostlake.example"), true);
  assert.equal(hit("from:@lostlake.example"), true);
  assert.equal(hit("from:jeff@example.com"), false);
  assert.equal(hit("to:jeff@example.com"), true);
  assert.equal(hit("to:cc@x.example"), true);
  assert.equal(hit("from:(nobody@x.example OR haylee@lostlake.example)"), true);
  assert.equal(hit("from:(nobody@x.example OR other@x.example)"), false);
  assert.equal(hit("from:(a@x OR b@x) OR to:(jeff@example.com)"), true);
  assert.equal(hit("from:(a@x OR b@x) OR \"Lost Lake\""), false);
  assert.equal(hit("from:haylee@lostlake.example OR \"nothing here\""), true);
  assert.equal(hit("(slot OR zebra) dec"), true);
  assert.equal(hit("(zebra OR yak) dec"), false);
  assert.equal(hit('"works for us" from:haylee@lostlake.example'), true);
  assert.equal(hit('"works for them" OR zebra'), false);
});
