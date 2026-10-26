import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "@/server/commands/dispatch";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { registry } from "@/server/commands/registry";
import { isReadOnly } from "@/server/assistant/policy";
import { toolDefs } from "@/server/assistant/tools";
import { printQuery } from "@/lib/print";
import type { PrintOptions } from "@/schema/print";
import { toolList } from "../../mcp/tools";
import { resetEmulators, makeUser, makeArtist, TEST_ARTIST, venue } from "./helpers";

beforeEach(resetEmulators);
const bearer = (t: string) => `Bearer ${t}`;
type Out = { status: number; json: { result: any } };
const call = (tok: string, name: string, body: unknown, artist = TEST_ARTIST) => dispatch(name, bearer(tok), body, artist) as Promise<Out>;

const SAVED: PrintOptions = { copy: "band", sheets: "perSet", fields: ["key", "breaks"], titles: "short", header: false, transitions: false, paper: "a4" };
const items = [
  { type: "song", title: "One", lengthSec: 200 }, { type: "break", title: "Break", note: "Merch", lengthSec: 900 }, { type: "song", title: "Two", lengthSec: 200 },
];

async function setup() {
  await makeArtist("Ingrid Avison Band", "ingrid-avison-band");
  const jeff = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  const david = await makeUser("david@example.com", "member", { name: "David" });
  const t = await call(jeff.token, "setlistTemplates.create", { name: "Two sets", items });
  assert.equal(t.status, 200);
  return { jeff, david, templateId: t.json.result.id as string };
}

test("setlists.setPrintPrefs then setlists.printPrefs round-trips per person and per artist", async () => {
  const { jeff, david } = await setup();
  assert.deepEqual((await call(jeff.token, "setlists.printPrefs", {})).json.result, { options: null });
  const set = await call(jeff.token, "setlists.setPrintPrefs", { options: SAVED });
  assert.equal(set.status, 200);
  assert.deepEqual(set.json.result.options, SAVED);
  assert.deepEqual((await call(jeff.token, "setlists.printPrefs", {})).json.result, { options: SAVED });
  assert.deepEqual((await call(david.token, "setlists.printPrefs", {})).json.result, { options: null }, "someone else's prefs are untouched");
  // A member saves their own too.
  const mine: PrintOptions = { ...SAVED, copy: "mine", paper: "letter" };
  assert.equal((await call(david.token, "setlists.setPrintPrefs", { options: mine })).status, 200);
  assert.deepEqual((await call(david.token, "setlists.printPrefs", {})).json.result, { options: mine });
  assert.deepEqual((await call(jeff.token, "setlists.printPrefs", {})).json.result, { options: SAVED });
  // Another artist keeps its own.
  await makeArtist("Other Band", "other-band", "other-artist");
  const two = await makeUser("two@example.com", "admin", { artists: [{ artistId: TEST_ARTIST, role: "admin" }, { artistId: "other-artist", role: "admin" }] });
  await call(two.token, "setlists.setPrintPrefs", { options: SAVED }, TEST_ARTIST);
  assert.deepEqual((await call(two.token, "setlists.printPrefs", {}, "other-artist")).json.result, { options: null });
  const other = { ...SAVED, sheets: "one", paper: "letter" } as PrintOptions;
  await call(two.token, "setlists.setPrintPrefs", { options: other }, "other-artist");
  assert.deepEqual((await call(two.token, "setlists.printPrefs", {}, TEST_ARTIST)).json.result, { options: SAVED });
  assert.deepEqual((await call(two.token, "setlists.printPrefs", {}, "other-artist")).json.result, { options: other });
  // Bad options are refused.
  assert.equal((await call(jeff.token, "setlists.setPrintPrefs", { options: { ...SAVED, paper: "legal" } })).status, 400);
});

test("setlists.printLink for a template: the path mirrors the options, missing ones come from saved prefs, nothing is written", async () => {
  const { jeff, david, templateId } = await setup();
  const hist = async () => (await db.listGroup("history", (q) => q)).length;
  const before = { all: await hist(), tpl: (await db.history("setlistTemplates", templateId)).length };

  // No options and no saved prefs: the defaults (two sets, so sheets stays "one"; breaks shown).
  const d = await call(jeff.token, "setlists.printLink", { setlistId: templateId });
  assert.equal(d.status, 200);
  const dflt: PrintOptions = { copy: "band", sheets: "one", fields: ["breaks"], titles: "wrap", header: true, transitions: true, paper: "letter" };
  assert.deepEqual(d.json.result.options, dflt);
  assert.equal(d.json.result.path, `/artists/ingrid-avison-band/setlists/${templateId}/print?${printQuery(dflt)}`);
  assert.match(d.json.result.url, /^https?:\/\//);
  assert.ok((d.json.result.url as string).endsWith(d.json.result.path));

  // Passed options win and show up in the query.
  const o = await call(jeff.token, "setlists.printLink", { setlistId: templateId, sheets: "perSet", fields: ["key", "length"], titles: "short", header: false, paper: "a4" });
  const want: PrintOptions = { copy: "band", sheets: "perSet", fields: ["key", "length"], titles: "short", header: false, transitions: true, paper: "a4" };
  assert.deepEqual(o.json.result.options, want);
  const q = new URL(o.json.result.url).searchParams;
  assert.equal(q.get("sheets"), "perSet");
  assert.equal(q.get("fields"), "key,length");
  assert.equal(q.get("titles"), "short");
  assert.equal(q.get("header"), "0");
  assert.equal(q.get("paper"), "a4");
  assert.equal(o.json.result.path.split("?")[1], printQuery(want));

  // Missing ones come from the caller's saved prefs.
  await call(jeff.token, "setlists.setPrintPrefs", { options: SAVED });
  const s = await call(jeff.token, "setlists.printLink", { setlistId: templateId });
  assert.deepEqual(s.json.result.options, SAVED);
  const mixed = await call(jeff.token, "setlists.printLink", { setlistId: templateId, paper: "letter", fields: ["length"] });
  assert.deepEqual(mixed.json.result.options, { ...SAVED, paper: "letter", fields: ["length"] });
  // ...and not from someone else's.
  assert.deepEqual((await call(david.token, "setlists.printLink", { setlistId: templateId })).json.result.options, dflt);

  // Read-only: no history anywhere, the template untouched.
  assert.equal(await hist(), before.all);
  assert.equal((await db.history("setlistTemplates", templateId)).length, before.tpl);
});

test("setlists.printLink for a show points at the show's setlist id", async () => {
  const { jeff } = await setup();
  const v = await db.create(importCtx(), "venues", venue("Hi-Dive"));
  const show = await db.create(importCtx(), "shows", {
    artistId: TEST_ARTIST, date: "2026-11-14", status: "confirmed", venue: { id: v.id, name: "Hi-Dive", city: "Denver" }, times: {}, personnel: [],
    sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false }, checklists: [], docs: [], listings: {},
  });
  await db.create(importCtx(), "setlists", { items }, { id: show.id });
  const r = await call(jeff.token, "setlists.printLink", { showId: show.id, paper: "a4" });
  assert.equal(r.status, 200);
  assert.equal(r.json.result.path.split("?")[0], `/artists/ingrid-avison-band/setlists/${show.id}/print`);
  assert.equal(new URL(r.json.result.url).searchParams.get("paper"), "a4");
  assert.equal(r.json.result.options.paper, "a4");
});

test("setlists.printLink needs exactly one of setlistId and showId", async () => {
  const { jeff, templateId } = await setup();
  const none = await call(jeff.token, "setlists.printLink", {});
  assert.ok(none.status >= 400 && none.status < 500);
  const both = await call(jeff.token, "setlists.printLink", { setlistId: templateId, showId: "abc" });
  assert.ok(both.status >= 400 && both.status < 500);
  const missing = await call(jeff.token, "setlists.printLink", { setlistId: "nope" });
  assert.ok(missing.status >= 400 && missing.status < 500, "an unknown setlist is refused");
});

test("setlists.printLink is an MCP tool and a read-only Roadie tool; the prefs commands are the app's only", () => {
  assert.ok(registry["setlists.printLink"].roles.includes("mcp"));
  assert.ok(registry["setlists.printLink"].roles.includes("admin"));
  assert.ok(registry["setlists.printLink"].roles.includes("member"));
  assert.ok(toolList().some((t) => t.name === "setlists.printLink"));
  assert.ok(isReadOnly("setlists.printLink"));
  assert.ok(toolDefs("admin").some((t) => t.name === "setlists.printLink"));
  assert.equal(registry["setlists.printPrefs"].roles.includes("mcp"), false);
  assert.equal(registry["setlists.setPrintPrefs"].roles.includes("mcp"), false);
  assert.equal(isReadOnly("setlists.setPrintPrefs"), false);
});
