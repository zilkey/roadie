import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { firestore } from "@/server/admin";
import { handleChat } from "@/server/assistant/chat";
import { answerPending, sessionFor, type Who } from "@/server/assistant/confirm";
import { execTool, toolDefs, type Emit } from "@/server/assistant/tools";
import { ensureThread, newThreadId } from "@/server/assistant/threads";
import { draftVenue, FAKE_ATRIUM, MAX_DRAFTS } from "@/server/assistant/lookup";
import { newTypeValue } from "@/server/assistant/card";
import { newWebTurn } from "@/server/assistant/web";
import type { AssistantEvent } from "@/schema/assistant";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

// ---------- pure pieces ----------


// ---------- the tools, in fake mode ----------

let admin: { uid: string; token: string };
let who: Who;
let sys: Ctx;
const noop: Emit = () => {};

beforeEach(async () => {
  await resetEmulators();
  admin = await makeUser("rudy@example.com", "admin", { name: "Rudy" });
  who = { uid: admin.uid, role: "admin", name: "Rudy" };
  sys = { uid: admin.uid, role: "admin", via: "app", runId: newRunId() };
  await db.create(sys, "artists", { slug: "nora-quill-band", name: "Nora Quill Band", driveFolderId: "", links: {}, configurations: [] }, { id: TEST_ARTIST });
});
async function sess() {
  const threadId = newThreadId();
  await ensureThread({ uid: admin.uid, threadId, pageContext: { route: "calendar" }, at: new Date() });
  return sessionFor(who, threadId);
}
const content = (o: unknown) => (o as { untrustedContent: any }).untrustedContent; // eslint-disable-line @typescript-eslint/no-explicit-any
const errCode = (o: unknown) => (o as { error?: { code: string } }).error?.code;

test("venues.draft is offered; a findable venue comes back ready for venues.create, with its sources, type and region, and what's still missing", async () => {
  assert.ok(toolDefs("admin").some((t) => t.name === "venues.draft"));
  const s = await sess();
  const w = newWebTurn();
  const d = await draftVenue(s, { name: "The Solarium", city: "Fort Collins" }, w);
  const checkedAt = (d.draft.sources as { checkedAt: string }[])[0].checkedAt;
  assert.deepEqual(d.draft, {
    name: "The Solarium", type: "club", address: { street: FAKE_ATRIUM.street, city: "Fort Collins", state: "CO", zip: "80521" }, region: "north", capacity: 70, ages: "all",
    website: "https://thesolarium.example/", sources: [{ url: "https://example.com/roadie-fake-result", checkedAt }],
  });
  assert.deepEqual(d.missing, ["instagram"]);
  assert.deepEqual(d.emails, ["booking@thesolarium.example"]);
  assert.deepEqual(d.existing, []);
  assert.match(d.next, /^Call venues\.create with `draft` exactly as it is\./);
  assert.equal(w.tainted, true);
  assert.equal(w.drafts, 1);
  // the draft validates as a venues.create input as it is
  assert.ok(registry["venues.create"].input.safeParse(d.draft).success);
});

test("an Instagram link is the instagram field and is never opened; the type the person said resolves to its key; blanks are listed", async () => {
  const s = await sess();
  const d = await draftVenue(s, { name: "SoFar Fort Collins", city: "Fort Collins", url: "https://www.instagram.com/sofarfortcollins/", type: "listening room" }, newWebTurn());
  assert.equal(d.draft.type, "listening");
  assert.equal(d.draft.instagram, "sofarfortcollins");
  assert.deepEqual(d.draft.address, { city: "Fort Collins", state: "CO" });
  assert.equal(d.draft.region, "north");
  assert.equal(d.draft.website, undefined);
  assert.deepEqual(d.missing, ["street", "capacity", "website"]);
  assert.equal(d.typeOptions, undefined);
});

test("no city and nothing found: the draft says to ask for the city; an unknown type lists the options; a venue already in the book is reported", async () => {
  const s = await sess();
  const d = await draftVenue(s, { name: "The Lariat" }, newWebTurn());
  assert.equal(d.draft.address, undefined);
  assert.match(d.next, /Ask the person which city/);
  const t = await draftVenue(s, { name: "Pelo's Deli", city: "Longmont", type: "sandwich shop" }, newWebTurn());
  assert.equal(t.draft.type, undefined);
  assert.ok(t.typeOptions!.some((o) => o.value === "listening" && o.label === "Listening room"));
  assert.match(t.next, /best guess from typeOptions/);
  await registry["venues.create"].run(sys, registry["venues.create"].input.parse(venue("The Solarium", "Fort Collins")));
  const e = await draftVenue(s, { name: "The Solarium", city: "Fort Collins" }, newWebTurn());
  assert.equal(e.existing.length, 1);
  assert.match(e.next, /already in the band's data/);
});

test(`the draft budget is ${MAX_DRAFTS} a message, separate from the two web searches; web.read refuses social pages even when the link was typed`, async () => {
  const s = await sess();
  const w = newWebTurn();
  for (let i = 0; i < MAX_DRAFTS; i++) assert.equal(errCode((await execTool(s, "venues.draft", { name: `Venue ${i}`, city: "Denver" }, noop, new Set(), w)).output), undefined);
  assert.equal(errCode((await execTool(s, "venues.draft", { name: "One more", city: "Denver" }, noop, new Set(), w)).output), "too_many");
  assert.equal(w.searches, 0);
  assert.equal(errCode((await execTool(s, "web.search", { q: "still allowed" }, noop, new Set(), w)).output), undefined);
  const out = await execTool(s, "web.read", { url: "https://www.instagram.com/sofardenver/" }, noop, new Set(), { ...w, urls: new Set(["https://www.instagram.com/sofardenver/"]) });
  assert.equal(errCode(out.output), "not_allowed");
  assert.match((out.output as { error: { message: string } }).error.message, /Instagram pages can't be read/);
});

test("a venue from the web with blanks: the card still comes, the reply says what's missing, and the message goes on to the next venue", async () => {
  const s = await sess();
  const w = newWebTurn();
  await execTool(s, "venues.draft", { name: "SoFar Denver", city: "Denver", url: "https://www.instagram.com/sofardenver/", type: "listening room" }, noop, new Set(), w);
  const events: AssistantEvent[] = [];
  const out = await execTool(s, "venues.create", { name: "SoFar Denver", type: "listening", address: { city: "Denver", state: "CO" }, region: "denver", instagram: "sofardenver" }, (e) => events.push(e), new Set(), w);
  const card = events.find((e) => e.type === "confirm") as Extract<AssistantEvent, { type: "confirm" }>;
  assert.equal(card.summary, "Add the venue SoFar Denver (from the web)");
  assert.deepEqual(card.fields!.map((f) => [f.label, f.value]), [["Name", "SoFar Denver"], ["Type", "Listening room"], ["Address", "Denver, CO"], ["Region", "Denver"], ["Instagram", "sofardenver"]]);
  assert.match(out.say!, /^I couldn't find a street address or the capacity for SoFar Denver/);
  assert.equal(out.stop, false);
  assert.match((out.output as { message: string }).message, /already says what's missing/);
});

test("a type said as its label runs without a card; one not on the list offers the list plus adding it, and that pick adds the type first", async () => {
  const s = await sess();
  const ran = await execTool(s, "venues.create", venue("Swallow Hill", "Denver", { type: "Listening Room" }), noop);
  assert.equal(ran.action?.kind, "readback");
  assert.equal((await db.list("venues")).find((v) => v.name === "Swallow Hill")!.type, "listening");
  const events: AssistantEvent[] = [];
  const asked = await execTool(s, "venues.create", venue("Pelo's Deli", "Longmont", { type: "supper club" }), (e) => events.push(e));
  const card = events.find((e) => e.type === "confirm") as Extract<AssistantEvent, { type: "confirm" }>;
  const type = card.fields!.find((f) => f.label === "Type")!;
  assert.equal(type.value, "supper club");
  assert.ok(type.options!.some((o) => o.value === "club"));
  assert.deepEqual(type.options![type.options!.length - 1], { value: newTypeValue("supper club"), label: 'Add "supper club" as a new type' });
  const pendingId = (asked.output as { pendingId: string }).pendingId;
  assert.equal((await answerPending(who, { threadId: s.threadId, pendingId, decision: "yes", picks: { type: newTypeValue("supper club") } })).status, "done");
  const made = (await db.list("venues")).find((v) => v.name === "Pelo's Deli")!;
  const types = await db.list("venueTypes");
  const added = types.find((t) => t.label === "supper club")!;
  assert.ok(added, "the type was added");
  assert.equal(made.type, added.id);
});

test("end to end with the canned model: the SoFar message makes one card per venue, says what's blank once per venue, and the saved reply carries the tool trace", async () => {
  const msg = 'Add SoFar as a venue in Fort Collins and Denver\n\nuse this for fort collins: https://www.instagram.com/sofarfortcollins/\n\nand this for denver: https://www.instagram.com/sofardenver/\n\nas far as type goes - write "listening room"';
  const res = await handleChat(`Bearer ${admin.token}`, { message: msg, pageContext: { route: "bookingVenues" } });
  const events = (await res.text()).split("\n\n").filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, "")) as AssistantEvent);
  const cards = events.filter((e) => e.type === "confirm") as Extract<AssistantEvent, { type: "confirm" }>[];
  assert.deepEqual(cards.map((c) => c.summary), ["Add the venue SoFar Fort Collins (from the web)", "Add the venue SoFar Denver (from the web)"]);
  assert.deepEqual(cards[1].fields!.map((f) => [f.label, f.value]), [["Name", "SoFar Denver"], ["Type", "Listening room"], ["Address", "Denver, CO"], ["Region", "Denver"], ["Instagram", "sofardenver"], ["Source", "https://example.com/roadie-fake-result"]]);
  const text = events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
  assert.match(text, /couldn't find a street address or the capacity for SoFar Fort Collins/);
  assert.match(text, /couldn't find a street address or the capacity for SoFar Denver/);
  assert.ok(events.some((e) => e.type === "action" && e.label === 'Looked up "SoFar Fort Collins"'));
  assert.equal((await db.list("venues")).length, 0); // nothing written before Yes
  const done = events.find((e) => e.type === "done") as Extract<AssistantEvent, { type: "done" }>;
  const saved = (await firestore().collection("assistantThreads").doc(done.threadId).collection("messages").doc(done.messageId!).get()).data()!;
  assert.deepEqual(saved.trace.map((t: { name: string; ok: boolean }) => [t.name, t.ok]), [["venues.draft", true], ["venues.draft", true], ["venues.create", true], ["venues.create", true]]);
  assert.match(saved.trace[0].input, /sofarfortcollins/);
  assert.ok(saved.trace.every((t: { ms: number }) => typeof t.ms === "number"));

  // the follow-up from the screenshot: adding a type is one call, no questions
  const res2 = await handleChat(`Bearer ${admin.token}`, { threadId: done.threadId, message: 'add a new venue type option called "supper club" . literally just do that', pageContext: { route: "bookingVenues" } });
  const events2 = (await res2.text()).split("\n\n").filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, "")) as AssistantEvent);
  assert.ok(events2.some((e) => e.type === "readback" && e.label === "Added the venue type supper club"));
  assert.ok((await db.list("venueTypes")).some((t) => t.label === "supper club"));
});
