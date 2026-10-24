import { test, before, after } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, collectionGroup, doc, getDoc, getDocs, query, setDoc, updateDoc, deleteDoc, where } from "firebase/firestore";

let env: RulesTestEnvironment;
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8280").split(":");

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-band-tracker",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host, port: Number(port) },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    const live = { deletedAt: null };
    for (const c of ["users", "musicians", "artists", "shows", "songs", "files", "setlists", "rehearsals", "venues", "contacts", "promoters",
      "festivals", "editions", "pitches", "emailTemplates", "checklistTemplates", "showDeals", "statSnapshots", "mcpTokens"]) {
      await setDoc(doc(d, c, "x"), { ...live, n: 1 });
    }
    await setDoc(doc(d, "venues/gone"), { deletedAt: new Date() });
    // Private venue notes: id = {artistId}__{venueId}, one per band.
    await setDoc(doc(d, "venueNotes/x__x"), { ...live, artistId: "x", venueId: "x", loadInNotes: "x's" });
    await setDoc(doc(d, "venueNotes/y__x"), { ...live, artistId: "y", venueId: "x", loadInNotes: "y's" });
    await setDoc(doc(d, "venueNotes/x__gone"), { deletedAt: new Date(), artistId: "x", venueId: "x" });
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
    await setDoc(doc(d, "availability/asked"), { ...live, askedMusicianIds: ["m-david"] });
    await setDoc(doc(d, "availability/other"), { ...live, askedMusicianIds: ["m-eric"] });
    await setDoc(doc(d, "shows/x/comments/band"), { ...live, audience: "band" });
    await setDoc(doc(d, "shows/x/comments/bandGone"), { deletedAt: new Date(), audience: "band" });
    await setDoc(doc(d, "ledger/old"), { ...live, kind: "payout", payeeUserId: "david" });
    await setDoc(doc(d, "expenses/mine"), { ...live, userId: "david" });
    await setDoc(doc(d, "expenses/theirs"), { ...live, userId: "eric" });
    await setDoc(doc(d, "unsubmittedDrafts/jeff__expenses"), { uid: "jeff", path: "expenses", values: { a: 1 } });
    await setDoc(doc(d, "unsubmittedDrafts/david__shows~x"), { uid: "david", path: "shows/x", values: { a: 2 } });
  });
});
after(async () => { await env.cleanup(); });

// Roles are per artist: the `artists` claim is {artistId: role} (the seeded artist doc is artists/x).
const admin = () => env.authenticatedContext("jeff", { artists: { x: "admin" } }).firestore();
const david = () => env.authenticatedContext("david", { artists: { x: "member" }, musicianId: "m-david" }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const noRole = () => env.authenticatedContext("nobody", { artists: {} }).firestore();
/** An "ai" login is never in the claim (session.ts keeps only admin/member there). */
const aiLogin = () => env.authenticatedContext("bot", { artists: {} }).firestore();
/** Before memberships, the claim was a single `role`: it no longer grants anything. */
const legacyAdmin = () => env.authenticatedContext("old", { role: "admin" }).firestore();
/** An admin of a different artist. */
const otherAdmin = () => env.authenticatedContext("olga", { artists: { y: "admin" } }).firestore();

const ALL = ["users", "musicians", "artists", "shows", "songs", "files", "setlists", "rehearsals", "contacts", "promoters",
  "festivals", "editions", "pitches", "emailTemplates", "checklistTemplates", "showDeals", "statSnapshots", "mcpTokens"];
/** Readable by any signed-in admin or member of any artist (the shared venue directory). */
const SIGNED_IN_READS = ["venues"];
const MEMBER_READS = ["musicians", "artists", "shows", "songs", "files", "setlists", "rehearsals", ...SIGNED_IN_READS];

test("admin reads everything, including sub-collections", async () => {
  for (const c of [...ALL, ...SIGNED_IN_READS]) await assertSucceeds(getDoc(doc(admin(), c, "x")));
  await assertSucceeds(getDoc(doc(admin(), "pitches/x/comments/c1")));
  await assertSucceeds(getDoc(doc(admin(), "pitches/x/activity/a1")));
  await assertSucceeds(getDoc(doc(admin(), "shows/x/comments/c1")));
  for (const p of ["availability/asked", "expenses/theirs", "shows/x/comments/band"]) await assertSucceeds(getDoc(doc(admin(), p)));
});

test("members read the band collections but not booking, deals, money, users", async () => {
  for (const c of [...ALL, ...SIGNED_IN_READS]) {
    const r = getDoc(doc(david(), c, "x"));
    await (MEMBER_READS.includes(c) ? assertSucceeds(r) : assertFails(r));
  }
  await assertFails(getDoc(doc(david(), "pitches/x/comments/c1")));
  await assertFails(getDoc(doc(david(), "shows/x/comments/c1"))); // carried-over booking talk is admin only
  await assertSucceeds(getDoc(doc(david(), "shows/x/comments/band"))); // the band's own comments
  await assertFails(getDoc(doc(david(), "shows/x/comments/bandGone")));
  await assertSucceeds(getDocs(query(collection(david(), "shows/x/comments"), where("audience", "==", "band"), where("deletedAt", "==", null))));
  await assertFails(getDocs(collection(david(), "shows/x/comments")));
  await assertSucceeds(getDocs(query(collection(david(), "songs"), where("deletedAt", "==", null))));
});

test("members cannot read soft-deleted shared docs", async () => {
  await assertFails(getDoc(doc(david(), "songs/gone")));
  await assertSucceeds(getDoc(doc(admin(), "songs/gone")));
});

test("availability: members read only where they are asked", async () => {
  await assertSucceeds(getDoc(doc(david(), "availability/asked")));
  await assertFails(getDoc(doc(david(), "availability/other")));
});

test("the old ledger is unreadable from the app, even to admins", async () => {
  await assertFails(getDoc(doc(david(), "ledger/old")));
  await assertFails(getDoc(doc(admin(), "ledger/old")));
});

test("expenses: members read only their own", async () => {
  await assertSucceeds(getDoc(doc(david(), "expenses/mine")));
  await assertFails(getDoc(doc(david(), "expenses/theirs")));
});

test("signed-out, role-less and ai (AI-tools-only) logins read nothing", async () => {
  for (const c of ["musicians", "shows", "venues", "users"]) {
    await assertFails(getDoc(doc(anon(), c, "x")));
    await assertFails(getDoc(doc(noRole(), c, "x")));
  }
  for (const c of [...ALL, ...SIGNED_IN_READS]) await assertFails(getDoc(doc(aiLogin(), c, "x")));
  for (const c of [...ALL, ...SIGNED_IN_READS]) await assertFails(getDoc(doc(legacyAdmin(), c, "x")));
});

test("artist docs: only that artist's members read them", async () => {
  await assertSucceeds(getDoc(doc(admin(), "artists/x")));
  await assertSucceeds(getDoc(doc(david(), "artists/x")));
  await assertFails(getDoc(doc(otherAdmin(), "artists/x")));
  await assertFails(getDocs(collection(admin(), "artists"))); // no listing every artist
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "artists/gone"), { deletedAt: new Date() }); });
  const goneAdmin = env.authenticatedContext("jeff", { artists: { gone: "admin" } }).firestore();
  const goneMember = env.authenticatedContext("david", { artists: { gone: "member" } }).firestore();
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
  for (const db of [admin(), david(), anon()]) {
    await assertFails(setDoc(doc(db, "songs", "new"), { title: "x" }));
    await assertFails(updateDoc(doc(db, "songs", "x"), { n: 2 }));
    await assertFails(deleteDoc(doc(db, "songs", "x")));
    await assertFails(setDoc(doc(db, "expenses", "new"), { userId: "david" }));
    await assertFails(setDoc(doc(db, "pitches/x/comments/new"), { body: "x" }));
    await assertFails(setDoc(doc(db, "shows/x/comments/new"), { body: "x" }));
    await assertFails(setDoc(doc(db, "unlisted", "new"), { a: 1 }));
  }
});

test("userPrefs: only the owner reads their own doc; no client writes", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "userPrefs/jeff"), { uid: "jeff", hiddenSections: ["booking"] }); });
  await assertSucceeds(getDoc(doc(admin(), "userPrefs/jeff")));
  await assertFails(getDoc(doc(david(), "userPrefs/jeff")));
  await assertFails(getDoc(doc(anon(), "userPrefs/jeff")));
  await assertFails(setDoc(doc(admin(), "userPrefs/jeff"), { hiddenSections: [] }));
});

test("unsubmittedDrafts: only the owner reads their own; admins, members and anon cannot read someone else's; no client writes", async () => {
  await assertSucceeds(getDoc(doc(admin(), "unsubmittedDrafts/jeff__expenses")));
  await assertSucceeds(getDocs(query(collection(admin(), "unsubmittedDrafts"), where("uid", "==", "jeff"))));
  await assertSucceeds(getDoc(doc(david(), "unsubmittedDrafts/david__shows~x")));
  await assertFails(getDoc(doc(admin(), "unsubmittedDrafts/david__shows~x"))); // not even an admin
  await assertFails(getDoc(doc(david(), "unsubmittedDrafts/jeff__expenses")));
  await assertFails(getDocs(collection(david(), "unsubmittedDrafts"))); // a whole-collection read would include others'
  await assertFails(getDocs(query(collection(david(), "unsubmittedDrafts"), where("uid", "==", "jeff"))));
  await assertFails(getDoc(doc(anon(), "unsubmittedDrafts/jeff__expenses")));
  await assertFails(getDoc(doc(noRole(), "unsubmittedDrafts/jeff__expenses")));
  for (const [who, uid] of [[admin(), "jeff"], [david(), "david"]] as const) {
    await assertFails(setDoc(doc(who, `unsubmittedDrafts/${uid}__venues`), { uid, path: "venues" }));
    await assertFails(updateDoc(doc(who, uid === "jeff" ? "unsubmittedDrafts/jeff__expenses" : "unsubmittedDrafts/david__shows~x"), { title: "x" }));
    await assertFails(deleteDoc(doc(who, uid === "jeff" ? "unsubmittedDrafts/jeff__expenses" : "unsubmittedDrafts/david__shows~x")));
  }
  await assertFails(getDoc(doc(admin(), "users/jeff/drafts/show__new"))); // the old location is gone
});

// ---------- venues: a shared directory plus private per-band notes ----------

test("venues: a member and an admin of another artist read the shared record; venueNotes stay with that artist's admins", async () => {
  await assertSucceeds(getDoc(doc(david(), "venues/x")));
  await assertFails(getDoc(doc(david(), "venueNotes/x__x")));
  await assertSucceeds(getDoc(doc(otherAdmin(), "venues/x")));
  await assertFails(getDoc(doc(otherAdmin(), "venueNotes/x__x")));
  await assertSucceeds(getDoc(doc(otherAdmin(), "venueNotes/y__x")));
  await assertSucceeds(getDoc(doc(admin(), "venueNotes/x__x")));
  await assertFails(getDoc(doc(admin(), "venueNotes/y__x"))); // and x's admin never sees y's
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
  await assertFails(getDoc(doc(david(), "venues/gone")));
  await assertSucceeds(getDoc(doc(admin(), "venues/gone")));
  await assertSucceeds(getDoc(doc(admin(), "venueNotes/x__gone")));
  await assertFails(getDoc(doc(otherAdmin(), "venueNotes/x__gone")));
});

test("venueNotes lists must filter by artistId: unfiltered fails, the artist's own passes", async () => {
  await assertFails(getDocs(collection(david(), "venueNotes")));
  await assertFails(getDocs(collection(admin(), "venueNotes")));
  await assertSucceeds(getDocs(query(collection(admin(), "venueNotes"), where("artistId", "==", "x"))));
  await assertFails(getDocs(query(collection(admin(), "venueNotes"), where("artistId", "==", "y"))));
  await assertFails(getDocs(query(collection(david(), "venueNotes"), where("artistId", "==", "x"))));
  await assertSucceeds(getDocs(query(collection(david(), "venues"), where("deletedAt", "==", null)))); // the directory lists for members
});

test("venues and venueNotes cannot be written from the client", async () => {
  for (const db of [admin(), david(), otherAdmin()]) {
    await assertFails(setDoc(doc(db, "venues", "new"), { name: "x" }));
    await assertFails(updateDoc(doc(db, "venues", "x"), { capacity: 1 }));
    await assertFails(setDoc(doc(db, "venueNotes", "x__new"), { artistId: "x" }));
    await assertFails(deleteDoc(doc(db, "venueNotes", "x__x")));
  }
});

// ---------- history is readable by the record's artist ----------

test("history: venueNotes entries read only for that artist's admins", async () => {
  await assertSucceeds(getDoc(doc(admin(), "venueNotes/x__v/history/000001")));
  await assertFails(getDoc(doc(otherAdmin(), "venueNotes/x__v/history/000001")));
  await assertFails(getDoc(doc(david(), "venueNotes/x__v/history/000001")));
  await assertSucceeds(getDoc(doc(otherAdmin(), "venueNotes/y__v/history/000001")));
});

test("history: an entry with artistId null reads for any admin, never for a member", async () => {
  await assertSucceeds(getDoc(doc(admin(), "venues/v/history/000001")));
  await assertSucceeds(getDoc(doc(otherAdmin(), "venues/v/history/000001")));
  await assertFails(getDoc(doc(david(), "venues/v/history/000001")));
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
  await assertFails(group(david(), ["artistId", "==", null]));
  await assertFails(group(david(), ["artistId", "==", "x"]));
  await assertFails(getDocs(collectionGroup(admin(), "history")));
  await assertFails(getDocs(collectionGroup(otherAdmin(), "history")));
  await assertFails(group(admin(), ["runId", "==", "r1"])); // a run lookup alone no longer passes: the page adds the artist filter
});
