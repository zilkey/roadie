// Roadie venue lookup: pure matching, schema and canned-model pieces (no database).
import { test } from "node:test";
import assert from "node:assert/strict";
import { missingVenueNote, toolDefs } from "@/server/assistant/tools";
import { matchType } from "@/server/assistant/lookup";
import { groupsFor, selectTools } from "@/server/assistant/toolset";
import { isAggregator, socialOf } from "@/server/assistant/web";
import { script } from "@/server/assistant/script";
import { regionForCity } from "@/lib/regions";

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
  assert.equal(socialOf("https://thesolarium.example/"), undefined);
  assert.equal(isAggregator("https://www.yelp.com/biz/x"), true);
  assert.equal(isAggregator("https://thesolarium.example/"), false);
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
  // "mix" also pulls releases in (a monitor mix and a record's mix share the word); the stage plot group is still there
  assert.deepEqual(groupsFor("add a second monitor mix to the stage plot", [], undefined), ["stagePlots", "releases"]);
  // "watch X" loads the acts tools (Watch is the app's word for the shortlist); a follow-up doesn't
  assert.ok(groupsFor("watch Wheelwright", [], undefined).includes("acts"));
  assert.ok(groupsFor("which acts are we watching?", [], undefined).includes("acts"));
  assert.ok(!groupsFor("send a follow-up to the Bluebird", [], undefined).includes("acts"));
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
  assert.deepEqual(script({ text: "Add The Solarium as a venue in Fort Collins" }).calls, [{ name: "venues.draft", input: { name: "The Solarium", city: "Fort Collins" } }]);
  assert.deepEqual(script({ text: 'add a new venue type option called "listening room" . literally just do that' }).calls, [{ name: "venueTypes.add", input: { label: "listening room" } }]);
  assert.deepEqual(script({ text: "add a venue type supper club" }).calls, [{ name: "venueTypes.add", input: { label: "supper club" } }]);
  const draft = { name: "The Solarium", type: "club", address: { city: "Fort Collins", state: "CO" }, region: "north" };
  const steps = [{ name: "venues.draft", input: { name: "The Solarium", city: "Fort Collins" }, output: { untrustedContent: { draft, missing: [], existing: [], next: "Call venues.create" } } }];
  assert.deepEqual(script({ text: "Add The Solarium as a venue in Fort Collins", steps }).calls, [{ name: "venues.create", input: draft }]);
  const noCity = [{ name: "venues.draft", input: { name: "The Lariat" }, output: { untrustedContent: { draft: { name: "The Lariat" }, missing: [], existing: [], next: "Ask" } } }];
  assert.match(script({ text: "Add The Lariat as a venue in ", steps: noCity }).text ?? "", /which city/);
});
