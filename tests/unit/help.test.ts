import { test } from "node:test";
import assert from "node:assert/strict";
import { HELP_TOPICS, helpTopic, topicForPage, topicInWords } from "@/lib/help";
import { registry } from "@/server/commands/registry";
import { script } from "@/server/assistant/script";
import { needsConfirm, isEligible } from "@/server/assistant/policy";
import { routeNames } from "@/lib/routes";
import type { Ctx } from "@/server/ctx";

const ASKED = ["upcomingShows", "playedShows", "canceledShows", "droppedShows", "booking", "pitch", "pitchStatuses", "venueSharing", "songs", "setlists", "income", "expenses", "payouts", "projects", "checklists", "customFields", "setlistTemplates", "rehearsals", "albums", "albumPage", "albumMoney", "albumFiles", "albumTrack"];

test("help: every asked-for topic exists, has text, and links only to real topics", () => {
  const ids = new Set(HELP_TOPICS.map((t) => t.id));
  assert.equal(ids.size, HELP_TOPICS.length, "ids are unique");
  for (const id of ASKED) assert.ok(ids.has(id), id);
  for (const t of HELP_TOPICS) {
    assert.ok(t.title && t.text.length > 80, t.id);
    for (const r of t.related) assert.ok(ids.has(r), `${t.id} -> ${r}`);
  }
});

test("help: a page maps to its topic, the tab decides on Shows and a show", () => {
  const at = (route: string, tab?: string) => topicForPage(route, tab)?.id;
  assert.equal(at("shows"), "upcomingShows");
  assert.equal(at("shows", "played"), "playedShows");
  assert.equal(at("shows", "canceled"), "canceledShows");
  assert.equal(at("shows", "dropped"), "droppedShows");
  assert.equal(at("show"), "showPage");
  assert.equal(at("show", "setlist"), "setlists");
  assert.equal(at("show", "finances"), "income");
  assert.equal(at("booking"), "pitch");
  assert.equal(at("bookingVenues"), "booking");
  assert.equal(at("bookingPitches"), "pitch");
  assert.equal(at("venue"), "venueSharing");
  assert.equal(at("setlists"), "setlistTemplates");
  assert.equal(at("rehearsal"), "rehearsals");
  assert.equal(at("fields"), "customFields");
  assert.equal(at("calendar"), undefined);
  for (const r of routeNames) { const t = topicForPage(r); if (t) assert.ok(helpTopic(t.id)); }
});

test("help: topics named in words", () => {
  const w = (s: string) => topicInWords(s)?.id;
  assert.equal(w("what's a pitch?"), "pitch");
  assert.equal(w("explain the pitch statuses"), "pitchStatuses");
  assert.equal(w("what does declined mean"), "pitchStatuses");
  assert.equal(w("what on a venue is shared with every band"), "venueSharing");
  assert.equal(w("what's the little flag"), "booking");
  assert.equal(w("tell me about setlist templates"), "setlistTemplates");
  assert.equal(w("how do custom fields work"), "customFields");
  assert.equal(w("what does dropped mean"), "droppedShows");
  assert.equal(w("what is a project"), "projects");
  assert.equal(w("how do payouts work"), "payouts");
  assert.equal(w("what does owed to us mean"), "income");
});

const ctx: Ctx = { uid: "u1", role: "admin", via: "app", runId: "r1" };
const explain = (i: unknown) => registry["help.explain"].run(ctx, registry["help.explain"].input.parse(i)) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test("help.explain: by topic, by page, and the topic list when nothing fits", async () => {
  assert.equal((await explain({ topic: "pitch" })).topic.id, "pitch");
  const played = await explain({ route: "shows", tab: "played" });
  assert.equal(played.topic.id, "playedShows");
  assert.ok(played.topic.related.every((r: { id: string; title: string }) => r.title));
  const none = await explain({ route: "calendar" });
  assert.equal(none.topic, null);
  assert.equal(none.topics.length, HELP_TOPICS.length);
  assert.throws(() => registry["help.explain"].input.parse({ topic: "nope" }));
});

test("help.explain: Roadie may call it without asking", () => {
  assert.equal(isEligible("help.explain", "admin"), true);
  assert.equal(needsConfirm("help.explain", {}), false);
});

test("script: 'explain this page' asks help.explain for the page; a named idea passes its topic", () => {
  for (const t of ["explain this page", "Explain this page to me", "what am I looking at?", "what's this page?"])
    assert.deepEqual(script({ text: t }).calls, [{ name: "help.explain", input: {} }], t);
  assert.deepEqual(script({ text: "what's a pitch?" }).calls, [{ name: "help.explain", input: { topic: "pitch" } }]);
  assert.deepEqual(script({ text: "explain the pitch statuses" }).calls, [{ name: "help.explain", input: { topic: "pitchStatuses" } }]);
  assert.deepEqual(script({ text: "what on a venue is shared with every band?" }).calls, [{ name: "help.explain", input: { topic: "venueSharing" } }]);
  // Data questions still go to the data.
  assert.equal(script({ text: "what shows are coming up" }).calls?.[0].name, "shows.list");
});

test("script: reads back the topic text, or the list when the page has none", () => {
  const text = helpTopic("pitch")!.text;
  const said = script({ text: "explain this page", steps: [{ name: "help.explain", input: {}, output: { untrustedContent: { topic: { id: "pitch", title: "Pitch", text, related: [] } } } }] });
  assert.equal(said.text, text);
  const none = script({ text: "explain this page", steps: [{ name: "help.explain", input: {}, output: { untrustedContent: { topic: null, topics: [{ id: "pitch", title: "Pitches" }] } } }] });
  assert.match(none.text!, /Pitches/);
});
