/** Threads belong to the place: summaries, sync, link, seen, the pitch wrappers, splitQuoted and the fake's search syntax. */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { gmailClient } from "@/server/integrations";
import { isExcluded, needsConfirm } from "@/server/assistant/policy";
import { hasNewReply, emailThreadId, venueNoteId } from "@/schema";
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
  uid = (await makeUser("rudy@example.com", "admin", { name: "Rudy Smith" })).uid;
  ctx = { uid, role: "admin", via: "app", runId: newRunId() };
  await db.create(ctx, "artists", { slug: "nora-quill-band", name: "Nora Quill Band", driveFolderId: "", links: {}, configurations: [] }, { id: TEST_ARTIST });
});

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};
const receive = async (body: Record<string, unknown>) => (await (await fetch(`${gmailUrl}/messages/receive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()) as Record<string, any>;
const thread = async (threadId: string) => (await db.get("emailThreads", emailThreadId(TEST_ARTIST, threadId)))!;

async function pineHollow() {
  const v = await cmd("venues.create", venue("Pine Hollow"));
  const { id } = await cmd("pitches.flag", { kind: "venue", id: v.id });
  return { venueId: v.id as string, pitchId: id as string };
}

test("send creates the thread on the venue; a reply arrives on sync once; the wrapper keeps its shape", async () => {
  const { venueId, pitchId } = await pineHollow();
  const sent = await cmd("pitches.sendEmail", { id: pitchId, to: ["rosa@pinehollow.example"], subject: "Support slot", body: "Hi Rosa", markPitched: true });
  assert.deepEqual(Object.keys(sent).sort(), ["id", "messageId", "threadId"]);
  const act = (await db.list(`pitches/${pitchId}/activity`)).find((a) => a.type === "emailSent")!;
  assert.equal(sent.id, act.id, "pitches.sendEmail still answers with the timeline entry");

  const t = await thread(sent.threadId);
  assert.deepEqual(t.target, { kind: "venue", id: venueId, name: "Pine Hollow" });
  assert.equal(t.pitchId, pitchId);
  assert.equal(t.account, "rudy@example.com");
  assert.equal(t.lastDirection, "sent");
  assert.equal(t.lastFrom, "rudy@example.com");
  assert.equal(t.messageCount, 1);
  assert.deepEqual(t.participants, ["rosa@pinehollow.example"]);
  assert.equal(t.snippet, "Hi Rosa");
  assert.equal((await db.get("pitches", pitchId))!.status, "pitched");
  assert.equal(hasNewReply(t as any), false);

  assert.deepEqual(await cmd("email.sync", { target: { kind: "venue", id: venueId } }), { added: 0, threads: 1 });
  await gmailClient().simulateReply!(sent.threadId, { from: "rosa@pinehollow.example", body: "Sounds great, send dates.\n\nOn Tue, Rudy wrote:\n> Hi Rosa" });
  assert.deepEqual(await cmd("email.sync", { target: { kind: "venue", id: venueId } }), { added: 1, threads: 1 });
  const after1 = await thread(sent.threadId);
  assert.equal(after1.lastDirection, "received");
  assert.equal(after1.lastFrom, "rosa@pinehollow.example");
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
  const { pitchId } = await pineHollow();
  const msg = await gmailClient().send({ account: "rudy@example.com", to: ["h@pinehollow.example"], subject: "Old one", body: "hello" });
  await db.create(ctx, `pitches/${pitchId}/activity`, { type: "emailSent", text: "hello", gmail: { messageId: msg.id, threadId: msg.threadId, to: "h@pinehollow.example", subject: "Old one", account: "rudy@example.com" } });
  assert.equal((await cmd("pitches.checkReplies", { id: pitchId })).added, 0);
  assert.equal((await thread(msg.threadId)).subject, "Old one", "linked on the way");
  await gmailClient().simulateReply!(msg.threadId, { from: "h@pinehollow.example", body: "Yes" });
  assert.deepEqual(await cmd("pitches.checkReplies", { id: pitchId }), { added: 1 });
  assert.deepEqual(await cmd("pitches.checkReplies", { id: pitchId }), { added: 0 });
});

test("link: a stranger's first email on a venue with no pitch; unlink; an edition's threads go on its festival", async () => {
  const v = await cmd("venues.create", venue("Pine Hollow"));
  const first = await receive({ from: "Booking@PineHollow.example", fromName: "Pine Hollow Booking", to: ["rudy@example.com"], subject: "Your submission to Pine Hollow", body: "Thanks! We got it." });
  assert.equal(first.fromName, "Pine Hollow Booking");
  const { id } = await cmd("email.link", { threadId: first.threadId, target: { kind: "venue", id: v.id } });
  assert.equal(id, emailThreadId(TEST_ARTIST, first.threadId));
  const t = await thread(first.threadId);
  assert.equal(t.pitchId, undefined);
  assert.equal(t.lastDirection, "received");
  assert.equal(t.lastFrom, "booking@pinehollow.example");
  assert.deepEqual(t.participants, ["booking@pinehollow.example"]);
  assert.equal((await cmd("email.link", { threadId: first.threadId, target: { kind: "venue", id: v.id } })).id, id, "idempotent");
  assert.equal((await db.list("emailThreads")).length, 1);

  const th = await cmd("email.thread", { id });
  assert.equal(th.messages[0].fromName, "Pine Hollow Booking");
  assert.equal(th.thread.messageCount, 1);
  await cmd("email.unlink", { id });
  assert.equal((await db.list("emailThreads")).length, 0);
  assert.deepEqual(await cmd("email.sync", { target: { kind: "venue", id: v.id } }), { added: 0, threads: 0 });
  await cmd("email.link", { threadId: first.threadId, target: { kind: "venue", id: v.id } });
  assert.equal((await db.list("emailThreads")).length, 1, "linking again brings it back");

  const f = await cmd("festivals.create", { name: "Westword Music Showcase", type: "festival", address: { city: "Denver", state: "CO" } });
  const e = await cmd("editions.create", { festivalId: f.id, year: 2027, label: "2027", venueIds: [] });
  const other = await receive({ from: "a@fest.example", to: ["rudy@example.com"], subject: "Lineup", body: "x" });
  await cmd("email.link", { threadId: other.threadId, target: { kind: "edition", id: e.id } });
  assert.equal((await thread(other.threadId)).target.kind, "festival");
  assert.equal((await thread(other.threadId)).target.id, f.id);
});

test("link with a pitch adds the replies that are not on its timeline yet, once", async () => {
  const { venueId, pitchId } = await pineHollow();
  const m = await receive({ from: "h@pinehollow.example", to: ["rudy@example.com"], subject: "Hello", body: "We saw you play" });
  await cmd("email.link", { threadId: m.threadId, target: { kind: "venue", id: venueId }, pitchId });
  await cmd("email.link", { threadId: m.threadId, target: { kind: "venue", id: venueId }, pitchId });
  assert.equal((await db.list(`pitches/${pitchId}/activity`)).filter((a) => a.type === "emailReply").length, 1);
});

test("email.thread marks the thread seen, so the New reply mark goes away until the next reply", async () => {
  const { venueId, pitchId } = await pineHollow();
  const sent = await cmd("email.send", { target: { kind: "venue", id: venueId }, pitchId, to: ["h@pinehollow.example"], subject: "Hi", body: "Hello" });
  assert.equal(sent.id, emailThreadId(TEST_ARTIST, sent.threadId));
  await new Promise((r) => setTimeout(r, 20));
  await receive({ from: "h@pinehollow.example", to: ["rudy@example.com"], subject: "Re: Hi", body: "Hey", threadId: sent.threadId });
  await cmd("email.sync", { target: { kind: "venue", id: venueId } });
  assert.equal(hasNewReply((await thread(sent.threadId)) as any), true);
  await cmd("email.thread", { id: sent.id });
  const seen = await thread(sent.threadId);
  assert.ok(seen.lastSeenAt);
  assert.equal(hasNewReply(seen as any), false);
  await new Promise((r) => setTimeout(r, 20));
  await receive({ from: "h@pinehollow.example", to: ["rudy@example.com"], subject: "Re: Hi", body: "Also", threadId: sent.threadId });
  await cmd("email.sync", { target: { kind: "venue", id: venueId } });
  assert.equal(hasNewReply((await thread(sent.threadId)) as any), true);
});

test("email.send without a pitch only creates the thread; unfilled fields are refused; a reply stays in its thread; draft", async () => {
  const { venueId } = await pineHollow();
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
  assert.equal((await gmailClient().listDrafts("rudy@example.com")).length, 1);
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

test("an act is a thread target: email.send lands the thread on the act, email.search reads its linked contacts, and a missing act is a 404", async () => {
  const actx: Ctx = { ...ctx, artistId: TEST_ARTIST };
  const act = await cmd("acts.create", { name: "Sample Support" }, actx);
  const c = await cmd("contacts.create", { name: "Sam Booker", emails: ["sam@support.example"], attachTo: { kind: "acts", id: act.id } }, actx);
  assert.ok(c.id);
  const sent = await cmd("email.send", { target: { kind: "act", id: act.id }, to: ["sam@support.example"], subject: "Open for us?", body: "Hello" }, actx);
  assert.deepEqual((await thread(sent.threadId)).target, { kind: "act", id: act.id, name: "Sample Support" });
  assert.deepEqual(await cmd("email.sync", { target: { kind: "act", id: act.id } }, actx), { added: 0, threads: 1 });
  const hits = (await cmd("email.search", { target: { kind: "act", id: act.id } }, actx)) as unknown as { threadId: string; linkedId?: string }[];
  assert.equal(hits.find((h) => h.threadId === sent.threadId)?.linkedId, emailThreadId(TEST_ARTIST, sent.threadId));
  await assert.rejects(cmd("email.send", { target: { kind: "act", id: "nope" }, to: ["a@x.example"], subject: "Hi", body: "x" }, actx), /not found/);
});

test("booking mailbox: accountOf is the caller's own Gmail without it and the booking mailbox with it; sends say who wrote them; old threads keep their account", async () => {
  const { accountOf } = await import("@/server/commands/email");
  const nora = (await makeUser("nora@example.com", "admin", { name: "Nora Quill" })).uid;
  const noraCtx: Ctx = { uid: nora, role: "admin", via: "app", runId: newRunId() };
  assert.equal(await accountOf(ctx), "rudy@example.com", "no setting: each admin's own");
  assert.equal(await accountOf(noraCtx), "nora@example.com");

  const { venueId, pitchId } = await pineHollow();
  const old = await cmd("pitches.sendEmail", { id: pitchId, to: ["rosa@pinehollow.example"], subject: "Before", body: "Hi Rosa" });
  assert.equal((await thread(old.threadId)).account, "rudy@example.com");

  await db.update({ ...ctx, artistId: TEST_ARTIST }, "artists", TEST_ARTIST, { bookingMail: { uid, email: "rudy@example.com" } });
  assert.equal(await accountOf(noraCtx), "rudy@example.com", "every admin goes through the booking mailbox");
  assert.equal(await accountOf({ ...noraCtx, artistId: TEST_ARTIST }), "rudy@example.com");

  const sent = await cmd("email.send", { target: { kind: "venue", id: venueId }, pitchId, to: ["rosa@pinehollow.example"], subject: "Dates", body: "Here you go" }, noraCtx);
  const t = await thread(sent.threadId);
  assert.equal(t.account, "rudy@example.com");
  assert.equal(t.lastFrom, "rudy@example.com");
  assert.deepEqual(t.sentBy, { [sent.messageId]: nora });
  const read = await cmd("email.thread", { id: t.id }, noraCtx);
  assert.deepEqual(read.sentBy, { [sent.messageId]: "Nora Quill" });
  // A pitch send from before `sentBy` existed is attributed from its timeline entry's createdBy.
  await db.update(ctx, "emailThreads", emailThreadId(TEST_ARTIST, old.threadId), { sentBy: {} });
  const oldRead = await cmd("email.thread", { id: emailThreadId(TEST_ARTIST, old.threadId) }, noraCtx);
  assert.equal(Object.values(oldRead.sentBy)[0], "Rudy Smith");

  // A thread linked from Nora's own mailbox before the setting keeps that account through a sync.
  await db.update(ctx, "emailThreads", emailThreadId(TEST_ARTIST, old.threadId), { account: "nora@example.com" });
  await cmd("email.sync", { target: { kind: "venue", id: venueId } }, noraCtx);
  assert.equal((await thread(old.threadId)).account, "nora@example.com", "not migrated");

  await db.update({ ...ctx, artistId: TEST_ARTIST }, "artists", TEST_ARTIST, { bookingMail: null });
  assert.equal(await accountOf(noraCtx), "nora@example.com", "cleared: back to each admin's own");
});

test("S8 (#82): one email covers several pitches: each logged once, replies reach each, linking adds and never moves, older threads still read", async () => {
  const { venueId: v1, pitchId: p1 } = await pineHollow();
  const v2 = (await cmd("venues.create", venue("Southern Sun"))).id as string;
  const p2 = (await cmd("pitches.flag", { kind: "venue", id: v2 })).id as string;

  // A bad id is refused before Gmail is called: nothing is sent.
  await assert.rejects(cmd("pitches.sendEmail", { id: p1, pitchIds: [p2, "nope"], to: ["kate@sun.example"], subject: "Spring", body: "Hi Kate" }), /not found/i);
  assert.equal((await db.list("emailThreads")).length, 0);

  const sent = await cmd("pitches.sendEmail", { id: p1, pitchIds: [p2], to: ["kate@sun.example"], subject: "Spring", body: "Hi Kate", markPitched: true });
  const t = await thread(sent.threadId);
  assert.deepEqual([t.pitchId, t.pitchIds], [p1, [p1, p2]]);
  for (const p of [p1, p2]) {
    assert.equal((await db.list(`pitches/${p}/activity`)).filter((a) => a.type === "emailSent").length, 1, p);
    const doc = (await db.get("pitches", p))!;
    assert.equal(doc.status, "pitched");
    assert.ok(doc.lastContactAt);
  }
  // Sync reads the thread from its place and credits every pitch on it.
  await gmailClient().simulateReply!(sent.threadId, { from: "kate@sun.example", body: "Yes to both" });
  assert.deepEqual(await cmd("email.sync", { target: { kind: "venue", id: v1 } }), { added: 2, threads: 1 });
  for (const p of [p1, p2]) assert.equal((await db.list(`pitches/${p}/activity`)).filter((a) => a.type === "emailReply").length, 1, p);

  // Linking the thread to a third pitch adds it; the first stays (it used to be overwritten).
  const v3 = (await cmd("venues.create", venue("Vine Street"))).id as string;
  const p3 = (await cmd("pitches.flag", { kind: "venue", id: v3 })).id as string;
  await cmd("email.link", { threadId: sent.threadId, target: { kind: "venue", id: v1 }, pitchId: p3 });
  const linked = await thread(sent.threadId);
  assert.deepEqual([linked.pitchId, linked.pitchIds], [p1, [p1, p2, p3]]);

  // An older single-pitch thread (pitchId only) keeps working: a plain send, a reply, a sync.
  const old = await cmd("pitches.sendEmail", { id: p2, to: ["kate@sun.example"], subject: "Fall", body: "Hi again" });
  const ot = await thread(old.threadId);
  assert.deepEqual([ot.pitchId, ot.pitchIds], [p2, undefined]);
  await gmailClient().simulateReply!(old.threadId, { from: "kate@sun.example", body: "Maybe" });
  assert.equal((await cmd("email.sync", { target: { kind: "venue", id: v2 } })).added, 1);
});

test("ingest adds the people on a place's mail as the band's contacts, linked to the place: names from Gmail, no robots, no band, no repeats", async () => {
  const { venueId, pitchId } = await pineHollow();
  const linked = async () => {
    const n = await db.get("venueNotes", venueNoteId(TEST_ARTIST, venueId));
    const ids = (n?.contactIds ?? []) as string[];
    return Promise.all(ids.map(async (id) => (await db.get("contacts", id))!));
  };
  // We wrote to Rosa: she is a contact named from her address until she answers with a name.
  const sent = await cmd("pitches.sendEmail", { id: pitchId, to: ["rosa@pinehollow.example"], cc: ["rudy@example.com"], subject: "Support slot", body: "Hi Rosa" });
  let cs = await linked();
  assert.deepEqual(cs.map((c) => [c.name, c.emails]), [["Rosa", ["rosa@pinehollow.example"]]], "the band's own address is never a contact");
  assert.equal(cs[0].artistId, TEST_ARTIST);

  // Her reply carries her name and signature; a no-reply notice in the same thread is skipped.
  await receive({ threadId: sent.threadId, from: "Rosa@PineHollow.example", fromName: "Rosa Diaz", to: ["rudy@example.com"], subject: "Re: Support slot", body: "Sounds good.\n\nRosa Diaz\nTalent Buyer\n(303) 555-0142" });
  await receive({ threadId: sent.threadId, from: "noreply@pinehollow.example", fromName: "Pine Hollow", to: ["rudy@example.com"], subject: "Re: Support slot", body: "Auto" });
  await cmd("email.sync", { target: { kind: "venue", id: venueId } });
  cs = await linked();
  assert.equal(cs.length, 1, "Rosa once, and no noreply");
  assert.equal(cs[0].name, "Rosa Diaz", "the name from Gmail replaces the one guessed from the address");
  assert.equal((await db.list("contacts")).filter((c) => c.artistId === TEST_ARTIST).length, 1, "merged, not copied");

  // A stranger's email linked to the venue: the sender becomes a contact there, with the title and phone from the signature.
  const first = await receive({ from: "Sam@PineHollow.example", fromName: "Sam Ortiz", to: ["rudy@example.com"], subject: "Your submission", body: "Thanks!\n\nSam Ortiz\nEvents Manager\n303-555-0199" });
  await cmd("email.link", { threadId: first.threadId, target: { kind: "venue", id: venueId } });
  const sam = (await linked()).find((c) => c.emails[0] === "sam@pinehollow.example")!;
  assert.equal(sam.name, "Sam Ortiz");
  assert.equal(sam.title, "Events Manager");
  assert.deepEqual(sam.phones, ["+13035550199"]);

  // Archived on purpose: a later thread doesn't bring them back.
  await cmd("contacts.remove", { id: sam.id });
  await cmd("email.sync", { target: { kind: "venue", id: venueId } });
  assert.equal((await linked()).some((c) => c.id === sam.id), false);
  assert.equal((await db.get("contacts", sam.id))!.deletedAt != null, true);

  // A promoter's mail links to the band's notes on the promoter.
  const p = await cmd("promoters.create", { name: "Mile High Shows", kind: "promoter" });
  const pm = await receive({ from: "jo@milehigh.example", fromName: "Jo Park", to: ["rudy@example.com"], subject: "Hello", body: "Hi" });
  await cmd("email.link", { threadId: pm.threadId, target: { kind: "promoter", id: p.id } });
  const pn = (await db.list("promoterNotes")).find((n) => n.promoterId === p.id)!;
  const jo = (await db.list("contacts")).find((c) => c.emails?.[0] === "jo@milehigh.example")!;
  assert.deepEqual(pn.contactIds, [jo.id]);
  assert.equal(jo.name, "Jo Park");
});
