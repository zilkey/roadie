import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "@/server/commands/dispatch";
import { hiddenSections, sectionOrder } from "@/server/prefs";
import { DEFAULT_HIDDEN, MEMBER_DEFAULT_HIDDEN, hiddenFromPrefs } from "@/schema/sections";
import { firestore } from "@/server/admin";
import { resetEmulators, makeUser } from "./helpers";

beforeEach(resetEmulators);
const bearer = (t: string) => `Bearer ${t}`;

test("sections.setHidden: per user, idempotent, can be brought back; unknown sections are refused", async () => {
  const rudy = await makeUser("rudy@example.com", "admin");
  const hugo = await makeUser("hugo@example.com", "member");
  const call = (tok: string, name: string, body: unknown) => dispatch(name, bearer(tok), body);
  assert.deepEqual(await hiddenSections(rudy.uid, "admin"), [...DEFAULT_HIDDEN]);
  assert.equal((await call(rudy.token, "sections.setHidden", { section: "booking", hidden: true })).status, 200);
  await call(rudy.token, "sections.setHidden", { section: "booking", hidden: true });
  await call(rudy.token, "sections.setHidden", { section: "money", hidden: true });
  assert.deepEqual(await hiddenSections(rudy.uid, "admin"), [...DEFAULT_HIDDEN, "booking", "money"]);
  assert.deepEqual(await hiddenSections(hugo.uid, "member"), [...MEMBER_DEFAULT_HIDDEN], "someone else's menu is untouched");
  assert.equal((await call(hugo.token, "sections.setHidden", { section: "songs", hidden: true })).status, 200);
  const l = await call(rudy.token, "sections.hidden", {});
  assert.deepEqual((l.json as { result: { hiddenSections: string[] } }).result.hiddenSections, [...DEFAULT_HIDDEN, "booking", "money"]);
  await call(rudy.token, "sections.setHidden", { section: "booking", hidden: false });
  assert.deepEqual(await hiddenSections(rudy.uid, "admin"), [...DEFAULT_HIDDEN, "money"]);
  assert.equal((await call(rudy.token, "sections.setHidden", { section: "home", hidden: true })).status, 400);
  assert.equal((await call(rudy.token, "sections.setHidden", { section: "calendar", hidden: true })).status, 400);
});

test("Posts starts in More for an admin whose menu was saved before it existed; switching it on sticks", async () => {
  const rudy = await makeUser("rudy@example.com", "admin");
  const call = (name: string, body: unknown) => dispatch(name, bearer(rudy.token), body);
  // A menu saved before Posts: no seenSections, and Rehearsals switched on.
  await firestore().doc(`userPrefs/${rudy.uid}`).set({ uid: rudy.uid, hiddenSections: ["templates", "releases"] });
  assert.deepEqual(await hiddenSections(rudy.uid, "admin"), ["templates", "releases", "contacts", "posts", "todos"]);
  await call("sections.setHidden", { section: "money", hidden: true });
  assert.deepEqual(await hiddenSections(rudy.uid, "admin"), ["templates", "releases", "contacts", "posts", "todos", "money"], "another change keeps Posts in More");
  await call("sections.setHidden", { section: "posts", hidden: false });
  assert.deepEqual(await hiddenSections(rudy.uid, "admin"), ["templates", "releases", "contacts", "todos", "money"]);
  assert.deepEqual(hiddenFromPrefs((await firestore().doc(`userPrefs/${rudy.uid}`).get()).data(), "admin"), ["templates", "releases", "contacts", "todos", "money"], "the app reads it the same way");
  // An empty saved list is still the person's own, and Posts still starts hidden in it.
  assert.deepEqual(hiddenFromPrefs({ hiddenSections: [] }, "admin"), ["contacts", "posts", "todos"]);
  assert.deepEqual(hiddenFromPrefs({ hiddenSections: [], seenSections: ["contacts", "posts", "todos"] }, "admin"), []);
  // Members never get Posts, so it isn't added to theirs.
  assert.deepEqual(hiddenFromPrefs({ hiddenSections: ["money"] }, "member"), ["money"]);
});

test("sections.setOrder: per user, completed with the default order, duplicates and unknown sections refused", async () => {
  const call = (tok: string, name: string, body: unknown) => dispatch(name, bearer(tok), body);
  const rudy = await makeUser("rudy@example.com", "admin");
  const hugo = await makeUser("hugo@example.com", "member");
  assert.deepEqual(await sectionOrder(rudy.uid), ["shows", "booking", "contacts", "templates", "tours", "songs", "releases", "setlists", "rehearsals", "stagePlots", "money", "fans", "posts", "todos"]);
  assert.equal((await call(rudy.token, "sections.setOrder", { order: ["money", "songs"] })).status, 200);
  assert.deepEqual(await sectionOrder(rudy.uid), ["money", "songs", "shows", "booking", "contacts", "templates", "tours", "releases", "setlists", "rehearsals", "stagePlots", "fans", "posts", "todos"]);
  assert.deepEqual(await sectionOrder(hugo.uid), ["shows", "booking", "contacts", "templates", "tours", "songs", "releases", "setlists", "rehearsals", "stagePlots", "money", "fans", "posts", "todos"], "someone else's menu is untouched");
  await call(rudy.token, "sections.setHidden", { section: "booking", hidden: true });
  assert.deepEqual(await sectionOrder(rudy.uid), ["money", "songs", "shows", "booking", "contacts", "templates", "tours", "releases", "setlists", "rehearsals", "stagePlots", "fans", "posts", "todos"], "hiding keeps the order");
  assert.equal((await call(rudy.token, "sections.setOrder", { order: ["money", "money"] })).status, 400);
  assert.equal((await call(rudy.token, "sections.setOrder", { order: ["home"] })).status, 400);
  assert.equal((await call(rudy.token, "sections.setOrder", { order: ["calendar"] })).status, 400);
});

test("artists.setupStatus: people, links and Google follow the artist; Dismiss is per user and per artist", async () => {
  const { makeArtist } = await import("./helpers");
  const { db } = await import("@/server/db");
  const { importCtx } = await import("@/server/ctx");
  await makeArtist("Owls", "owls");
  const rudy = await makeUser("rudy@example.com", "admin");
  const nora = await makeUser("nora@example.com", "admin");
  const hugo = await makeUser("hugo@example.com", "member");
  const status = async (tok: string) => (await dispatch("artists.setupStatus", bearer(tok), {}, "test-artist")).json as { result: { people: boolean; links: boolean; google: boolean; dismissed: boolean } };
  assert.equal((await dispatch("artists.setupStatus", bearer(hugo.token), {}, "test-artist")).status, 403, "admins only");
  assert.deepEqual((await status(rudy.token)).result, { people: true, links: false, google: false, dismissed: false });
  await db.update(importCtx(), "artists", "test-artist", { links: { website: "https://owls.example" } });
  assert.equal((await status(rudy.token)).result.links, true);
  await db.update(importCtx(), "artists", "test-artist", { google: { uid: rudy.uid, email: "rudy@example.com" } });
  assert.equal((await status(rudy.token)).result.google, true);
  assert.equal((await dispatch("artists.dismissSetup", bearer(rudy.token), {}, "test-artist")).status, 200);
  assert.equal((await status(rudy.token)).result.dismissed, true);
  assert.equal((await status(nora.token)).result.dismissed, false, "someone else's Home is untouched");
});

test("artists.setupStatus: a band of one has no people yet", async () => {
  const { makeArtist } = await import("./helpers");
  await makeArtist("Owls", "owls");
  const solo = await makeUser("solo@example.com", "admin");
  const r = (await dispatch("artists.setupStatus", bearer(solo.token), {}, "test-artist")).json as { result: { people: boolean } };
  assert.equal(r.result.people, false);
});
