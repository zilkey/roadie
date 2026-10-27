/** Search Gmail: the signature heuristic, the query and grouping helpers, and email.search / email.people against the fake. */
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
import { signatureOf, nameFromAddress } from "@/lib/email-signature";
import { threadsQuery, groupPeople } from "@/server/commands/email";
import { isExcluded } from "@/server/assistant/policy";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

test("signatureOf: phone from any line, title from the line after the name; three real shapes and none", () => {
  assert.deepEqual(signatureOf("Dec 11 works.\n\nBest,\nHaylee Jackson\nTalent buyer, Lost Lake Lounge\n(303) 555-0101", "Haylee Jackson"),
    { phone: "(303) 555-0101", title: "Talent buyer, Lost Lake Lounge" });
  assert.deepEqual(signatureOf("Sounds good!\n\n--\nMarcus Webb\nDirector of Programming\nFox Theatre\nM: 303.555.0188\nmarcus@fox.example\nwww.fox.example", "Marcus Webb"),
    { phone: "303.555.0188", title: "Director of Programming" });
  assert.deepEqual(signatureOf("Thanks,\nDana\nDana Ortiz\nTel +1 720 555 0142\n\nOn Tue, Jeff wrote:\n> Hi\n> Jeff\n> (999) 555-0000", "Dana Ortiz"),
    { phone: "+1 720 555 0142" }, "the quoted part is not read, and a phone line is not a title");
  assert.deepEqual(signatureOf("Got it, thanks.", "Priya Shah"), {});
  assert.deepEqual(signatureOf("Got it, thanks.\nPriya Shah", ""), {}, "no display name, no title");
});

test("nameFromAddress guesses a name from the local part", () => {
  assert.equal(nameFromAddress("booking@lostlake.example"), "Booking");
  assert.equal(nameFromAddress("haylee.jackson+x@lostlake.example"), "Haylee Jackson");
});

test("the fake's search understands @domain, a display name after from:, and quoted phrases", () => {
  const m = { from: "haylee@lostlake.example", fromName: "Haylee Jackson", to: ["jeff@example.com"], cc: [], subject: "Your submission to Lost Lake Lounge", body: "Thanks" };
  assert.equal(matches("from:@lostlake.example OR to:@lostlake.example", m), true);
  assert.equal(matches("from:@other.example", m), false);
  assert.equal(matches('from:"Haylee Jackson"', m), true);
  assert.equal(matches('(from:(x@y.example) OR to:(x@y.example)) OR ("Lost Lake Lounge")', m), true);
  assert.equal(matches('from:(x@y.example) OR ("Nowhere")', m), false);
});

test("threadsQuery: contacts, domain and the text, in the shape the contract names", () => {
  assert.equal(threadsQuery({ addresses: ["a@x.example", "b@x.example"], text: '"Lost Lake"' }),
    'from:(a@x.example OR b@x.example) OR to:(a@x.example OR b@x.example) OR ("Lost Lake")');
  assert.equal(threadsQuery({ addresses: ["a@x.example"], domain: "x.example", text: "" }), "from:a@x.example OR to:a@x.example OR from:@x.example OR to:@x.example");
  assert.equal(threadsQuery({ addresses: [], text: " " }), "");
});

test("both commands are off Roadie's menu", () => {
  assert.equal(isExcluded("email.search"), true);
  assert.equal(isExcluded("email.people"), true);
});

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
  const uid = (await makeUser("jeff@example.com", "admin", { name: "Jeff Smith" })).uid;
  ctx = { uid, role: "admin", via: "app", runId: newRunId() };
  await db.create(ctx, "artists", { slug: "ingrid-avison-band", name: "Ingrid Avison Band", driveFolderId: "", links: {}, configurations: [] }, { id: TEST_ARTIST });
});

const cmd = async (name: string, input: unknown) => {
  const x = registry[name];
  return (await x.run(ctx, x.input.parse(input))) as any;
};
const receive = async (body: Record<string, unknown>) => (await (await fetch(`${gmailUrl}/messages/receive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()) as Record<string, any>;

async function lostLake() {
  const v = await cmd("venues.create", venue("Lost Lake Lounge"));
  const c = await cmd("contacts.create", { name: "Haylee Jackson", emails: ["haylee@lostlake.example"], attachTo: { kind: "venues", id: v.id } });
  return { venueId: v.id as string, contactId: c.id as string };
}
const SIG = "Dec 11 works.\n\nHaylee Jackson\nTalent buyer, Lost Lake Lounge\n(303) 555-0101";

test("email.search finds mail from the contacts and by the place's name, groups by thread, and flags linked ones", async () => {
  const { venueId } = await lostLake();
  const target = { kind: "venue", id: venueId };
  const auto = await receive({ from: "booking@lostlake.example", to: ["jeff@example.com"], subject: "Your submission to Lost Lake Lounge", body: "We got it." });
  const hay = await receive({ from: "haylee@lostlake.example", fromName: "Haylee Jackson", to: ["jeff@example.com"], subject: "Support slot", body: SIG });
  await receive({ from: "haylee@lostlake.example", fromName: "Haylee Jackson", to: ["jeff@example.com"], subject: "Support slot", body: "One more thing", threadId: hay.threadId });
  await receive({ from: "someone@else.example", to: ["jeff@example.com"], subject: "Unrelated", body: "Nothing to see" });

  const hits = await cmd("email.search", { target });
  assert.deepEqual(hits.map((h: any) => h.threadId).sort(), [auto.threadId, hay.threadId].sort());
  const h = hits.find((x: any) => x.threadId === hay.threadId);
  assert.equal(h.messageCount, 2);
  assert.equal(h.snippet, "One more thing");
  assert.deepEqual(h.participants, ["haylee@lostlake.example"]);
  assert.equal(h.linkedId, undefined);

  await cmd("email.link", { threadId: auto.threadId, target });
  const again = await cmd("email.search", { target });
  assert.ok(again.find((x: any) => x.threadId === auto.threadId).linkedId, "linked now");

  assert.equal((await cmd("email.search", { target, q: "Unrelated" })).length, 2, "typed text replaces the place's name; the contacts' mail stays");
  const only = await cmd("email.search", { target, addresses: [], q: "Unrelated" });
  assert.deepEqual(only.map((x: any) => x.subject), ["Unrelated"], "no addresses chosen: only the text");
  const dom = await cmd("email.search", { target, addresses: [], domain: "lostlake.example", q: "zzz-nothing" });
  assert.equal(dom.length, 2, "the domain chip finds the auto-reply too");
});

test("email.people groups by the other party, reads title and phone from the signature, and knows contacts", async () => {
  const { venueId, contactId } = await lostLake();
  const target = { kind: "venue", id: venueId };
  await receive({ from: "haylee@lostlake.example", fromName: "Haylee Jackson", to: ["jeff@example.com"], subject: "Support slot", body: SIG });
  await receive({ from: "booking@lostlake.example", to: ["jeff@example.com"], subject: "Your submission", body: "We got it." });
  await receive({ from: "stranger@elsewhere.example", to: ["jeff@example.com"], subject: "Hello", body: "Hi" });
  await cmd("email.send", { target, to: ["haylee@lostlake.example"], subject: "Re: Support slot", body: "Great, thanks" });

  const people = await cmd("email.people", { target, q: "lostlake.example" });
  assert.deepEqual(people.map((p: any) => p.email).sort(), ["booking@lostlake.example", "haylee@lostlake.example"]);
  const h = people.find((p: any) => p.email === "haylee@lostlake.example");
  assert.deepEqual({ name: h.name, title: h.title, phone: h.phone, count: h.count, contactId: h.contactId }, { name: "Haylee Jackson", title: "Talent buyer, Lost Lake Lounge", phone: "+13035550101", count: 2, contactId });
  const b = people.find((p: any) => p.email === "booking@lostlake.example");
  assert.equal(b.contactId, undefined);
  assert.equal(b.title, undefined);
  assert.equal(b.count, 1);

  assert.deepEqual((await cmd("email.people", { target, q: "Haylee Jackson" })).map((p: any) => p.email), ["haylee@lostlake.example"], "a name finds the sender");
});

test("groupPeople: a message to someone else is not about the person searched for", () => {
  const msg = (o: object) => ({ id: "m", threadId: "t", account: "jeff@example.com", direction: "received", from: "", fromName: "", to: ["jeff@example.com"], cc: [], subject: "", body: "", date: "2026-10-01T00:00:00Z", ...o }) as any;
  const out = groupPeople([msg({ from: "a@lostlake.example" }), msg({ from: "z@zzz.example", to: ["jeff@example.com", "a@lostlake.example"] })], "jeff@example.com", "lostlake.example", []);
  assert.deepEqual(out.map((p) => p.email), ["a@lostlake.example"]);
});
