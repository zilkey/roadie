/**
 * Tenancy phase 10: the path-based rules for artist data under its artist (`artists/{a}/shows/{id}`), firestore.rules. The rules
 * don't depend on the layout flag, so these docs are written straight to their nested paths (admin SDK) in either layout, and the
 * tokens carry claims as `claimsFor` makes them.
 *
 * - The role is checked in the artist the PATH names: a doc under artists/A whose own artistId says B is still A's.
 * - Every moving kind with a rule: A's admin reads it, A's member only the band kinds (and only their own payouts, expenses and
 *   availability), B's admin never.
 * - Missing docs read as "doesn't exist" for anyone with a role in that artist only.
 * - Sub-collections (show comments, tour entries, pitch comments and activity, release tracks) and History under nested records.
 * - Kinds kept top level (mcpTokens, shortcutTokens, invites, assistantThreads) have no nested rule.
 * - No client writes.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, collectionGroup, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { firestore } from "@/server/admin";
import { OWNERS, movesUnderArtist } from "@/schema/owners";
import { resetEmulators } from "./helpers";

let env: RulesTestEnvironment;
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8280").split(":");
const claims = (artists: Record<string, "admin" | "member">, musicians: Record<string, string> = {}) =>
  ({ artists, adminOf: Object.entries(artists).filter(([, r]) => r === "admin").map(([a]) => a), musicians });
const PEOPLE = {
  aAdmin: claims({ A: "admin" }),
  aMember: claims({ A: "member" }, { A: "mA" }),
  bAdmin: claims({ B: "admin" }),
  nobody: claims({}),
};
type Who = keyof typeof PEOPLE;
const as = (who: Who) => env.authenticatedContext(`uid-${who}`, PEOPLE[who]).firestore();
const live = (artistId: string, extra: Record<string, unknown> = {}) => ({ artistId, deletedAt: null, ...extra });

/** The browser reads these (a rule exists at the top level); the rest are server only. */
const BAND = ["shows", "tours", "projects", "songs", "files", "setlists", "setlistTemplates", "rehearsals", "stagePlots", "musicians"];
const OWN = ["expenses", "availability", "payouts"];
const ADMIN = ["income", "releases", "showDeals", "emailTemplates", "statSnapshots", "contacts", "venueNotes", "venueEventNotes", "actNotes", "festivalNotes",
  "editionNotes", "promoterNotes", "contactNotes", "checklistTemplates", "emailThreads", "posts", "todos", "fans", "campaigns", "pitches", "socialChecklists"];

before(async () => {
  await resetEmulators();
  env = await initializeTestEnvironment({ projectId: process.env.GCLOUD_PROJECT ?? "demo-band-tracker", firestore: { rules: readFileSync("firestore.rules", "utf8"), host, port: Number(port) } });
  const fs = firestore();
  const w = fs.bulkWriter();
  for (const a of ["A", "B"]) {
    void w.set(fs.doc(`artists/${a}`), live(a, { name: `Artist ${a}` }));
    for (const k of [...BAND, ...OWN, ...ADMIN]) void w.set(fs.doc(`artists/${a}/${k}/r1`), live(a));
    // Members' own: the member's expense, the member's musician asked / paid; and someone else's.
    void w.set(fs.doc(`artists/${a}/expenses/mine`), live(a, { userId: "uid-aMember" }));
    void w.set(fs.doc(`artists/${a}/availability/mine`), live(a, { askedMusicianIds: ["mA"] }));
    void w.set(fs.doc(`artists/${a}/payouts/mine`), live(a, { to: { musicianId: "mA" } }));
    void w.set(fs.doc(`artists/${a}/payouts/byUid`), live(a, { to: { userId: "uid-aMember" } }));
    // Sub-collections and History.
    void w.set(fs.doc(`artists/${a}/shows/r1/comments/band`), live(a, { audience: "band" }));
    void w.set(fs.doc(`artists/${a}/shows/r1/comments/admins`), live(a));
    void w.set(fs.doc(`artists/${a}/tours/r1/entries/band`), live(a, { visibility: "band" }));
    void w.set(fs.doc(`artists/${a}/tours/r1/entries/admins`), live(a, { visibility: "admins" }));
    void w.set(fs.doc(`artists/${a}/pitches/r1/comments/c1`), live(a));
    void w.set(fs.doc(`artists/${a}/pitches/r1/activity/x1`), live(a));
    void w.set(fs.doc(`artists/${a}/releases/r1/tracks/t1`), live(a, { songId: "s1" }));
    void w.set(fs.doc(`artists/${a}/shows/r1/history/000001`), { artistId: a, entity: { kind: "shows", id: "r1" }, createdAt: new Date() });
    // A kind that stays top level, written (wrongly) under the artist: no rule reads it there.
    void w.set(fs.doc(`artists/${a}/mcpTokens/h1`), live(a, { userId: "uid-aAdmin" }));
  }
  // The path decides, not the field: under A, saying B.
  void w.set(fs.doc("artists/A/shows/says-b"), live("B"));
  await w.close();
});
after(async () => { await env?.cleanup(); });

test("the test covers every kind that moves and has a browser rule", () => {
  const moving = Object.keys(OWNERS).filter(movesUnderArtist);
  // The website kinds have no browser rule: the site.* commands read and write them.
  const covered = new Set([...BAND, ...OWN, ...ADMIN, "comments", "entries", "activity", "tracks", "sites", "sitePages", "siteSources", "siteAssets", "siteVersions"]);
  assert.deepEqual(moving.filter((k) => !covered.has(k)), []);
});

test("band kinds: A's admin and member get and list A's; B's admin and a role-less person neither", async () => {
  for (const k of BAND) {
    for (const who of ["aAdmin", "aMember"] as const) {
      await assertSucceeds(getDoc(doc(as(who), `artists/A/${k}/r1`))).catch(() => assert.fail(`${who} can't get A's ${k}`));
      await assertSucceeds(getDocs(query(collection(as(who), `artists/A/${k}`), where("artistId", "==", "A"), where("deletedAt", "==", null)))).catch(() => assert.fail(`${who} can't list A's ${k}`));
    }
    for (const who of ["bAdmin", "nobody"] as const) {
      await assertFails(getDoc(doc(as(who), `artists/A/${k}/r1`))).catch(() => assert.fail(`${who} got A's ${k}`));
      await assertFails(getDocs(query(collection(as(who), `artists/A/${k}`), where("artistId", "==", "A")))).catch(() => assert.fail(`${who} listed A's ${k}`));
    }
  }
});

test("admin kinds: A's admin only", async () => {
  for (const k of ADMIN) {
    await assertSucceeds(getDoc(doc(as("aAdmin"), `artists/A/${k}/r1`))).catch(() => assert.fail(`A's admin can't get A's ${k}`));
    for (const who of ["aMember", "bAdmin", "nobody"] as const) {
      await assertFails(getDoc(doc(as(who), `artists/A/${k}/r1`))).catch(() => assert.fail(`${who} got A's ${k}`));
    }
  }
  // Path-based: an admin may even list the whole collection, since every doc in it is the artist's.
  await assertSucceeds(getDocs(collection(as("aAdmin"), "artists/A/income")));
  await assertFails(getDocs(collection(as("bAdmin"), "artists/A/income")));
});

test("members read only their own expenses, availability and payouts, in their artist", async () => {
  const m = as("aMember");
  for (const p of ["expenses/mine", "availability/mine", "payouts/mine", "payouts/byUid"]) await assertSucceeds(getDoc(doc(m, `artists/A/${p}`))).catch(() => assert.fail(p));
  for (const p of ["expenses/r1", "availability/r1", "payouts/r1"]) await assertFails(getDoc(doc(m, `artists/A/${p}`))).catch(() => assert.fail(p));
  await assertSucceeds(getDocs(query(collection(m, "artists/A/expenses"), where("artistId", "==", "A"), where("userId", "==", "uid-aMember"), where("deletedAt", "==", null))));
  await assertSucceeds(getDocs(query(collection(m, "artists/A/availability"), where("artistId", "==", "A"), where("askedMusicianIds", "array-contains", "mA"), where("deletedAt", "==", null))));
  await assertSucceeds(getDocs(query(collection(m, "artists/A/payouts"), where("artistId", "==", "A"), where("to.musicianId", "==", "mA"), where("deletedAt", "==", null))));
  await assertFails(getDocs(query(collection(m, "artists/A/payouts"), where("artistId", "==", "A"), where("deletedAt", "==", null))));
  // The same musician id means nothing in B, where they have no role.
  await assertFails(getDoc(doc(m, "artists/B/payouts/mine")));
});

test("a soft-deleted record: its artist's admin gets it, a member doesn't", async () => {
  await firestore().doc("artists/A/songs/gone").set({ artistId: "A", deletedAt: new Date() });
  await assertFails(getDoc(doc(as("aMember"), "artists/A/songs/gone")));
  await assertSucceeds(getDoc(doc(as("aAdmin"), "artists/A/songs/gone")));
  await assertSucceeds(getDocs(query(collection(as("aMember"), "artists/A/songs"), where("deletedAt", "==", null))));
});

test("the path decides: a doc under A that says B is A's", async () => {
  await assertSucceeds(getDoc(doc(as("aAdmin"), "artists/A/shows/says-b")));
  await assertFails(getDoc(doc(as("bAdmin"), "artists/A/shows/says-b")));
});

test("a missing doc reads as 'doesn't exist' only for someone with a role in that artist", async () => {
  for (const who of ["aAdmin", "aMember"] as const) {
    for (const k of ["shows", "showDeals", "setlists", "pitches", "payouts", "expenses"]) {
      const snap = await assertSucceeds(getDoc(doc(as(who), `artists/A/${k}/none`))).catch(() => assert.fail(`${who} ${k}`));
      assert.equal(snap.exists(), false);
    }
  }
  await assertFails(getDoc(doc(as("bAdmin"), "artists/A/shows/none")));
  await assertFails(getDoc(doc(as("nobody"), "artists/A/shows/none")));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "artists/A/shows/none")));
});

test("sub-collections under nested records: members see band comments and entries; pitch and release ones are admins'", async () => {
  const [admin, member, b] = [as("aAdmin"), as("aMember"), as("bAdmin")];
  await assertSucceeds(getDoc(doc(member, "artists/A/shows/r1/comments/band")));
  await assertFails(getDoc(doc(member, "artists/A/shows/r1/comments/admins")));
  await assertSucceeds(getDocs(query(collection(member, "artists/A/shows/r1/comments"), where("artistId", "==", "A"), where("audience", "==", "band"), where("deletedAt", "==", null))));
  await assertSucceeds(getDoc(doc(member, "artists/A/tours/r1/entries/band")));
  await assertFails(getDoc(doc(member, "artists/A/tours/r1/entries/admins")));
  for (const p of ["pitches/r1/comments/c1", "pitches/r1/activity/x1", "releases/r1/tracks/t1", "shows/r1/comments/admins", "tours/r1/entries/admins"]) {
    await assertSucceeds(getDoc(doc(admin, `artists/A/${p}`))).catch(() => assert.fail(`admin ${p}`));
    await assertFails(getDoc(doc(b, `artists/A/${p}`))).catch(() => assert.fail(`B ${p}`));
  }
  for (const p of ["pitches/r1/comments/c1", "pitches/r1/activity/x1", "releases/r1/tracks/t1"]) await assertFails(getDoc(doc(member, `artists/A/${p}`)));
  // Collection groups still work across the nested records (the song page's tracks; Activity's History).
  const tracks = await assertSucceeds(getDocs(query(collectionGroup(admin, "tracks"), where("artistId", "==", "A"), where("songId", "==", "s1"))));
  assert.ok(tracks.docs.some((d) => d.ref.path === "artists/A/releases/r1/tracks/t1"));
  await assertFails(getDocs(query(collectionGroup(b, "tracks"), where("artistId", "==", "A"), where("songId", "==", "s1"))));
  const hist = await assertSucceeds(getDocs(query(collectionGroup(admin, "history"), where("artistId", "==", "A"))));
  assert.ok(hist.docs.some((d) => d.ref.path === "artists/A/shows/r1/history/000001"));
  await assertFails(getDocs(query(collectionGroup(b, "history"), where("artistId", "==", "A"))));
  await assertFails(getDocs(query(collectionGroup(member, "history"), where("artistId", "==", "A"))));
});

test("kinds kept top level have no rule under the artist; nobody writes from the browser", async () => {
  await assertFails(getDoc(doc(as("aAdmin"), "artists/A/mcpTokens/h1")));
  for (const who of ["aAdmin", "aMember", "bAdmin"] as const) {
    await assertFails(setDoc(doc(as(who), "artists/A/shows/new"), live("A")));
    await assertFails(setDoc(doc(as(who), "artists/A/shows/r1/comments/new"), live("A")));
  }
});
