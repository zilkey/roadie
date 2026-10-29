import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { firestore } from "@/server/admin";
import { handleChat } from "@/server/assistant/chat";
import { answerPending, sessionFor, type Who } from "@/server/assistant/confirm";
import { execTool, missingVenueNote, toolDefs, type Emit } from "@/server/assistant/tools";
import { ensureThread, newThreadId } from "@/server/assistant/threads";
import { draftVenue, FAKE_ATRIUM, matchType, MAX_DRAFTS } from "@/server/assistant/lookup";
import { newTypeValue } from "@/server/assistant/card";
import { groupsFor, selectTools } from "@/server/assistant/toolset";
import { isAggregator, newWebTurn, socialOf } from "@/server/assistant/web";
import { script } from "@/server/assistant/script";
import { regionForCity } from "@/lib/regions";
import type { AssistantEvent } from "@/schema/assistant";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

// ---------- pure pieces ----------

const TYPES = [{ value: "bar", label: "Bar" }, { value: "club", label: "Club" }, { value: "listening", label: "Listening room" }, { value: "brewery", label: "Brewery" }, { value: "theater", label: "Theater" }, { value: "winery", label: "Winery" }];

test("a venue type said in words finds its key: the label in any case, a synonym, a band-added type; nothing fits -> undefined", () => {
  assert.equal(matchType("Listening Room", TYPES), "listening");
  assert.equal(matchType("listening room", TYPES), "listening");
  assert.equal(matchType("SoFar Sounds secret concert series", TYPES), "listening");
  assert.equal(matchType("music venue", TYPES), "club");
  assert.equal(matchType("a taproom with a stage", TYPES), "brewery");
  assert.equal(matchType("Vineyard and tasting room", TYPES), "winery");
  assert.equal(matchType("theatre", TYPES), "theater");
  assert.equal(matchType("skate park", TYPES), undefined); // "outdoor" isn't on this band's list
  assert.equal(matchType(undefined, TYPES), undefined);
});

test("social links are fields, never pages: the Instagram handle is read off the link; listing sites are not a venue's own site", () => {
  assert.deepEqual(socialOf("https://www.instagram.com/sofarfortcollins/"), { kind: "instagram", handle: "sofarfortcollins" });
  assert.deepEqual(socialOf("https://instagram.com/p/abc123/"), { kind: "instagram" });
  assert.deepEqual(socialOf("https://www.facebook.com/thelariat"), { kind: "facebook" });
  assert.equal(socialOf("https://theatriumfortcollins.com/"), undefined);
  assert.equal(isAggregator("https://www.yelp.com/biz/x"), true);
  assert.equal(isAggregator("https://theatriumfortcollins.com/"), false);
});

test("regions come from the city; out of state is always out", () => {
  assert.equal(regionForCity("Fort Collins"), "north");
  assert.equal(regionForCity("Colorado Springs", "CO"), "south");
  assert.equal(regionForCity("Austin", "TX"), "out");
  assert.equal(regionForCity("Nowhere"), undefined);
});

test("the missing-fields note says what's blank, politely, and nothing when the venue is complete", () => {
  assert.match(missingVenueNote({ name: "SoFar Fort Collins", address: { city: "Fort Collins", state: "CO" } })!, /^I couldn't find a street address, the capacity or a website for SoFar Fort Collins, so that's blank on the card; it still shows up in the city, region and type filters\./);
  assert.match(missingVenueNote({ name: "X", address: { street: "1 Main", city: "Denver", state: "CO" }, capacity: 100 })!, /couldn't find a website for X/);
  assert.equal(missingVenueNote({ name: "X", address: { street: "1 Main", city: "Denver", state: "CO" }, capacity: 100, instagram: "x" }), undefined);
});

test("every tool schema the model sees is in Gemini's subset: typed properties, required names that exist, no oneOf/const/null branches (the endpoint drops the field, then rejects the whole request)", () => {
  // The nullable id survives as a plain string with nullable; the setlist source union becomes one merged object.
  const by = Object.fromEntries(toolDefs("admin").map((t) => [t.name, t.inputJsonSchema.properties as Record<string, Js>]));
  assert.deepEqual(by["shows.setStagePlot"].stagePlotId, { type: "string", minLength: 1, nullable: true });
  assert.deepEqual(by["setlists.seed"].from, { type: "object", properties: { kind: { type: "string", enum: ["template", "show"] }, id: { type: "string", minLength: 1 } }, required: ["kind", "id"] });
  const bad: string[] = [];
  type Js = Record<string, unknown>;
  const walk = (tool: string, path: string, s: Js | undefined) => {
    if (!s) return;
    const props = s.properties as Record<string, Record<string, unknown>> | undefined;
    if (props) {
      for (const r of (s.required as string[] | undefined) ?? []) if (!(r in props)) bad.push(`${tool}${path}: required '${r}' is not a property`);
      for (const [k, v] of Object.entries(props)) {
        if (!v.type && !v.anyOf) bad.push(`${tool}${path}.${k}: no type`);
        walk(tool, `${path}.${k}`, v);
      }
    }
    // Shapes the Gemini API drops on the floor (seen 2026-10-29): oneOf, const, a null branch, an anyOf of objects.
    if (s.oneOf) bad.push(`${tool}${path}: oneOf`);
    if ("const" in s) bad.push(`${tool}${path}: const`);
    if (s.type === "null") bad.push(`${tool}${path}: type null`);
    if (Array.isArray(s.anyOf) && (s.anyOf as Js[]).every((b) => b.type === "object")) bad.push(`${tool}${path}: anyOf of objects`);
    walk(tool, `${path}[]`, s.items as Record<string, unknown> | undefined);
    for (const alt of [...((s.anyOf as Record<string, unknown>[] | undefined) ?? []), ...((s.oneOf as Record<string, unknown>[] | undefined) ?? [])]) walk(tool, `${path}|`, alt);
  };
  for (const t of toolDefs("admin")) walk(t.name, "", t.inputJsonSchema);
  assert.deepEqual(bad, []);
});

test("tool groups: a venue request gets the core and no stage plot tools; the words, the page or the last turns pull a group in", () => {
  const defs = toolDefs("admin");
  const core = selectTools(defs, groupsFor("Add SoFar as a venue in Fort Collins", [], { route: "bookingVenues" })).map((d) => d.name);
  for (const n of ["venues.draft", "venues.create", "venueTypes.add", "web.search", "tools.load", "pitches.flag", "expenses.add", "records.list", "ui.ask"]) assert.ok(core.includes(n), n);
  for (const n of ["stagePlots.create", "shows.addChecklistItem", "fans.add", "stats.pull", "songs.update"]) assert.ok(!core.includes(n), n);
  assert.ok(core.length < defs.length / 2, `${core.length} of ${defs.length}`);
  assert.deepEqual(groupsFor("add a second monitor mix to the stage plot", [], undefined), ["stagePlots"]);
  assert.deepEqual(groupsFor("add a second one", [], { route: "stagePlot", recordKind: "stagePlot", recordId: "x" }), ["stagePlots"]);
  assert.ok(groupsFor("make it 12", [{ role: "user", text: "how many inputs does the trio plot have?" }], undefined).includes("stagePlots"));
  const all = selectTools(defs, ["stagePlots", "checklists"]).map((d) => d.name);
  assert.ok(all.includes("stagePlots.create") && all.includes("shows.addChecklistItem") && !all.includes("fans.add"));
});

test("canned model: 'Add X as a venue in A and B' drafts one per city with the links in order and the quoted type; the creates follow the drafts", () => {
  const msg = 'Add SoFar as a venue in Fort Collins and Denver\n\nuse this for fort collins: https://www.instagram.com/sofarfortcollins/\n\nand this for denver: https://www.instagram.com/sofardenver/\n\nas far as type goes - write "listening room"';
  assert.deepEqual(script({ text: msg }).calls, [
    { name: "venues.draft", input: { name: "SoFar Fort Collins", city: "Fort Collins", url: "https://www.instagram.com/sofarfortcollins/", type: "listening room" } },
    { name: "venues.draft", input: { name: "SoFar Denver", city: "Denver", url: "https://www.instagram.com/sofardenver/", type: "listening room" } },
  ]);
  assert.deepEqual(script({ text: "Add The Atrium as a venue in Fort Collins" }).calls, [{ name: "venues.draft", input: { name: "The Atrium", city: "Fort Collins" } }]);
  assert.deepEqual(script({ text: 'add a new venue type option called "listening room" . literally just do that' }).calls, [{ name: "venueTypes.add", input: { label: "listening room" } }]);
  assert.deepEqual(script({ text: "add a venue type supper club" }).calls, [{ name: "venueTypes.add", input: { label: "supper club" } }]);
  const draft = { name: "The Atrium", type: "club", address: { city: "Fort Collins", state: "CO" }, region: "north" };
  const steps = [{ name: "venues.draft", input: { name: "The Atrium", city: "Fort Collins" }, output: { untrustedContent: { draft, missing: [], existing: [], next: "Call venues.create" } } }];
  assert.deepEqual(script({ text: "Add The Atrium as a venue in Fort Collins", steps }).calls, [{ name: "venues.create", input: draft }]);
  const noCity = [{ name: "venues.draft", input: { name: "The Lariat" }, output: { untrustedContent: { draft: { name: "The Lariat" }, missing: [], existing: [], next: "Ask" } } }];
  assert.match(script({ text: "Add The Lariat as a venue in ", steps: noCity }).text ?? "", /which city/);
});

// ---------- the tools, in fake mode ----------

let admin: { uid: string; token: string };
let who: Who;
let sys: Ctx;
const noop: Emit = () => {};

beforeEach(async () => {
  await resetEmulators();
  admin = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  who = { uid: admin.uid, role: "admin", name: "Jeff" };
  sys = { uid: admin.uid, role: "admin", via: "app", runId: newRunId() };
  await db.create(sys, "artists", { slug: "ingrid-avison-band", name: "Ingrid Avison Band", driveFolderId: "", links: {}, configurations: [] }, { id: TEST_ARTIST });
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
  const d = await draftVenue(s, { name: "The Atrium", city: "Fort Collins" }, w);
  const checkedAt = (d.draft.sources as { checkedAt: string }[])[0].checkedAt;
  assert.deepEqual(d.draft, {
    name: "The Atrium", type: "club", address: { street: FAKE_ATRIUM.street, city: "Fort Collins", state: "CO", zip: "80521" }, region: "north", capacity: 70, ages: "all",
    website: "https://theatriumfortcollins.com/", sources: [{ url: "https://example.com/roadie-fake-result", checkedAt }],
  });
  assert.deepEqual(d.missing, ["instagram"]);
  assert.deepEqual(d.emails, ["booking@theatriumfortcollins.com"]);
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
  await registry["venues.create"].run(sys, registry["venues.create"].input.parse(venue("The Atrium", "Fort Collins")));
  const e = await draftVenue(s, { name: "The Atrium", city: "Fort Collins" }, newWebTurn());
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
