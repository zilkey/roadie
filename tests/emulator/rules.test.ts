import { test, before, after } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, collectionGroup, doc, getDoc, getDocs, query, setDoc, updateDoc, deleteDoc, where } from "firebase/firestore";

let env: RulesTestEnvironment;
const NOTE_COLLS = ["festivalNotes", "editionNotes", "promoterNotes", "contactNotes"];
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8280").split(":");

before(async () => {
  env = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT ?? "demo-band-tracker",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host, port: Number(port) },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    const live = { deletedAt: null };
    for (const c of ["users", "musicians", "artists", "shows", "songs", "files", "setlists", "stagePlots", "rehearsals", "venues", "contacts", "promoters",
      "festivals", "editions", "pitches", "emailTemplates", "checklistTemplates", "showDeals", "statSnapshots", "mcpTokens"]) {
      await setDoc(doc(d, c, "x"), { ...live, n: 1, ...(c === "checklistTemplates" || c === "pitches" || c === "contacts" ? { artistId: "x" } : {}) });
    }
    await setDoc(doc(d, "checklistTemplates/y"), { ...live, artistId: "y", name: "Fern Valley's" });
    await setDoc(doc(d, "pitches/y"), { ...live, artistId: "y" });
    await setDoc(doc(d, "campaigns/cx"), { ...live, artistId: "x", name: "Spring 2027", status: "active" });
    await setDoc(doc(d, "campaigns/cy"), { ...live, artistId: "y", name: "Fern Valley's push", status: "active" });
    await setDoc(doc(d, "contacts/y"), { ...live, artistId: "y", name: "Fern Valley's booker" });
    await setDoc(doc(d, "pitches/y/comments/c1"), { ...live });
    await setDoc(doc(d, "pitches/y/activity/a1"), { ...live });
    await setDoc(doc(d, "venues/gone"), { deletedAt: new Date() });
    // Private venue notes: id = {artistId}__{venueId}, one per band.
    await setDoc(doc(d, "venueNotes/x__x"), { ...live, artistId: "x", venueId: "x", loadInNotes: "x's" });
    await setDoc(doc(d, "venueNotes/y__x"), { ...live, artistId: "y", venueId: "x", loadInNotes: "y's" });
    await setDoc(doc(d, "venueNotes/x__gone"), { deletedAt: new Date(), artistId: "x", venueId: "x" });
    await setDoc(doc(d, "fans/fx"), { ...live, artistId: "x", email: "fan@example.com" });
    await setDoc(doc(d, "fans/fy"), { ...live, artistId: "y", email: "other@example.com" });
    await setDoc(doc(d, "geocodes/g1"), { lat: 1, lng: 2 });
    // Private notes on festivals, years, promoters and contacts: the same {artistId}__{entityId} shape, one per band.
    for (const c of NOTE_COLLS) {
      await setDoc(doc(d, `${c}/x__x`), { ...live, artistId: "x", notes: "x's" });
      await setDoc(doc(d, `${c}/y__x`), { ...live, artistId: "y", notes: "y's" });
      await setDoc(doc(d, `${c}/x__v/history/000001`), { ...live, runId: "r1", artistId: "x" });
    }
    // Acts (#77): the shared record, and one band's take on it ({artistId}__{actId}).
    await setDoc(doc(d, "acts/ax"), { ...live, name: "Denson", matchKey: "denson" });
    await setDoc(doc(d, "actNotes/x__ax"), { ...live, artistId: "x", actId: "ax", note: "x's" });
    await setDoc(doc(d, "actNotes/y__ax"), { ...live, artistId: "y", actId: "ax", note: "y's" });
    await setDoc(doc(d, "pitches/x/comments/c1"), { ...live });
    await setDoc(doc(d, "pitches/x/activity/a1"), { ...live });
    await setDoc(doc(d, "shows/x/comments/c1"), { ...live });
    // History entries carry the artist of the record they describe (null: the record belongs to no one artist).
    await setDoc(doc(d, "venues/x/history/000002"), { ...live, runId: "r1", artistId: null });
    await setDoc(doc(d, "pitches/x/activity/a1/history/000001"), { ...live, runId: "r1", artistId: "x" });
    await setDoc(doc(d, "venueNotes/x__v/history/000001"), { ...live, runId: "r1", artistId: "x" });
    await setDoc(doc(d, "venueNotes/y__v/history/000001"), { ...live, runId: "r1", artistId: "y" });
    await setDoc(doc(d, "venues/v/history/000001"), { ...live, runId: "r1", artistId: null });
    await setDoc(doc(d, "songs/gone"), { deletedAt: new Date() });
    await setDoc(doc(d, "availability/asked"), { ...live, askedMusicianIds: ["m-hugo"] });
    await setDoc(doc(d, "availability/other"), { ...live, askedMusicianIds: ["m-felix"] });
    await setDoc(doc(d, "shows/x/comments/band"), { ...live, audience: "band" });
    await setDoc(doc(d, "shows/x/comments/bandGone"), { deletedAt: new Date(), audience: "band" });
    await setDoc(doc(d, "ledger/old"), { ...live, kind: "payout", payeeUserId: "hugo" });
    await setDoc(doc(d, "expenses/mine"), { ...live, userId: "hugo" });
    await setDoc(doc(d, "expenses/theirs"), { ...live, userId: "felix" });
    // Money (#39): projects are the band's; income is admin-only; a payout is read by its recipient (as the user or as the player).
    await setDoc(doc(d, "projects/band"), { ...live, artistId: "x", kind: "band", name: "Band", status: "open", isDefault: true });
    await setDoc(doc(d, "projects/gone"), { deletedAt: new Date(), artistId: "x", kind: "tour", name: "Old run", status: "closed" });
    await setDoc(doc(d, "income/g"), { ...live, artistId: "x", amount: 40000, category: "guarantee", from: "Pine Hollow", projectId: "band" });
    await setDoc(doc(d, "payouts/to-hugo-user"), { ...live, artistId: "x", to: { userId: "hugo", name: "Hugo" }, kind: "pay", amount: 10000, projectId: "band" });
    await setDoc(doc(d, "payouts/to-hugo-player"), { ...live, artistId: "x", to: { musicianId: "m-hugo", name: "Hugo" }, kind: "pay", amount: 10000, projectId: "band" });
    await setDoc(doc(d, "payouts/to-felix"), { ...live, artistId: "x", to: { userId: "felix", name: "Felix" }, kind: "pay", amount: 10000, projectId: "band" });
    await setDoc(doc(d, "payouts/to-band"), { ...live, artistId: "x", to: { name: "The Moonlighters" }, kind: "split", amount: 18000, projectId: "band" });
    await setDoc(doc(d, "payouts/to-hugo-gone"), { deletedAt: new Date(), artistId: "x", to: { userId: "hugo", name: "Hugo" }, kind: "pay", amount: 1, projectId: "band" });
    await setDoc(doc(d, "unsubmittedDrafts/rudy__expenses"), { uid: "rudy", path: "expenses", values: { a: 1 } });
    await setDoc(doc(d, "unsubmittedDrafts/hugo__shows~x"), { uid: "hugo", path: "shows/x", values: { a: 2 } });
    // Driving & gas: settings on each person's users doc, the shared weekly price cache, and the server-only route cache.
    await setDoc(doc(d, "users/rudy"), { ...live, name: "Rudy", driving: { home: { address: "1 Main St", lat: 1, lng: 2 }, cars: [] } });
    await setDoc(doc(d, "users/hugo"), { ...live, name: "Hugo", driving: { cars: [{ id: "c1", name: "Fit", mpg: 34, fuelGrade: "regular" }] } });
    await setDoc(doc(d, "fuelPrices/Y05DE_EPMR"), { area: "Denver", areaKind: "metro", grade: "regular", priceMilli: 3790, week: "2026-10-19" });
    await setDoc(doc(d, "routeCache/abc123"), { oneWayMiles: 18.4 });
    await setDoc(doc(d, "stagePlotTokens/plot1"), { token: "secret-token" });
  });
});
after(async () => { await env.cleanup(); });

// Roles are per artist: the `artists` claim is {artistId: role} (the seeded artist doc is artists/x).
const admin = () => env.authenticatedContext("rudy", { artists: { x: "admin" } }).firestore();
const hugo = () => env.authenticatedContext("hugo", { artists: { x: "member" }, musicianId: "m-hugo" }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const noRole = () => env.authenticatedContext("nobody", { artists: {} }).firestore();
/** An "ai" login is never in the claim (session.ts keeps only admin/member there). */
const aiLogin = () => env.authenticatedContext("bot", { artists: {} }).firestore();
/** Before memberships, the claim was a single `role`: it no longer grants anything. */
const legacyAdmin = () => env.authenticatedContext("old", { role: "admin" }).firestore();
/** An admin of a different artist. */
const otherAdmin = () => env.authenticatedContext("olga", { artists: { y: "admin" } }).firestore();

const ALL = ["users", "musicians", "artists", "shows", "songs", "files", "setlists", "stagePlots", "rehearsals", "contacts", "promoters",
  "festivals", "editions", "pitches", "emailTemplates", "checklistTemplates", "showDeals", "statSnapshots", "mcpTokens"];
/** Readable by any signed-in admin or member of any artist (the shared venue directory). */
const SIGNED_IN_READS = ["venues"];
const MEMBER_READS = ["musicians", "artists", "shows", "songs", "files", "setlists", "stagePlots", "rehearsals", ...SIGNED_IN_READS];

test("admin reads everything, including sub-collections", async () => {
  for (const c of [...ALL, ...SIGNED_IN_READS]) await assertSucceeds(getDoc(doc(admin(), c, "x")));
  await assertSucceeds(getDoc(doc(admin(), "pitches/x/comments/c1")));
  await assertSucceeds(getDoc(doc(admin(), "pitches/x/activity/a1")));
  await assertSucceeds(getDoc(doc(admin(), "shows/x/comments/c1")));
  for (const p of ["availability/asked", "expenses/theirs", "shows/x/comments/band"]) await assertSucceeds(getDoc(doc(admin(), p)));
});

test("members read the band collections but not booking, deals, money, users", async () => {
  for (const c of [...ALL, ...SIGNED_IN_READS]) {
    const r = getDoc(doc(hugo(), c, "x"));
    await (MEMBER_READS.includes(c) ? assertSucceeds(r) : assertFails(r));
  }
  await assertFails(getDoc(doc(hugo(), "pitches/x/comments/c1")));
  await assertFails(getDoc(doc(hugo(), "shows/x/comments/c1"))); // carried-over booking talk is admin only
  await assertSucceeds(getDoc(doc(hugo(), "shows/x/comments/band"))); // the band's own comments
  await assertFails(getDoc(doc(hugo(), "shows/x/comments/bandGone")));
  await assertSucceeds(getDocs(query(collection(hugo(), "shows/x/comments"), where("audience", "==", "band"), where("deletedAt", "==", null))));
  await assertFails(getDocs(collection(hugo(), "shows/x/comments")));
  await assertSucceeds(getDocs(query(collection(hugo(), "songs"), where("deletedAt", "==", null))));
});

test("members cannot read soft-deleted shared docs", async () => {
  await assertFails(getDoc(doc(hugo(), "songs/gone")));
  await assertSucceeds(getDoc(doc(admin(), "songs/gone")));
});

test("availability: members read only where they are asked", async () => {
  await assertSucceeds(getDoc(doc(hugo(), "availability/asked")));
  await assertFails(getDoc(doc(hugo(), "availability/other")));
});

test("the old ledger is unreadable from the app, even to admins", async () => {
  await assertFails(getDoc(doc(hugo(), "ledger/old")));
  await assertFails(getDoc(doc(admin(), "ledger/old")));
});

test("expenses: members read only their own", async () => {
  await assertSucceeds(getDoc(doc(hugo(), "expenses/mine")));
  await assertFails(getDoc(doc(hugo(), "expenses/theirs")));
});

test("money: members read projects and payouts made to them, never income or anyone else's payouts", async () => {
  await assertSucceeds(getDoc(doc(hugo(), "projects/band")));
  await assertFails(getDoc(doc(hugo(), "projects/gone")));
  await assertSucceeds(getDoc(doc(admin(), "projects/gone")));
  await assertFails(getDoc(doc(hugo(), "income/g")));
  await assertSucceeds(getDoc(doc(admin(), "income/g")));
  await assertSucceeds(getDoc(doc(hugo(), "payouts/to-hugo-user")));
  await assertSucceeds(getDoc(doc(hugo(), "payouts/to-hugo-player")));
  await assertFails(getDoc(doc(hugo(), "payouts/to-felix")));
  await assertFails(getDoc(doc(hugo(), "payouts/to-band")));
  await assertFails(getDoc(doc(hugo(), "payouts/to-hugo-gone")));
  for (const id of ["to-hugo-user", "to-hugo-player", "to-felix", "to-band", "to-hugo-gone"]) await assertSucceeds(getDoc(doc(admin(), `payouts/${id}`)));
  // A member's list of their own payouts must filter on the recipient; a bare list is refused.
  await assertSucceeds(getDocs(query(collection(hugo(), "payouts"), where("to.userId", "==", "hugo"))));
  await assertSucceeds(getDocs(query(collection(hugo(), "payouts"), where("to.musicianId", "==", "m-hugo"))));
  await assertFails(getDocs(collection(hugo(), "payouts")));
  await assertFails(getDocs(collection(hugo(), "income")));
  // A member whose login has no musicianId claim still can't see a player payout to someone else.
  const noPlayer = env.authenticatedContext("sam", { artists: { x: "member" } }).firestore();
  await assertFails(getDoc(doc(noPlayer, "payouts/to-hugo-player")));
  for (const c of ["projects", "income", "payouts"]) { await assertFails(getDoc(doc(anon(), c, "band"))); await assertFails(getDoc(doc(noRole(), c, "band"))); }
});

test("signed-out, role-less and ai (AI-tools-only) logins read nothing", async () => {
  for (const c of ["musicians", "shows", "venues", "users"]) {
    await assertFails(getDoc(doc(anon(), c, "x")));
    await assertFails(getDoc(doc(noRole(), c, "x")));
  }
  for (const c of [...ALL, ...SIGNED_IN_READS]) await assertFails(getDoc(doc(aiLogin(), c, "x")));
  for (const c of [...ALL, ...SIGNED_IN_READS]) await assertFails(getDoc(doc(legacyAdmin(), c, "x")));
});

// A Google account with no band yet (session.ts "noBand": signed in, claim {artists: {}}) reads nothing of any band until it starts one.
test("noBand: signed in with empty claims reads no band data, lists nothing, and sees no one else's history", async () => {
  const fresh = () => env.authenticatedContext("new-person", { artists: {} }).firestore();
  for (const c of [...ALL, ...SIGNED_IN_READS, "venueTypes", "setlistTemplates", "availability", "expenses", "venueNotes", "fans", "ledger"]) await assertFails(getDoc(doc(fresh(), c, "x")));
  for (const c of ["users", "musicians", "artists", "shows", "venues", "pitches", "checklistTemplates"]) await assertFails(getDocs(collection(fresh(), c)));
  await assertFails(getDocs(collectionGroup(fresh(), "history")));
  await assertFails(getDoc(doc(fresh(), "users/rudy")));
  await assertFails(getDoc(doc(fresh(), "unsubmittedDrafts/rudy__expenses")));
});

test("artist docs: only that artist's members read them", async () => {
  await assertSucceeds(getDoc(doc(admin(), "artists/x")));
  await assertSucceeds(getDoc(doc(hugo(), "artists/x")));
  await assertFails(getDoc(doc(otherAdmin(), "artists/x")));
  await assertFails(getDocs(collection(admin(), "artists"))); // no listing every artist
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "artists/gone"), { deletedAt: new Date() }); });
  const goneAdmin = env.authenticatedContext("rudy", { artists: { gone: "admin" } }).firestore();
  const goneMember = env.authenticatedContext("hugo", { artists: { gone: "member" } }).firestore();
  await assertSucceeds(getDoc(doc(goneAdmin, "artists/gone")));
  await assertFails(getDoc(doc(goneMember, "artists/gone")));
});

test("several artists: your best role applies to records not yet partitioned by artist", async () => {
  const both = () => env.authenticatedContext("mia", { artists: { x: "member", y: "admin" } }).firestore();
  await assertSucceeds(getDoc(doc(both(), "venues/x")));
  await assertSucceeds(getDoc(doc(both(), "artists/x")));
  await assertFails(getDoc(doc(env.authenticatedContext("mia", { artists: { y: "member" } }).firestore(), "artists/x")));
});

test("ALL client writes are denied, even for admins", async () => {
  for (const db of [admin(), hugo(), anon()]) {
    await assertFails(setDoc(doc(db, "songs", "new"), { title: "x" }));
    await assertFails(updateDoc(doc(db, "songs", "x"), { n: 2 }));
    await assertFails(deleteDoc(doc(db, "songs", "x")));
    await assertFails(setDoc(doc(db, "expenses", "new"), { userId: "hugo" }));
    await assertFails(setDoc(doc(db, "pitches/x/comments/new"), { body: "x" }));
    await assertFails(setDoc(doc(db, "shows/x/comments/new"), { body: "x" }));
    await assertFails(setDoc(doc(db, "unlisted", "new"), { a: 1 }));
  }
});

test("userPrefs: only the owner reads their own doc; no client writes", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "userPrefs/rudy"), { uid: "rudy", hiddenSections: ["booking"] }); });
  await assertSucceeds(getDoc(doc(admin(), "userPrefs/rudy")));
  await assertFails(getDoc(doc(hugo(), "userPrefs/rudy")));
  await assertFails(getDoc(doc(anon(), "userPrefs/rudy")));
  await assertFails(setDoc(doc(admin(), "userPrefs/rudy"), { hiddenSections: [] }));
});

test("unsubmittedDrafts: only the owner reads their own; admins, members and anon cannot read someone else's; no client writes", async () => {
  await assertSucceeds(getDoc(doc(admin(), "unsubmittedDrafts/rudy__expenses")));
  await assertSucceeds(getDocs(query(collection(admin(), "unsubmittedDrafts"), where("uid", "==", "rudy"))));
  await assertSucceeds(getDoc(doc(hugo(), "unsubmittedDrafts/hugo__shows~x")));
  await assertFails(getDoc(doc(admin(), "unsubmittedDrafts/hugo__shows~x"))); // not even an admin
  await assertFails(getDoc(doc(hugo(), "unsubmittedDrafts/rudy__expenses")));
  await assertFails(getDocs(collection(hugo(), "unsubmittedDrafts"))); // a whole-collection read would include others'
  await assertFails(getDocs(query(collection(hugo(), "unsubmittedDrafts"), where("uid", "==", "rudy"))));
  await assertFails(getDoc(doc(anon(), "unsubmittedDrafts/rudy__expenses")));
  await assertFails(getDoc(doc(noRole(), "unsubmittedDrafts/rudy__expenses")));
  for (const [who, uid] of [[admin(), "rudy"], [hugo(), "hugo"]] as const) {
    await assertFails(setDoc(doc(who, `unsubmittedDrafts/${uid}__venues`), { uid, path: "venues" }));
    await assertFails(updateDoc(doc(who, uid === "rudy" ? "unsubmittedDrafts/rudy__expenses" : "unsubmittedDrafts/hugo__shows~x"), { title: "x" }));
    await assertFails(deleteDoc(doc(who, uid === "rudy" ? "unsubmittedDrafts/rudy__expenses" : "unsubmittedDrafts/hugo__shows~x")));
  }
  await assertFails(getDoc(doc(admin(), "users/rudy/drafts/show__new"))); // the old location is gone
});

test("driving settings (users/{uid}.driving): admins read everyone's, a member only their own; no client writes", async () => {
  await assertSucceeds(getDoc(doc(admin(), "users/rudy")));
  await assertSucceeds(getDoc(doc(admin(), "users/hugo"))); // admins see and edit bandmates' homes and cars (People)
  await assertSucceeds(getDoc(doc(hugo(), "users/hugo"))); // My settings
  await assertFails(getDoc(doc(hugo(), "users/rudy")));
  await assertFails(getDoc(doc(anon(), "users/rudy")));
  await assertFails(getDoc(doc(noRole(), "users/rudy")));
  await assertFails(setDoc(doc(admin(), "users/rudy"), { driving: { cars: [] } }));
  await assertFails(updateDoc(doc(hugo(), "users/hugo"), { driving: { cars: [] } }));
});

test("fuelPrices: any signed-in user reads; routeCache nobody; no client writes", async () => {
  for (const who of [admin(), hugo(), noRole(), aiLogin()]) await assertSucceeds(getDoc(doc(who, "fuelPrices/Y05DE_EPMR")));
  await assertFails(getDoc(doc(anon(), "fuelPrices/Y05DE_EPMR")));
  for (const who of [admin(), hugo(), anon()]) await assertFails(getDoc(doc(who, "routeCache/abc123")));
  // the engineer-link token is server-only: no signed-in role reads or writes it
  for (const who of [admin(), hugo(), anon()]) await assertFails(getDoc(doc(who, "stagePlotTokens/plot1")));
  await assertFails(setDoc(doc(admin(), "stagePlotTokens/plot1"), { token: "x" }));
  await assertFails(setDoc(doc(admin(), "fuelPrices/new"), { priceMilli: 1 }));
  await assertFails(deleteDoc(doc(admin(), "fuelPrices/Y05DE_EPMR")));
});

// ---------- venues: a shared directory plus private per-band notes ----------

test("checklist templates: only that artist's admins read them; lists filter by artistId", async () => {
  await assertSucceeds(getDoc(doc(admin(), "checklistTemplates/x")));
  await assertFails(getDoc(doc(admin(), "checklistTemplates/y")));
  await assertFails(getDoc(doc(hugo(), "checklistTemplates/x")));
  await assertSucceeds(getDoc(doc(otherAdmin(), "checklistTemplates/y")));
  await assertSucceeds(getDocs(query(collection(admin(), "checklistTemplates"), where("artistId", "==", "x"))));
  await assertFails(getDocs(collection(admin(), "checklistTemplates")));
});

test("fans: only that artist's admins read them; a member, another artist's admin and the geocode cache are closed; no client writes", async () => {
  await assertSucceeds(getDoc(doc(admin(), "fans/fx")));
  await assertFails(getDoc(doc(admin(), "fans/fy")));
  await assertFails(getDoc(doc(hugo(), "fans/fx")));
  await assertFails(getDoc(doc(otherAdmin(), "fans/fx")));
  await assertSucceeds(getDoc(doc(otherAdmin(), "fans/fy")));
  await assertSucceeds(getDocs(query(collection(admin(), "fans"), where("artistId", "==", "x"))));
  await assertFails(getDocs(collection(admin(), "fans")));
  for (const who of [admin(), hugo(), anon()]) await assertFails(getDoc(doc(who, "geocodes/g1")));
  for (const who of [admin(), hugo(), anon()]) await assertFails(setDoc(doc(who, "fans/new"), { artistId: "x" }));
});

test("venues: a member and an admin of another artist read the shared record; venueNotes stay with that artist's admins", async () => {
  await assertSucceeds(getDoc(doc(hugo(), "venues/x")));
  await assertFails(getDoc(doc(hugo(), "venueNotes/x__x")));
  await assertSucceeds(getDoc(doc(otherAdmin(), "venues/x")));
  await assertFails(getDoc(doc(otherAdmin(), "venueNotes/x__x")));
  await assertSucceeds(getDoc(doc(otherAdmin(), "venueNotes/y__x")));
  await assertSucceeds(getDoc(doc(admin(), "venueNotes/x__x")));
  await assertFails(getDoc(doc(admin(), "venueNotes/y__x"))); // and x's admin never sees y's
});

test("acts: a member reads the shared record; actNotes stay with that artist's admins", async () => {
  await assertSucceeds(getDoc(doc(hugo(), "acts/ax")));
  await assertSucceeds(getDoc(doc(admin(), "acts/ax")));
  await assertSucceeds(getDoc(doc(otherAdmin(), "acts/ax")));
  await assertFails(getDoc(doc(anon(), "acts/ax")));
  await assertSucceeds(getDoc(doc(admin(), "actNotes/x__ax")));
  await assertFails(getDoc(doc(hugo(), "actNotes/x__ax")));
  await assertFails(getDoc(doc(otherAdmin(), "actNotes/x__ax")));
  await assertSucceeds(getDoc(doc(otherAdmin(), "actNotes/y__ax")));
  await assertFails(getDoc(doc(admin(), "actNotes/y__ax")));
  await assertFails(getDoc(doc(noRole(), "actNotes/x__ax")));
  await assertFails(getDoc(doc(anon(), "actNotes/x__ax")));
});

test("actNotes lists must filter by artistId; acts and actNotes cannot be written from the client", async () => {
  await assertFails(getDocs(collection(admin(), "actNotes")));
  await assertSucceeds(getDocs(query(collection(admin(), "actNotes"), where("artistId", "==", "x"))));
  await assertFails(getDocs(query(collection(admin(), "actNotes"), where("artistId", "==", "y"))));
  await assertFails(getDocs(query(collection(hugo(), "actNotes"), where("artistId", "==", "x"))));
  await assertSucceeds(getDocs(collection(hugo(), "acts")));
  for (const who of [admin(), hugo()]) {
    await assertFails(setDoc(doc(who, "acts/new"), { name: "x" }));
    await assertFails(setDoc(doc(who, "actNotes/x__new"), { artistId: "x" }));
    await assertFails(deleteDoc(doc(who, "actNotes/x__ax")));
  }
});

test("venueNotes: the per-artist role decides, not the best role", async () => {
  const mia = env.authenticatedContext("mia", { artists: { x: "member", y: "admin" } }).firestore();
  await assertSucceeds(getDoc(doc(mia, "venues/x")));
  await assertFails(getDoc(doc(mia, "venueNotes/x__x"))); // admin of y does not make her an admin of x
  await assertSucceeds(getDoc(doc(mia, "venueNotes/y__x")));
});

test("venues and venueNotes: signed-out, role-less, ai and legacy-claim logins read neither", async () => {
  for (const who of [anon(), noRole(), aiLogin(), legacyAdmin()]) {
    await assertFails(getDoc(doc(who, "venues/x")));
    await assertFails(getDoc(doc(who, "venueNotes/x__x")));
  }
});

test("venues: a member cannot read a soft-deleted one, an admin can; archived notes still read for their admin", async () => {
  await assertFails(getDoc(doc(hugo(), "venues/gone")));
  await assertSucceeds(getDoc(doc(admin(), "venues/gone")));
  await assertSucceeds(getDoc(doc(admin(), "venueNotes/x__gone")));
  await assertFails(getDoc(doc(otherAdmin(), "venueNotes/x__gone")));
});

test("venueNotes lists must filter by artistId: unfiltered fails, the artist's own passes", async () => {
  await assertFails(getDocs(collection(hugo(), "venueNotes")));
  await assertFails(getDocs(collection(admin(), "venueNotes")));
  await assertSucceeds(getDocs(query(collection(admin(), "venueNotes"), where("artistId", "==", "x"))));
  await assertFails(getDocs(query(collection(admin(), "venueNotes"), where("artistId", "==", "y"))));
  await assertFails(getDocs(query(collection(hugo(), "venueNotes"), where("artistId", "==", "x"))));
  await assertSucceeds(getDocs(query(collection(hugo(), "venues"), where("deletedAt", "==", null)))); // the directory lists for members
});

test("venues and venueNotes cannot be written from the client", async () => {
  for (const db of [admin(), hugo(), otherAdmin()]) {
    await assertFails(setDoc(doc(db, "venues", "new"), { name: "x" }));
    await assertFails(updateDoc(doc(db, "venues", "x"), { capacity: 1 }));
    await assertFails(setDoc(doc(db, "venueNotes", "x__new"), { artistId: "x" }));
    await assertFails(deleteDoc(doc(db, "venueNotes", "x__x")));
  }
});

// ---------- pitches are one band's ----------

test("pitches: only that artist's admins read a pitch, its comments and its activity", async () => {
  for (const p of ["pitches/y", "pitches/y/comments/c1", "pitches/y/activity/a1"]) {
    await assertFails(getDoc(doc(admin(), p)));
    await assertSucceeds(getDoc(doc(otherAdmin(), p)));
  }
  await assertFails(getDoc(doc(otherAdmin(), "pitches/x")));
  await assertFails(getDoc(doc(legacyAdmin(), "pitches/x")));
  const mia = env.authenticatedContext("mia", { artists: { x: "member", y: "admin" } }).firestore();
  await assertFails(getDoc(doc(mia, "pitches/x"))); // the per-artist role decides, not the best role
});

test("contacts: one band's own, read only by that artist's admins (per-artist role); lists filter by artistId; no client writes", async () => {
  await assertSucceeds(getDoc(doc(admin(), "contacts/x")));
  await assertFails(getDoc(doc(admin(), "contacts/y")));
  await assertSucceeds(getDoc(doc(otherAdmin(), "contacts/y")));
  await assertFails(getDoc(doc(otherAdmin(), "contacts/x")));
  await assertFails(getDoc(doc(hugo(), "contacts/x")));
  const mia = env.authenticatedContext("mia", { artists: { x: "member", y: "admin" } }).firestore();
  await assertFails(getDoc(doc(mia, "contacts/x"))); // admin of y does not make her an admin of x
  await assertFails(getDocs(collection(admin(), "contacts")));
  await assertSucceeds(getDocs(query(collection(admin(), "contacts"), where("artistId", "==", "x"))));
  await assertFails(getDocs(query(collection(admin(), "contacts"), where("artistId", "==", "y"))));
  await assertFails(setDoc(doc(admin(), "contacts/new"), { artistId: "x", name: "Nope" }));
});

test("pitches: lists must filter by artistId", async () => {
  await assertFails(getDocs(collection(admin(), "pitches")));
  await assertSucceeds(getDocs(query(collection(admin(), "pitches"), where("artistId", "==", "x"))));
  await assertFails(getDocs(query(collection(admin(), "pitches"), where("artistId", "==", "y"))));
  await assertSucceeds(getDocs(collection(admin(), "pitches/x/comments")));
  await assertFails(getDocs(collection(otherAdmin(), "pitches/x/comments")));
});

// ---------- booking campaigns (#82) ----------

test("campaigns: only that artist's admins read; lists filter by artistId; no client writes", async () => {
  await assertSucceeds(getDoc(doc(admin(), "campaigns/cx")));
  await assertFails(getDoc(doc(admin(), "campaigns/cy")));
  await assertSucceeds(getDoc(doc(otherAdmin(), "campaigns/cy")));
  await assertFails(getDoc(doc(otherAdmin(), "campaigns/cx")));
  await assertFails(getDoc(doc(hugo(), "campaigns/cx")));
  await assertFails(getDoc(doc(anon(), "campaigns/cx")));
  const mia = env.authenticatedContext("mia", { artists: { x: "member", y: "admin" } }).firestore();
  await assertFails(getDoc(doc(mia, "campaigns/cx"))); // the per-artist role decides
  await assertFails(getDocs(collection(admin(), "campaigns")));
  await assertSucceeds(getDocs(query(collection(admin(), "campaigns"), where("artistId", "==", "x"))));
  await assertFails(setDoc(doc(admin(), "campaigns/new"), { artistId: "x", name: "Nope", status: "active" }));
  await assertFails(updateDoc(doc(admin(), "campaigns/cx"), { status: "closed" }));
  await assertFails(deleteDoc(doc(admin(), "campaigns/cx")));
});

// ---------- festivals, years, promoters, contacts: shared records plus private per-band notes ----------

test("festival, edition, promoter and contact notes: only that artist's admins read them", async () => {
  for (const c of NOTE_COLLS) {
    await assertSucceeds(getDoc(doc(admin(), `${c}/x__x`)));
    await assertFails(getDoc(doc(admin(), `${c}/y__x`)));
    await assertSucceeds(getDoc(doc(otherAdmin(), `${c}/y__x`)));
    await assertFails(getDoc(doc(otherAdmin(), `${c}/x__x`)));
    await assertFails(getDoc(doc(hugo(), `${c}/x__x`)));
    for (const who of [anon(), noRole(), aiLogin(), legacyAdmin()]) await assertFails(getDoc(doc(who, `${c}/x__x`)));
  }
});

test("festival, edition, promoter and contact notes: the per-artist role decides, not the best role", async () => {
  const mia = env.authenticatedContext("mia", { artists: { x: "member", y: "admin" } }).firestore();
  for (const c of NOTE_COLLS) {
    await assertFails(getDoc(doc(mia, `${c}/x__x`)));
    await assertSucceeds(getDoc(doc(mia, `${c}/y__x`)));
  }
});

test("festival, edition, promoter and contact notes: lists must filter by artistId", async () => {
  for (const c of NOTE_COLLS) {
    await assertFails(getDocs(collection(admin(), c)));
    await assertSucceeds(getDocs(query(collection(admin(), c), where("artistId", "==", "x"))));
    await assertFails(getDocs(query(collection(admin(), c), where("artistId", "==", "y"))));
    await assertFails(getDocs(query(collection(hugo(), c), where("artistId", "==", "x"))));
  }
});

test("festival, edition, promoter and contact notes cannot be written from the client", async () => {
  for (const db of [admin(), otherAdmin()]) {
    for (const c of NOTE_COLLS) {
      await assertFails(setDoc(doc(db, c, "x__new"), { artistId: "x" }));
      await assertFails(updateDoc(doc(db, c, "x__x"), { notes: "hacked" }));
      await assertFails(deleteDoc(doc(db, c, "x__x")));
    }
  }
});

test("history: festival, edition, promoter and contact notes entries read only for that artist's admins", async () => {
  for (const c of NOTE_COLLS) {
    await assertSucceeds(getDoc(doc(admin(), `${c}/x__v/history/000001`)));
    await assertFails(getDoc(doc(otherAdmin(), `${c}/x__v/history/000001`)));
    await assertFails(getDoc(doc(hugo(), `${c}/x__v/history/000001`)));
  }
});

// ---------- history is readable by the record's artist ----------

test("history: venueNotes entries read only for that artist's admins", async () => {
  await assertSucceeds(getDoc(doc(admin(), "venueNotes/x__v/history/000001")));
  await assertFails(getDoc(doc(otherAdmin(), "venueNotes/x__v/history/000001")));
  await assertFails(getDoc(doc(hugo(), "venueNotes/x__v/history/000001")));
  await assertSucceeds(getDoc(doc(otherAdmin(), "venueNotes/y__v/history/000001")));
});

test("history: an entry with artistId null reads for any admin, never for a member", async () => {
  await assertSucceeds(getDoc(doc(admin(), "venues/v/history/000001")));
  await assertSucceeds(getDoc(doc(otherAdmin(), "venues/v/history/000001")));
  await assertFails(getDoc(doc(hugo(), "venues/v/history/000001")));
  await assertFails(getDoc(doc(anon(), "venues/v/history/000001")));
  await assertFails(getDoc(doc(aiLogin(), "venues/v/history/000001")));
});

test("history: a pitch's nested entries follow the pitch's artist", async () => {
  await assertSucceeds(getDoc(doc(admin(), "pitches/x/activity/a1/history/000001")));
  await assertFails(getDoc(doc(otherAdmin(), "pitches/x/activity/a1/history/000001")));
});

test("history: collection-group queries must filter by artist; the other artist's admin and unfiltered queries fail", async () => {
  const group = (who: ReturnType<typeof admin>, ...c: Parameters<typeof where>[]) => getDocs(query(collectionGroup(who, "history"), ...c.map((x) => where(...x))));
  await assertSucceeds(group(admin(), ["artistId", "==", "x"]));
  await assertSucceeds(group(admin(), ["artistId", "==", null]));
  await assertFails(group(otherAdmin(), ["artistId", "==", "x"]));
  await assertSucceeds(group(otherAdmin(), ["artistId", "==", "y"]));
  await assertSucceeds(group(otherAdmin(), ["artistId", "==", null]));
  await assertFails(group(hugo(), ["artistId", "==", null]));
  await assertFails(group(hugo(), ["artistId", "==", "x"]));
  await assertFails(getDocs(collectionGroup(admin(), "history")));
  await assertFails(getDocs(collectionGroup(otherAdmin(), "history")));
  await assertFails(group(admin(), ["runId", "==", "r1"])); // a run lookup alone no longer passes: the page adds the artist filter
});

test("emailThreads: only that artist's admins read them, lists must filter by artistId, no client writes", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "emailThreads/x__t1"), { deletedAt: null, artistId: "x", threadId: "t1" });
    await setDoc(doc(ctx.firestore(), "emailThreads/y__t1"), { deletedAt: null, artistId: "y", threadId: "t1" });
  });
  await assertSucceeds(getDoc(doc(admin(), "emailThreads/x__t1")));
  await assertFails(getDoc(doc(admin(), "emailThreads/y__t1")));
  await assertSucceeds(getDoc(doc(otherAdmin(), "emailThreads/y__t1")));
  await assertFails(getDoc(doc(hugo(), "emailThreads/x__t1")));
  for (const who of [anon(), noRole(), aiLogin(), legacyAdmin()]) await assertFails(getDoc(doc(who, "emailThreads/x__t1")));
  await assertFails(getDocs(collection(admin(), "emailThreads")));
  await assertSucceeds(getDocs(query(collection(admin(), "emailThreads"), where("artistId", "==", "x"))));
  await assertFails(getDocs(query(collection(hugo(), "emailThreads"), where("artistId", "==", "x"))));
  await assertFails(setDoc(doc(admin(), "emailThreads/x__new"), { artistId: "x" }));
  await assertFails(updateDoc(doc(admin(), "emailThreads/x__t1"), { subject: "hacked" }));
  await assertFails(deleteDoc(doc(admin(), "emailThreads/x__t1")));
});

test("tours: the band reads the tour; members read only band entries and must filter on visibility; no client writes", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, "tours/t1"), { deletedAt: null, artistId: "x", name: "Mountain West", status: "planning", projectId: "band", personnel: [] });
    await setDoc(doc(d, "tours/t1/entries/drive"), { deletedAt: null, tourId: "t1", kind: "drive", date: "2026-11-05", position: 1, visibility: "band", tz: "America/Denver" });
    await setDoc(doc(d, "tours/t1/entries/option"), { deletedAt: null, tourId: "t1", kind: "option", date: "2026-11-09", position: 1, visibility: "admins", tz: "America/Denver", pitchId: "x" });
    await setDoc(doc(d, "tours/t1/entries/gone"), { deletedAt: new Date(), tourId: "t1", kind: "note", date: "2026-11-05", position: 2, visibility: "band", tz: "America/Denver", text: "x" });
  });
  await assertSucceeds(getDoc(doc(admin(), "tours/t1")));
  await assertSucceeds(getDoc(doc(hugo(), "tours/t1")));
  await assertSucceeds(getDoc(doc(admin(), "tours/t1/entries/option")));
  await assertSucceeds(getDocs(collection(admin(), "tours/t1/entries")));
  await assertSucceeds(getDoc(doc(hugo(), "tours/t1/entries/drive")));
  await assertFails(getDoc(doc(hugo(), "tours/t1/entries/option")));
  await assertFails(getDoc(doc(hugo(), "tours/t1/entries/gone")));
  await assertFails(getDocs(collection(hugo(), "tours/t1/entries")));
  await assertSucceeds(getDocs(query(collection(hugo(), "tours/t1/entries"), where("visibility", "==", "band"), where("deletedAt", "==", null))));
  for (const c of [anon(), noRole(), aiLogin()]) await assertFails(getDoc(doc(c, "tours/t1")));
  await assertFails(setDoc(doc(admin(), "tours/t2"), { name: "x" }));
  await assertFails(updateDoc(doc(admin(), "tours/t1/entries/drive"), { position: 2 }));
});
