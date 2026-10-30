import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "@/server/commands/dispatch";
import { hiddenSections, sectionOrder } from "@/server/prefs";
import { DEFAULT_HIDDEN, MEMBER_DEFAULT_HIDDEN, hiddenFromPrefs } from "@/schema/sections";
import { firestore } from "@/server/admin";
import { toolDefs } from "@/server/assistant/tools";
import { resetEmulators, makeUser } from "./helpers";

beforeEach(resetEmulators);
const bearer = (t: string) => `Bearer ${t}`;

test("sections.setHidden: per user, idempotent, can be brought back; unknown sections are refused", async () => {
  const jeff = await makeUser("jeff@example.com", "admin");
  const david = await makeUser("david@example.com", "member");
  const call = (tok: string, name: string, body: unknown) => dispatch(name, bearer(tok), body);
  assert.deepEqual(await hiddenSections(jeff.uid, "admin"), [...DEFAULT_HIDDEN]);
  assert.equal((await call(jeff.token, "sections.setHidden", { section: "booking", hidden: true })).status, 200);
  await call(jeff.token, "sections.setHidden", { section: "booking", hidden: true });
  await call(jeff.token, "sections.setHidden", { section: "money", hidden: true });
  assert.deepEqual(await hiddenSections(jeff.uid, "admin"), [...DEFAULT_HIDDEN, "booking", "money"]);
  assert.deepEqual(await hiddenSections(david.uid, "member"), [...MEMBER_DEFAULT_HIDDEN], "someone else's menu is untouched");
  assert.equal((await call(david.token, "sections.setHidden", { section: "songs", hidden: true })).status, 200);
  const l = await call(jeff.token, "sections.hidden", {});
  assert.deepEqual((l.json as { result: { hiddenSections: string[] } }).result.hiddenSections, [...DEFAULT_HIDDEN, "booking", "money"]);
  await call(jeff.token, "sections.setHidden", { section: "booking", hidden: false });
  assert.deepEqual(await hiddenSections(jeff.uid, "admin"), [...DEFAULT_HIDDEN, "money"]);
  assert.equal((await call(jeff.token, "sections.setHidden", { section: "home", hidden: true })).status, 400);
  assert.equal((await call(jeff.token, "sections.setHidden", { section: "calendar", hidden: true })).status, 400);
});

test("Posts starts in More for an admin whose menu was saved before it existed; switching it on sticks", async () => {
  const jeff = await makeUser("jeff@example.com", "admin");
  const call = (name: string, body: unknown) => dispatch(name, bearer(jeff.token), body);
  // A menu saved before Posts: no seenSections, and Rehearsals switched on.
  await firestore().doc(`userPrefs/${jeff.uid}`).set({ uid: jeff.uid, hiddenSections: ["templates", "releases"] });
  assert.deepEqual(await hiddenSections(jeff.uid, "admin"), ["templates", "releases", "posts"]);
  await call("sections.setHidden", { section: "money", hidden: true });
  assert.deepEqual(await hiddenSections(jeff.uid, "admin"), ["templates", "releases", "posts", "money"], "another change keeps Posts in More");
  await call("sections.setHidden", { section: "posts", hidden: false });
  assert.deepEqual(await hiddenSections(jeff.uid, "admin"), ["templates", "releases", "money"]);
  assert.deepEqual(hiddenFromPrefs((await firestore().doc(`userPrefs/${jeff.uid}`).get()).data(), "admin"), ["templates", "releases", "money"], "the app reads it the same way");
  // An empty saved list is still the person's own, and Posts still starts hidden in it.
  assert.deepEqual(hiddenFromPrefs({ hiddenSections: [] }, "admin"), ["posts"]);
  assert.deepEqual(hiddenFromPrefs({ hiddenSections: [], seenSections: ["posts"] }, "admin"), []);
  // Members never get Posts, so it isn't added to theirs.
  assert.deepEqual(hiddenFromPrefs({ hiddenSections: ["money"] }, "member"), ["money"]);
});

test("Roadie is offered sections.setHidden", () => {
  assert.ok(toolDefs("admin").some((t) => t.name === "sections.setHidden"));
});

test("sections.setOrder: per user, completed with the default order, duplicates and unknown sections refused", async () => {
  const call = (tok: string, name: string, body: unknown) => dispatch(name, bearer(tok), body);
  const jeff = await makeUser("jeff@example.com", "admin");
  const david = await makeUser("david@example.com", "member");
  assert.deepEqual(await sectionOrder(jeff.uid), ["shows", "booking", "templates", "tours", "songs", "releases", "setlists", "rehearsals", "stagePlots", "money", "fans", "posts"]);
  assert.equal((await call(jeff.token, "sections.setOrder", { order: ["money", "songs"] })).status, 200);
  assert.deepEqual(await sectionOrder(jeff.uid), ["money", "songs", "shows", "booking", "templates", "tours", "releases", "setlists", "rehearsals", "stagePlots", "fans", "posts"]);
  assert.deepEqual(await sectionOrder(david.uid), ["shows", "booking", "templates", "tours", "songs", "releases", "setlists", "rehearsals", "stagePlots", "money", "fans", "posts"], "someone else's menu is untouched");
  await call(jeff.token, "sections.setHidden", { section: "booking", hidden: true });
  assert.deepEqual(await sectionOrder(jeff.uid), ["money", "songs", "shows", "booking", "templates", "tours", "releases", "setlists", "rehearsals", "stagePlots", "fans", "posts"], "hiding keeps the order");
  assert.equal((await call(jeff.token, "sections.setOrder", { order: ["money", "money"] })).status, 400);
  assert.equal((await call(jeff.token, "sections.setOrder", { order: ["home"] })).status, 400);
  assert.equal((await call(jeff.token, "sections.setOrder", { order: ["calendar"] })).status, 400);
});

test("artists.setupStatus: people, links and Google follow the artist; Dismiss is per user and per artist", async () => {
  const { makeArtist } = await import("./helpers");
  const { db } = await import("@/server/db");
  const { importCtx } = await import("@/server/ctx");
  await makeArtist("Owls", "owls");
  const jeff = await makeUser("jeff@example.com", "admin");
  const ingrid = await makeUser("ingrid@example.com", "admin");
  const david = await makeUser("david@example.com", "member");
  const status = async (tok: string) => (await dispatch("artists.setupStatus", bearer(tok), {}, "test-artist")).json as { result: { people: boolean; links: boolean; google: boolean; dismissed: boolean } };
  assert.equal((await dispatch("artists.setupStatus", bearer(david.token), {}, "test-artist")).status, 403, "admins only");
  assert.deepEqual((await status(jeff.token)).result, { people: true, links: false, google: false, dismissed: false });
  await db.update(importCtx(), "artists", "test-artist", { links: { website: "https://owls.example" } });
  assert.equal((await status(jeff.token)).result.links, true);
  await db.update(importCtx(), "artists", "test-artist", { google: { uid: jeff.uid, email: "jeff@example.com" } });
  assert.equal((await status(jeff.token)).result.google, true);
  assert.equal((await dispatch("artists.dismissSetup", bearer(jeff.token), {}, "test-artist")).status, 200);
  assert.equal((await status(jeff.token)).result.dismissed, true);
  assert.equal((await status(ingrid.token)).result.dismissed, false, "someone else's Home is untouched");
});

test("artists.setupStatus: a band of one has no people yet", async () => {
  const { makeArtist } = await import("./helpers");
  await makeArtist("Owls", "owls");
  const solo = await makeUser("solo@example.com", "admin");
  const r = (await dispatch("artists.setupStatus", bearer(solo.token), {}, "test-artist")).json as { result: { people: boolean } };
  assert.equal(r.result.people, false);
});
