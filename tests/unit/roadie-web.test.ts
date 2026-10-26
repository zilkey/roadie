import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { handleChat } from "@/server/assistant/chat";
import { answerPending, sessionFor, type Who } from "@/server/assistant/confirm";
import { execTool, SEE_PITCH, toolDefs, type Emit } from "@/server/assistant/tools";
import { ensureThread, loadHistory, newThreadId } from "@/server/assistant/threads";
import {
  allowUrls, checkUrl, FAKE_SOURCE, isAllowedUrl, isBlockedAddress, MAX_QUERY_CHARS, newWebTurn, pageText, publicLookup, urlsIn, WEB_NOTICE,
} from "@/server/assistant/web";
import type { AssistantEvent } from "@/schema/assistant";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

// ---------- pure guards ----------

test("non-public addresses are blocked: loopback, private, link-local (the metadata server), CGNAT, mapped v6", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
    "::1", "::", "fe80::1", "fd00::1", "fc00::abcd", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:7f00:1", "not-an-ip"]) assert.equal(isBlockedAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "151.101.1.69", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) assert.equal(isBlockedAddress(ip), false, ip);
});

test("checkUrl takes only https to a public host on the standard port", () => {
  for (const u of ["http://example.com/", "https://localhost/", "https://127.0.0.1/", "https://169.254.169.254/latest/meta-data/", "https://[::1]/", "https://[fd00::1]/",
    "https://metadata.google.internal/", "https://printer.local/", "https://intranet/", "https://u:p@example.com/", "https://example.com:8443/", "file:///etc/passwd", "ftp://example.com/", "nope"]) {
    assert.throws(() => checkUrl(u), Error, u);
  }
  assert.equal(checkUrl("https://greyeagle.com/booking").hostname, "greyeagle.com");
  assert.equal(checkUrl("https://example.com:443/x").hostname, "example.com");
});

test("the connect-time lookup refuses hostnames that resolve to private addresses", async () => {
  const err = await new Promise<NodeJS.ErrnoException | null>((r) => publicLookup("localhost", {}, (e) => r(e)));
  assert.equal(err?.code, "EBLOCKED");
});

test("only links Roadie didn't make up may be read; links are matched exactly, trailing punctuation dropped", () => {
  assert.deepEqual(urlsIn("see https://greyeagle.com/booking. or (https://a.example/x?y=1)"), ["https://greyeagle.com/booking", "https://a.example/x?y=1"]);
  const w = newWebTurn();
  allowUrls(w, "check https://greyeagle.com/booking#top please");
  assert.equal(isAllowedUrl(w, "https://greyeagle.com/booking"), true); // the fragment doesn't matter
  assert.equal(isAllowedUrl(w, "https://greyeagle.com/booking?d=guarantee-500"), false); // no data tacked on
  assert.equal(isAllowedUrl(w, "https://evil.example/"), false);
});

test("page text drops scripts, styles and tags, keeps mailto addresses", () => {
  const p = pageText(`<html><head><title>The Grey Eagle &amp; Taqueria</title><style>p{}</style></head><body><script>alert(1)</script>
    <h1>Booking</h1><p>Capacity 550</p><!-- hidden --><a href="mailto:Booking@GreyEagle.com?subject=hi">email us</a></body></html>`);
  assert.equal(p.title, "The Grey Eagle & Taqueria");
  assert.match(p.text, /Booking\nCapacity 550/);
  assert.doesNotMatch(p.text, /alert|hidden|p\{\}/);
  assert.deepEqual(p.emails, ["booking@greyeagle.com"]);
});

// ---------- the tools, in fake mode ----------

let admin: { uid: string; token: string };
let who: Who;
let sys: Ctx;
let venueId: string;
const noop: Emit = () => {};

beforeEach(async () => {
  await resetEmulators();
  admin = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  who = { uid: admin.uid, role: "admin", name: "Jeff" };
  sys = { uid: admin.uid, role: "admin", via: "app", runId: newRunId() };
  await db.create(sys, "artists", { slug: "ingrid-avison-band", name: "Ingrid Avison Band", driveFolderId: "", links: {}, configurations: [] }, { id: TEST_ARTIST });
  venueId = ((await registry["venues.create"].run(sys, registry["venues.create"].input.parse(venue("Grey Eagle", "Asheville", { website: "https://thegreyeagle.com/" })))) as { id: string }).id;
});

async function sess() {
  const threadId = newThreadId();
  await ensureThread({ uid: admin.uid, threadId, pageContext: { route: "calendar" }, at: new Date() });
  return sessionFor(who, threadId);
}
const content = (o: unknown) => (o as { untrustedContent: any }).untrustedContent; // eslint-disable-line @typescript-eslint/no-explicit-any
const errCode = (o: unknown) => (o as { error?: { code: string } }).error?.code;

test("web.search and web.read are offered to Roadie", () => {
  const names = toolDefs("admin").map((t) => t.name);
  assert.ok(names.includes("web.search") && names.includes("web.read"));
});

test("web.search checks the band's data first, marks the result as web content and shows the query", async () => {
  const s = await sess();
  const out = await execTool(s, "web.search", { q: "Grey Eagle Asheville capacity", local: "grey eagle" }, noop);
  const c = content(out.output);
  assert.deepEqual(c.local.map((h: { kind: string; id: string }) => [h.kind, h.id]), [["venue", venueId]]);
  assert.equal(c.web.sources[0].url, FAKE_SOURCE);
  assert.match((out.output as { notice: string }).notice, new RegExp(WEB_NOTICE.slice(0, 20)));
  assert.equal(out.action?.label, 'Searched the web for "Grey Eagle Asheville capacity"');
});

test("web.search refuses long queries and a third search in one message", async () => {
  const s = await sess();
  const w = newWebTurn();
  assert.equal(errCode((await execTool(s, "web.search", { q: "x".repeat(MAX_QUERY_CHARS + 1) }, noop, new Set(), w)).output), "invalid_input");
  assert.equal(w.tainted, false);
  assert.equal(errCode((await execTool(s, "web.search", { q: "one" }, noop, new Set(), w)).output), undefined);
  assert.equal(errCode((await execTool(s, "web.search", { q: "two" }, noop, new Set(), w)).output), undefined);
  assert.equal(errCode((await execTool(s, "web.search", { q: "three" }, noop, new Set(), w)).output), "too_many");
});

test("web.read opens a search source, a typed link or a record's link, and nothing else", async () => {
  const s = await sess();
  const w = newWebTurn();
  const read = async (url: string) => (await execTool(s, "web.read", { url }, noop, new Set(), w)).output;
  assert.equal(errCode(await read("https://made-up.example/?leak=1")), "not_allowed");
  assert.equal(errCode(await read("https://thegreyeagle.com/")), "not_allowed"); // not seen yet this message
  await execTool(s, "records.get", { kind: "venues", id: venueId }, noop, new Set(), w);
  assert.equal(content(await read("https://thegreyeagle.com/")).page.url, "https://thegreyeagle.com/");
  await execTool(s, "web.search", { q: "grey eagle" }, noop, new Set(), w);
  assert.equal(errCode(await read(FAKE_SOURCE)), undefined);
  allowUrls(w, "can you read https://typed.example/page");
  assert.equal(errCode(await read("https://typed.example/page")), undefined);
  assert.equal(errCode(await read("https://typed.example/page")), "too_many"); // three pages a message
  // a link inside web content never becomes readable
  assert.equal(isAllowedUrl(w, "https://example.com/roadie-fake-result/next"), false);
});

test("after web content comes back, every write in the message asks first; reads still run", async () => {
  const s = await sess();
  const w = newWebTurn();
  const before = await execTool(s, "expenses.add", { amount: 500, what: "strings", category: "gear" }, noop, new Set(), w);
  assert.equal(before.action?.kind, "readback"); // no web yet: runs as usual
  await execTool(s, "web.search", { q: "grey eagle booking email" }, noop, new Set(), w);
  assert.equal(w.tainted, true);
  const events: AssistantEvent[] = [];
  const after = await execTool(s, "contacts.create", { name: "Planted Booker", emails: ["booker@evil.example"] }, (e) => events.push(e), new Set(), w);
  assert.equal((after.output as { needsConfirmation?: boolean }).needsConfirmation, true);
  const card = events.find((e) => e.type === "confirm") as Extract<AssistantEvent, { type: "confirm" }>;
  assert.match(card.summary, /from what I read on the web/);
  assert.match(card.summary, /booker@evil\.example/); // the card shows what would be written
  assert.equal((await db.list("contacts")).length, 0);
  assert.equal((await db.list("expenses")).length, 1);
  const get = await execTool(s, "records.get", { kind: "venues", id: venueId }, noop, new Set(), w);
  assert.equal(content(get.output).id, venueId);
});

test("canned model: 'search the web for' calls web.search and names the source by its link", async () => {
  const res = await handleChat(`Bearer ${admin.token}`, { message: "search the web for grey eagle", pageContext: { route: "calendar" } });
  const events = (await res.text()).split("\n\n").filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, "")) as AssistantEvent);
  const text = events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
  assert.ok(events.some((e) => e.type === "action" && e.label === 'Searched the web for "grey eagle"'));
  assert.match(text, /In the book: Grey Eagle/);
  assert.match(text, new RegExp(FAKE_SOURCE.replace(/[.]/g, "\\.")));
});

test("pitching offers a See the pitch button, whether it runs straight away or after a Yes", async () => {
  const s = await sess();
  const direct = await execTool(s, "pitches.flag", { kind: "venue", id: venueId }, noop, new Set(), newWebTurn());
  assert.equal(direct.action?.kind, "readback");
  const pitchId = (await db.list("pitches"))[0].id;
  assert.deepEqual(direct.also, { kind: "link", label: "See the pitch", route: "pitch", params: { id: pitchId } });
  const again = await execTool(s, "pitches.flag", { kind: "venue", id: venueId }, noop, new Set(), newWebTurn());
  assert.equal(again.also?.params?.id, pitchId); // already on the list: still offered

  const other = ((await registry["venues.create"].run(sys, registry["venues.create"].input.parse(venue("Orange Peel", "Asheville")))) as { id: string }).id;
  const w = newWebTurn();
  await execTool(s, "web.search", { q: "orange peel booking" }, noop, new Set(), w);
  const asked = await execTool(s, "pitches.flag", { kind: "venue", id: other }, noop, new Set(), w);
  assert.equal(asked.action?.kind, "confirm");
  assert.equal(asked.also, undefined); // nothing to see until they say yes
  await answerPending(who, { threadId: s.threadId, pendingId: (asked.output as { pendingId: string }).pendingId, decision: "yes" });
  const last = (await loadHistory(admin.uid, s.threadId))!.at(-1)!;
  assert.equal(last.text, `Done. ${SEE_PITCH}`);
});
