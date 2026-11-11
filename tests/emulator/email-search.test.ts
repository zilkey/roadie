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
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

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
  ctx = { uid, role: "admin", via: "app", runId: newRunId() };
  await db.create(ctx, "artists", { slug: "nora-quill-band", name: "Nora Quill Band", driveFolderId: "", links: {}, configurations: [] }, { id: TEST_ARTIST });
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

  assert.equal((await cmd("email.search", { target, q: "Unrelated" })).length, 2, "typed text replaces the place's name; the contacts' mail stays");
  const only = await cmd("email.search", { target, addresses: [], q: "Unrelated" });
  assert.deepEqual(only.map((x: any) => x.subject), ["Unrelated"], "no addresses chosen: only the text");
  const dom = await cmd("email.search", { target, addresses: [], domain: "pinehollow.example", q: "zzz-nothing" });
  assert.equal(dom.length, 2, "the domain chip finds the auto-reply too");
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
