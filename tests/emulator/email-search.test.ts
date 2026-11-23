/** Search Gmail: the signature heuristic, the query and grouping helpers, and email.search / email.people against the fake. */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { resetEmulators, makeUser, venue, TEST_ARTIST, SYS } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let gmailUrl: string;
let ctx: Ctx;

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
  const uid = (await makeUser("rudy@example.com", "admin", { name: "Rudy Smith" })).uid;
  ctx = { uid, artistId: TEST_ARTIST, role: "admin", via: "app", runId: newRunId() };
  await db.create(ctx, "artists", { timeZone: "America/Denver", slug: "nora-quill-band", name: "Nora Quill Band", driveFolderId: "", links: {}, configurations: [] }, { id: TEST_ARTIST });
});

const cmd = async (name: string, input: unknown) => {
  const x = registry[name];
  return (await x.run(ctx, x.input.parse(input))) as any;
};
const receive = async (body: Record<string, unknown>) => (await (await fetch(`${gmailUrl}/messages/receive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()) as Record<string, any>;

async function pineHollow() {
  const v = await cmd("venues.create", venue("Pine Hollow Lounge"));
  const c = await cmd("contacts.create", { name: "Rosa Jackson", emails: ["rosa@pinehollow.example"], attachTo: { kind: "venues", id: v.id } });
  return { venueId: v.id as string, contactId: c.id as string };
}
const SIG = "Dec 11 works.\n\nRosa Jackson\nTalent buyer, Pine Hollow Lounge\n(303) 555-0101";

test("email.search finds mail from the contacts and by the place's name, groups by thread, and flags linked ones", async () => {
  const { venueId } = await pineHollow();
  const target = { kind: "venue", id: venueId };
  const auto = await receive({ from: "booking@pinehollow.example", to: ["rudy@example.com"], subject: "Your submission to Pine Hollow Lounge", body: "We got it." });
  const hay = await receive({ from: "rosa@pinehollow.example", fromName: "Rosa Jackson", to: ["rudy@example.com"], subject: "Support slot", body: SIG });
  await receive({ from: "rosa@pinehollow.example", fromName: "Rosa Jackson", to: ["rudy@example.com"], subject: "Support slot", body: "One more thing", threadId: hay.threadId });
  await receive({ from: "someone@else.example", to: ["rudy@example.com"], subject: "Unrelated", body: "Nothing to see" });

  const hits = await cmd("email.search", { target });
  assert.deepEqual(hits.map((h: any) => h.threadId).sort(), [auto.threadId, hay.threadId].sort());
  const h = hits.find((x: any) => x.threadId === hay.threadId);
  assert.equal(h.messageCount, 2);
  assert.equal(h.snippet, "One more thing");
  assert.deepEqual(h.participants, ["rosa@pinehollow.example"]);
  assert.equal(h.linkedId, undefined);

  await cmd("email.link", { threadId: auto.threadId, target });
  const again = await cmd("email.search", { target });
  assert.ok(again.find((x: any) => x.threadId === auto.threadId).linkedId, "linked now");

  // Linking the auto-reply made booking@ a contact of the venue, so its thread is the contacts' mail now too.
  assert.equal((await cmd("email.search", { target, q: "Unrelated" })).length, 3, "typed text replaces the place's name; the contacts' mail stays");
  const only = await cmd("email.search", { target, addresses: [], q: "Unrelated" });
  assert.deepEqual(only.map((x: any) => x.subject), ["Unrelated"], "no addresses chosen: only the text");
  const dom = await cmd("email.search", { target, addresses: [], domain: "pinehollow.example", q: "zzz-nothing" });
  assert.equal(dom.length, 2, "the domain chip finds the auto-reply too");
});

const sendRaw = async (body: Record<string, unknown>) => (await (await fetch(`${gmailUrl}/messages/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()) as Record<string, any>;

test("email.suggest finds what was sent outside Roadie, best first; linking it takes it off the pitch and shows elsewhere", async () => {
  const { venueId } = await pineHollow();
  const { id: pitchId } = await cmd("pitches.flag", { kind: "venue", id: venueId });
  const other = await cmd("venues.create", venue("Velour"));
  const { id: velourPitch } = await cmd("pitches.flag", { kind: "venue", id: other.id });
  // Sent from Gmail by hand: to the contact, one naming the room in the subject, one only in the text; one that came in; one unrelated.
  const toRosa = await sendRaw({ from: "rudy@example.com", to: ["rosa@pinehollow.example"], subject: "Spring dates?", body: "Hi Rosa" });
  await receive({ from: "rosa@pinehollow.example", to: ["rudy@example.com"], subject: "Re: Spring dates?", body: "Let me check", threadId: toRosa.threadId });
  const bySubject = await sendRaw({ from: "rudy@example.com", to: ["info@pinehollow.example"], subject: "Pine Hollow Lounge, March", body: "Hello" });
  const byText = await sendRaw({ from: "rudy@example.com", to: ["friend@else.example"], subject: "Weekend", body: "We might play Pine Hollow Lounge" });
  await receive({ from: "news@pinehollow.example", to: ["rudy@example.com"], subject: "Pine Hollow Lounge newsletter", body: "Shows" });
  await sendRaw({ from: "rudy@example.com", to: ["x@y.example"], subject: "Unrelated", body: "Nothing" });

  const r = await cmd("email.suggest", { pitchId });
  assert.equal(r.account, "rudy@example.com", "no booking mailbox: the caller's own");
  assert.deepEqual(r.hits.map((h: any) => [h.threadId, h.why]), [[toRosa.threadId, "contact"], [bySubject.threadId, "subject"], [byText.threadId, "text"]], "sent mail only, best first");

  // Linked to this pitch: no longer suggested here. Linked to the venue alone, it says so.
  await cmd("email.link", { threadId: toRosa.threadId, target: { kind: "venue", id: venueId }, pitchId });
  const t = await db.get(SYS, "emailThreads", `${TEST_ARTIST}__${toRosa.threadId}`);
  assert.ok(t?.firstDate, "the thread keeps the date it started");
  assert.equal((await db.list(SYS, `pitches/${pitchId}/activity`)).filter((a) => a.type === "emailReply").length, 1, "the reply is on the timeline");
  assert.deepEqual((await cmd("email.suggest", { pitchId })).hits.map((h: any) => h.threadId), [bySubject.threadId, byText.threadId]);
  // Taken off the pitch (a bounce): still not suggested here, though it has no pitch now.
  await cmd("email.unlink", { id: `${TEST_ARTIST}__${toRosa.threadId}`, pitchId });
  assert.deepEqual((await cmd("email.suggest", { pitchId })).hits.map((h: any) => h.threadId), [bySubject.threadId, byText.threadId]);

  await sendRaw({ from: "rudy@example.com", to: ["v@velour.example"], subject: "Velour and Pine Hollow Lounge", body: "Both rooms" });
  await cmd("email.link", { threadId: bySubject.threadId, target: { kind: "venue", id: other.id }, pitchId: velourPitch });
  const moved = (await cmd("email.suggest", { pitchId })).hits.find((h: any) => h.threadId === bySubject.threadId);
  assert.equal(moved.elsewhere, "Velour");
  assert.ok(moved.linkedId);
  await assert.rejects(cmd("email.suggest", { pitchId: "nope" }), /not found/i);
});

test("email.search finds drafts and scheduled mail and says so; linking one from a pitch keeps it there until Gmail sends it", async () => {
  const { venueId } = await pineHollow();
  const target = { kind: "venue", id: venueId };
  const { id: pitchId } = await cmd("pitches.flag", { kind: "venue", id: venueId });
  const post = async (p: string, body: Record<string, unknown> = {}) => (await (await fetch(`${gmailUrl}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()) as Record<string, any>;
  // Made in Gmail, not by Roadie: a draft, and one already scheduled for Monday.
  const draft = await post("/drafts/gmail", { from: "rudy@example.com", to: ["rosa@pinehollow.example"], subject: "Spring at Pine Hollow", body: "Hi Rosa" });
  const later = await post("/drafts/gmail", { from: "rudy@example.com", to: ["rosa@pinehollow.example"], subject: "Fall at Pine Hollow", body: "Hi again", scheduled: true, sendAt: "2031-03-03T14:02:00.000Z" });
  // A sent thread with a draft reply waiting in it.
  const sent = await sendRaw({ from: "rudy@example.com", to: ["rosa@pinehollow.example"], subject: "Summer?", body: "Hello" });
  await post("/drafts", { from: "rudy@example.com", to: ["rosa@pinehollow.example"], subject: "Re: Summer?", body: "Following up", threadId: sent.threadId });

  const hits = await cmd("email.search", { target, pitchId });
  const by = (id: string) => hits.find((h: any) => h.threadId === id);
  assert.equal(by(draft.threadId).unsent.state, "draft");
  assert.equal(by(draft.threadId).messageCount, 0, "nothing sent yet");
  assert.deepEqual(by(later.threadId).unsent, { state: "scheduled", date: "2031-03-03T14:02:00.000Z", messageId: later.messageId });
  assert.equal(hits[0].threadId, later.threadId, "dated when it goes, so newest");
  assert.equal(by(sent.threadId).unsent.state, "draft");
  assert.equal(by(sent.threadId).messageCount, 1, "the draft reply isn't counted");

  // Nothing sent and no pitch: nothing to link it to yet.
  await assert.rejects(cmd("email.link", { threadId: later.threadId, target }), /is sent yet/i);
  // From the pitch: kept there, no thread made; scheduled mail has no draft id.
  assert.deepEqual(await cmd("email.link", { threadId: later.threadId, target, pitchId }), { tracked: 1 });
  assert.deepEqual(await cmd("email.link", { threadId: draft.threadId, target, pitchId }), { tracked: 1 });
  assert.deepEqual(await cmd("email.link", { threadId: draft.threadId, target, pitchId }), { tracked: 0 }, "kept once");
  const kept = (await db.get(SYS, "pitches", pitchId))!.gmailDrafts as any[];
  assert.deepEqual(kept.map((d) => [d.subject, d.draftId, !!d.scheduled]), [["Fall at Pine Hollow", "", true], ["Spring at Pine Hollow", draft.id, false]]);
  assert.equal(await db.get(SYS, "emailThreads", `${TEST_ARTIST}__${later.threadId}`), null);
  const again = await cmd("email.search", { target, pitchId });
  assert.ok(again.find((h: any) => h.threadId === later.threadId).tracked);
  // A sent thread with a draft reply: linked as always, and the reply kept.
  const linked = await cmd("email.link", { threadId: sent.threadId, target, pitchId });
  assert.ok(linked.id);
  assert.equal(linked.tracked, 1);

  // Still scheduled: left alone. Then Gmail sends it: logged with Gmail's time and taken off the pitch.
  assert.deepEqual(await cmd("email.checkDrafts", { pitchIds: [pitchId] }), { sent: 0, pending: 3, gone: 0 });
  await post(`/drafts/${later.id}/send`, { date: "2031-03-03T14:02:00.000Z" });
  assert.deepEqual(await cmd("email.checkDrafts", { pitchIds: [pitchId] }), { sent: 1, pending: 2, gone: 0 });
  const left = (await db.get(SYS, "pitches", pitchId))!.gmailDrafts as any[];
  assert.deepEqual(left.map((d) => d.subject).sort(), ["Re: Summer?", "Spring at Pine Hollow"]);
  const log = (await db.list(SYS, `pitches/${pitchId}/activity`)).filter((a) => a.type === "emailSent");
  assert.deepEqual(log.map((a) => a.gmail.subject), ["Fall at Pine Hollow"]);
});

test("email.people groups by the other party, reads title and phone from the signature, and knows contacts", async () => {
  const { venueId, contactId } = await pineHollow();
  const target = { kind: "venue", id: venueId };
  await receive({ from: "rosa@pinehollow.example", fromName: "Rosa Jackson", to: ["rudy@example.com"], subject: "Support slot", body: SIG });
  await receive({ from: "booking@pinehollow.example", to: ["rudy@example.com"], subject: "Your submission", body: "We got it." });
  await receive({ from: "stranger@elsewhere.example", to: ["rudy@example.com"], subject: "Hello", body: "Hi" });
  await cmd("email.send", { target, to: ["rosa@pinehollow.example"], subject: "Re: Support slot", body: "Great, thanks" });

  const people = await cmd("email.people", { target, q: "pinehollow.example" });
  assert.deepEqual(people.map((p: any) => p.email).sort(), ["booking@pinehollow.example", "rosa@pinehollow.example"]);
  const h = people.find((p: any) => p.email === "rosa@pinehollow.example");
  assert.deepEqual({ name: h.name, title: h.title, phone: h.phone, count: h.count, contactId: h.contactId }, { name: "Rosa Jackson", title: "Talent buyer, Pine Hollow Lounge", phone: "+13035550101", count: 2, contactId });
  const b = people.find((p: any) => p.email === "booking@pinehollow.example");
  assert.equal(b.contactId, undefined);
  assert.equal(b.title, undefined);
  assert.equal(b.count, 1);

  assert.deepEqual((await cmd("email.people", { target, q: "Rosa Jackson" })).map((p: any) => p.email), ["rosa@pinehollow.example"], "a name finds the sender");
});
