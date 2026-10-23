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
    await setDoc(doc(d, "pitches/x/comments/c1"), { ...live });
    await setDoc(doc(d, "pitches/x/activity/a1"), { ...live });
    await setDoc(doc(d, "venues/x/history/000002"), { ...live, runId: "r1" });
    await setDoc(doc(d, "pitches/x/activity/a1/history/000001"), { ...live, runId: "r1" });
    await setDoc(doc(d, "songs/gone"), { deletedAt: new Date() });
    await setDoc(doc(d, "availability/asked"), { ...live, askedMusicianIds: ["m-david"] });
    await setDoc(doc(d, "availability/other"), { ...live, askedMusicianIds: ["m-eric"] });
    await setDoc(doc(d, "ledger/mine"), { ...live, kind: "payout", payeeUserId: "david" });
    await setDoc(doc(d, "ledger/theirs"), { ...live, kind: "payout", payeeUserId: "eric" });
    await setDoc(doc(d, "ledger/income"), { ...live, kind: "income" });
    await setDoc(doc(d, "ledger/reimb"), { ...live, kind: "reimbursement", payeeUserId: "david" });
    await setDoc(doc(d, "ledger/reimbTheirs"), { ...live, kind: "reimbursement", payeeUserId: "eric" });
    await setDoc(doc(d, "ledger/spend"), { ...live, kind: "expense" });
    await setDoc(doc(d, "expenses/mine"), { ...live, userId: "david" });
    await setDoc(doc(d, "expenses/theirs"), { ...live, userId: "eric" });
    await setDoc(doc(d, "unsubmittedDrafts/jeff__expenses"), { uid: "jeff", path: "expenses", values: { a: 1 } });
    await setDoc(doc(d, "unsubmittedDrafts/david__shows~x"), { uid: "david", path: "shows/x", values: { a: 2 } });
  });
});
after(async () => { await env.cleanup(); });

const admin = () => env.authenticatedContext("jeff", { role: "admin" }).firestore();
const david = () => env.authenticatedContext("david", { role: "member", musicianId: "m-david" }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const noRole = () => env.authenticatedContext("nobody", {}).firestore();

const ALL = ["users", "musicians", "artists", "shows", "songs", "files", "setlists", "rehearsals", "venues", "contacts", "promoters",
  "festivals", "editions", "pitches", "emailTemplates", "checklistTemplates", "showDeals", "statSnapshots", "mcpTokens"];
const MEMBER_READS = ["musicians", "artists", "shows", "songs", "files", "setlists", "rehearsals"];

test("admin reads everything, including sub-collections", async () => {
  for (const c of ALL) await assertSucceeds(getDoc(doc(admin(), c, "x")));
  await assertSucceeds(getDoc(doc(admin(), "pitches/x/comments/c1")));
  await assertSucceeds(getDoc(doc(admin(), "pitches/x/activity/a1")));
  for (const p of ["availability/asked", "ledger/income", "expenses/theirs"]) await assertSucceeds(getDoc(doc(admin(), p)));
});

test("members read the band collections but not booking, deals, money, users", async () => {
  for (const c of ALL) {
    const r = getDoc(doc(david(), c, "x"));
    await (MEMBER_READS.includes(c) ? assertSucceeds(r) : assertFails(r));
  }
  await assertFails(getDoc(doc(david(), "pitches/x/comments/c1")));
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

test("ledger: members read only their own payouts", async () => {
  await assertSucceeds(getDoc(doc(david(), "ledger/mine")));
  await assertSucceeds(getDoc(doc(david(), "ledger/reimb")));
  await assertFails(getDoc(doc(david(), "ledger/reimbTheirs")));
  await assertFails(getDoc(doc(david(), "ledger/spend")));
  await assertFails(getDoc(doc(david(), "ledger/theirs")));
  await assertFails(getDoc(doc(david(), "ledger/income")));
});

test("expenses: members read only their own", async () => {
  await assertSucceeds(getDoc(doc(david(), "expenses/mine")));
  await assertFails(getDoc(doc(david(), "expenses/theirs")));
});

test("signed-out and role-less users read nothing", async () => {
  for (const c of ["musicians", "shows", "venues", "users"]) {
    await assertFails(getDoc(doc(anon(), c, "x")));
    await assertFails(getDoc(doc(noRole(), c, "x")));
  }
});

test("ALL client writes are denied, even for admins", async () => {
  for (const db of [admin(), david(), anon()]) {
    await assertFails(setDoc(doc(db, "songs", "new"), { title: "x" }));
    await assertFails(updateDoc(doc(db, "songs", "x"), { n: 2 }));
    await assertFails(deleteDoc(doc(db, "songs", "x")));
    await assertFails(setDoc(doc(db, "expenses", "new"), { userId: "david" }));
    await assertFails(setDoc(doc(db, "pitches/x/comments/new"), { body: "x" }));
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
